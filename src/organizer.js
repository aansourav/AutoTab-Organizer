import { chromeColorFor } from "./color.js";
import { isGroupableTab, UNGROUPED_TAB_GROUP_ID } from "./matcher.js";
import { planWindowOrganization } from "./planner.js";
import { ruleTitle } from "./rules.js";
import { loadState } from "./storage.js";
import { createWindowQueue } from "./window-queue.js";

export const TAB_GROUP_BATCH_SIZE = 100;

const queue = createWindowQueue();

const chromeApi = () => {
  const api = globalThis.chrome;
  if (!api?.tabs || !api?.tabGroups || !api?.windows) {
    throw new Error("Chrome tab APIs are unavailable.");
  }
  return api;
};

const errorText = (error) =>
  error instanceof Error
    ? error.message
    : "Tabs changed before they could be grouped.";

const chunk = (values, size) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const queryTabs = async (windowId, query = {}) => {
  const tabs = await chromeApi().tabs.query({ windowId, ...query });
  return tabs.filter((tab) => tab.windowId === windowId);
};

const queryGroups = (windowId) => chromeApi().tabGroups.query({ windowId });

const listStillOpen = async (windowId, tabIds) => {
  const openIds = new Set(
    (await queryTabs(windowId))
      .filter((tab) => isGroupableTab(tab))
      .map((tab) => tab.id),
  );
  return tabIds.filter((tabId) => openIds.has(tabId));
};

const callGroup = async ({ windowId, groupId, tabIds }) => {
  const tabsApi = chromeApi().tabs;
  if (groupId == null) {
    return tabsApi.group({
      tabIds,
      createProperties: { windowId },
    });
  }

  await tabsApi.group({ tabIds, groupId });
  return groupId;
};

// One closed tab makes Chrome reject the whole batch. Splitting isolates that
// tab so the rest of a 200-tab sweep still lands in the group.
const groupBatchResilient = async ({ windowId, groupId, tabIds }) => {
  if (tabIds.length === 0) return groupId ?? null;

  try {
    return await callGroup({ windowId, groupId, tabIds });
  } catch (error) {
    if (tabIds.length === 1) {
      console.warn(
        "AutoTab Organizer: skipped a tab that closed during grouping",
        error,
      );
      return groupId ?? null;
    }

    const midpoint = Math.ceil(tabIds.length / 2);
    const leftId = await groupBatchResilient({
      windowId,
      groupId,
      tabIds: tabIds.slice(0, midpoint),
    });
    return groupBatchResilient({
      windowId,
      groupId: leftId ?? groupId,
      tabIds: tabIds.slice(midpoint),
    });
  }
};

const updatePresentation = async (groupId, groupPlan) => {
  try {
    await chromeApi().tabGroups.update(groupId, {
      title: groupPlan.title,
      color: chromeColorFor(groupPlan.color),
    });
  } catch (error) {
    console.warn("AutoTab Organizer: could not name the group", error);
  }
};

const countMembers = async (windowId, groupId, tabIds) => {
  const wanted = new Set(tabIds);
  const tabs = await queryTabs(windowId);
  return tabs.filter((tab) => tab.groupId === groupId && wanted.has(tab.id))
    .length;
};

const commitGroup = async (windowId, groupPlan) => {
  const openIds = await listStillOpen(windowId, groupPlan.tabIds);
  if (openIds.length === 0) {
    return {
      groupId: groupPlan.existingGroupId ?? null,
      moved: 0,
      created: false,
    };
  }

  let groupId = groupPlan.existingGroupId ?? null;
  const created = groupId == null;

  for (const batch of chunk(openIds, TAB_GROUP_BATCH_SIZE)) {
    const nextId = await groupBatchResilient({
      windowId,
      groupId,
      tabIds: batch,
    });
    if (nextId == null) continue;
    groupId = nextId;
  }

  if (groupId == null) return { groupId: null, moved: 0, created: false };
  await updatePresentation(groupId, groupPlan);

  return {
    groupId,
    moved: await countMembers(windowId, groupId, openIds),
    created,
  };
};

const collapseIfInactive = async (windowId, groupId) => {
  try {
    const [active] = await queryTabs(windowId, { active: true });
    if (active?.groupId === groupId) return;
    await chromeApi().tabGroups.update(groupId, { collapsed: true });
  } catch (error) {
    console.warn("AutoTab Organizer: could not collapse a group", error);
  }
};

const organizeWindow = async (windowId, scope = {}) => {
  try {
    const state = await loadState();
    if (
      scope.respectEnabledFlag &&
      state.settings.autoOrganizeEnabled !== true
    ) {
      return { ok: true, moved: 0, windows: 1 };
    }

    const [tabs, groups] = await Promise.all([
      queryTabs(windowId),
      queryGroups(windowId),
    ]);
    const plan = planWindowOrganization({
      tabs,
      groups,
      rules: state.rules,
      settings: state.settings,
      windowId,
      mode: scope.mode ?? "all",
      tabIds: scope.tabIds ?? [],
    });

    let moved = 0;
    for (const groupPlan of plan.groups) {
      const result = await commitGroup(windowId, groupPlan);
      moved += result.moved;
      if (result.created && groupPlan.autoCollapse && result.groupId != null) {
        await collapseIfInactive(windowId, result.groupId);
      }
    }

    await repaintRuleColors(windowId, state.rules);
    return { ok: true, moved, windows: 1 };
  } catch (error) {
    console.warn("AutoTab Organizer: organize window failed", error);
    return { ok: false, moved: 0, windows: 1, error: errorText(error) };
  }
};

const listTabWindows = async () => {
  const windows = await chromeApi().windows.getAll();
  return windows.filter(
    (browserWindow) =>
      browserWindow.type === "normal" || browserWindow.type === "popup",
  );
};

const repaintRuleColors = async (windowId, rules) => {
  const groups = await queryGroups(windowId);
  let painted = 0;

  for (const group of groups) {
    const title = String(group.title ?? "").trim();
    const rule = (rules ?? []).find((item) => ruleTitle(item) === title);
    if (!rule) continue;
    const color = chromeColorFor(rule.color);
    if (group.color === color) continue;
    try {
      await chromeApi().tabGroups.update(group.id, { color });
      painted += 1;
    } catch (error) {
      console.warn("AutoTab Organizer: could not recolor the group", error);
    }
  }

  return painted;
};

export const organizeWindowQueued = (windowId, scope) =>
  queue.enqueue(windowId, () => organizeWindow(windowId, scope));

export const applyRuleColorsQueued = async () => {
  const state = await loadState();
  const windows = await listTabWindows();
  const counts = await Promise.all(
    windows.map((browserWindow) =>
      queue.enqueue(browserWindow.id, () =>
        repaintRuleColors(browserWindow.id, state.rules),
      ),
    ),
  );
  return {
    ok: true,
    painted: counts.reduce((sum, count) => sum + count, 0),
  };
};

export const organizeAllWindowsQueued = async (scope) => {
  const windows = await listTabWindows();
  const results = await Promise.all(
    windows.map((browserWindow) =>
      organizeWindowQueued(browserWindow.id, scope),
    ),
  );

  return {
    ok: results.every((result) => result.ok),
    moved: results.reduce((total, result) => total + result.moved, 0),
    windows: windows.length,
  };
};

const collapseInactiveGroups = async (windowId) => {
  try {
    const [tabs, groups] = await Promise.all([
      queryTabs(windowId),
      queryGroups(windowId),
    ]);
    const active = tabs.find((tab) => tab.active);
    let collapsed = 0;

    for (const group of groups) {
      if (group.id === active?.groupId || group.collapsed) continue;
      try {
        await chromeApi().tabGroups.update(group.id, { collapsed: true });
        collapsed += 1;
      } catch (error) {
        console.warn("AutoTab Organizer: could not collapse a group", error);
      }
    }

    return { ok: true, collapsed };
  } catch (error) {
    console.warn("AutoTab Organizer: collapse failed", error);
    return { ok: false, collapsed: 0, error: errorText(error) };
  }
};

export const collapseInactiveQueued = (windowId) =>
  queue.enqueue(windowId, () => collapseInactiveGroups(windowId));

const ungroupWindow = async (windowId) => {
  try {
    const tabs = await queryTabs(windowId);
    const tabIds = tabs
      .filter(
        (tab) =>
          tab.pinned !== true &&
          typeof tab.groupId === "number" &&
          tab.groupId !== UNGROUPED_TAB_GROUP_ID,
      )
      .map((tab) => tab.id);

    let ungrouped = 0;
    for (const batch of chunk(tabIds, TAB_GROUP_BATCH_SIZE)) {
      ungrouped += await ungroupBatch(windowId, batch);
    }

    return { ok: true, ungrouped };
  } catch (error) {
    console.warn("AutoTab Organizer: ungroup failed", error);
    return { ok: false, ungrouped: 0, error: errorText(error) };
  }
};

const ungroupBatch = async (windowId, tabIds) => {
  try {
    await chromeApi().tabs.ungroup(tabIds);
    return tabIds.length;
  } catch (error) {
    console.warn("AutoTab Organizer: ungroup skipped tabs that closed", error);
    const survivors = await listGroupedSurvivors(windowId, tabIds);
    if (survivors.length === 0) return 0;

    try {
      await chromeApi().tabs.ungroup(survivors);
      return survivors.length;
    } catch (retryError) {
      console.warn("AutoTab Organizer: ungroup batch failed", retryError);
      return 0;
    }
  }
};

const listGroupedSurvivors = async (windowId, tabIds) => {
  const wanted = new Set(tabIds);
  const tabs = await queryTabs(windowId);
  return tabs
    .filter(
      (tab) =>
        wanted.has(tab.id) &&
        tab.pinned !== true &&
        typeof tab.groupId === "number" &&
        tab.groupId !== UNGROUPED_TAB_GROUP_ID,
    )
    .map((tab) => tab.id);
};

export const ungroupWindowQueued = (windowId) =>
  queue.enqueue(windowId, () => ungroupWindow(windowId));
