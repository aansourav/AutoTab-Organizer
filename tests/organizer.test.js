import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { UNGROUPED_TAB_GROUP_ID } from "../src/matcher.js";
import {
  TAB_GROUP_BATCH_SIZE,
  applyRuleColorsQueued,
  collapseInactiveQueued,
  organizeAllWindowsQueued,
  organizeWindowQueued,
  ungroupWindowQueued,
} from "../src/organizer.js";
import { clearCachedState, saveState } from "../src/storage.js";
import { createFakeChrome } from "./fake-chrome.js";

const youtubeRule = {
  id: "rule-youtube",
  name: "YouTube",
  color: "red",
  patterns: ["youtube.com"],
  autoCollapse: false,
  priority: 0,
};

const baseSettings = {
  autoOrganizeEnabled: true,
  autoGroupByDomain: false,
  domainThreshold: 2,
  ignorePinnedTabs: true,
};

const tab = (overrides) => ({
  id: 1,
  windowId: 1,
  pinned: false,
  groupId: UNGROUPED_TAB_GROUP_ID,
  active: false,
  url: "https://www.youtube.com/watch?v=1",
  ...overrides,
});

const arrange = async (fake, state) => {
  globalThis.chrome = fake.chrome;
  clearCachedState();
  await saveState(state ?? { rules: [youtubeRule], settings: baseSettings });
};

describe("organizer", { concurrency: 1 }, () => {
  test("batches a large window into one group", async () => {
    const tabs = Array.from({ length: TAB_GROUP_BATCH_SIZE + 1 }, (_, index) =>
      tab({ id: index + 1, active: index === 0 }),
    );
    const groups = [];
    const fake = createFakeChrome({ tabs, groups });
    await arrange(fake);

    const result = await organizeWindowQueued(1, { mode: "all" });

    assert.equal(result.ok, true);
    assert.equal(result.moved, tabs.length);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, "YouTube");
    assert.equal(groups[0].color, "red");
    assert.equal(fake.control.groupCalls.length, 2);
    assert.equal(fake.control.groupCalls[0].groupId, null);
    assert.equal(fake.control.groupCalls[1].groupId, groups[0].id);
    assert.equal(new Set(tabs.map((item) => item.groupId)).size, 1);
  });

  test("a second pass reuses the group instead of duplicating it", async () => {
    const tabs = [tab({ id: 1, active: true }), tab({ id: 2 })];
    const groups = [];
    const fake = createFakeChrome({ tabs, groups });
    await arrange(fake);

    await organizeWindowQueued(1, { mode: "all" });
    const again = await organizeWindowQueued(1, { mode: "all" });

    assert.equal(again.moved, 0);
    assert.equal(groups.length, 1);
    assert.equal(fake.control.groupCalls.length, 1);
  });

  test("parallel organizes of one window share a single group", async () => {
    const tabs = [tab({ id: 1, active: true }), tab({ id: 2 })];
    const groups = [];
    const fake = createFakeChrome({ tabs, groups });
    await arrange(fake);

    let calls = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let markEntered;
    const entered = new Promise((resolve) => {
      markEntered = resolve;
    });
    const original = fake.chrome.tabs.group;
    fake.chrome.tabs.group = async (props) => {
      calls += 1;
      if (calls === 1) {
        markEntered();
        await gate;
      }
      return original(props);
    };

    const first = organizeWindowQueued(1, { mode: "all" });
    await entered;
    const second = organizeWindowQueued(1, { mode: "all" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1);

    release();
    await first;
    await second;

    assert.equal(calls, 1);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, "YouTube");
  });

  test("a closed tab does not abort the rest of the group", async () => {
    const tabs = [tab({ id: 1, active: true }), tab({ id: 2 }), tab({ id: 3 })];
    const groups = [];
    const fake = createFakeChrome({ tabs, groups, failTabIds: [2] });
    await arrange(fake);

    const result = await organizeWindowQueued(1, { mode: "all" });

    assert.equal(result.ok, true);
    assert.equal(result.moved, 2);
    assert.equal(groups.length, 1);
    assert.equal(tabs[0].groupId, groups[0].id);
    assert.equal(tabs[1].groupId, UNGROUPED_TAB_GROUP_ID);
    assert.equal(tabs[2].groupId, groups[0].id);
  });

  test("a tab that disappears before grouping is skipped", async () => {
    const tabs = [tab({ id: 1, active: true }), tab({ id: 2 })];
    const groups = [];
    const fake = createFakeChrome({ tabs, groups });
    let queries = 0;
    const original = fake.chrome.tabs.query.bind(fake.chrome.tabs);
    fake.chrome.tabs.query = async (query) => {
      queries += 1;
      if (queries > 1) {
        const index = tabs.findIndex((item) => item.id === 2);
        if (index !== -1) tabs.splice(index, 1);
      }
      return original(query);
    };
    await arrange(fake);

    const result = await organizeWindowQueued(1, { mode: "all" });

    assert.equal(result.ok, true);
    assert.equal(result.moved, 1);
    assert.equal(groups.length, 1);
    assert.equal(tabs[0].groupId, groups[0].id);
  });

  test("reused groups take the color from the rule", async () => {
    const groups = [
      { id: 4, windowId: 1, title: "YouTube", color: "blue", collapsed: false },
    ];
    const tabs = [tab({ id: 1, active: true })];
    const fake = createFakeChrome({ tabs, groups });
    await arrange(fake);

    await organizeWindowQueued(1, { mode: "all" });

    assert.equal(tabs[0].groupId, 4);
    assert.equal(groups[0].color, "red");
    assert.equal(groups.length, 1);
  });

  test("a custom color is applied to a group that already has its tabs", async () => {
    const groups = [
      { id: 4, windowId: 1, title: "YouTube", color: "blue", collapsed: false },
    ];
    const tabs = [tab({ id: 1, groupId: 4, active: true })];
    const fake = createFakeChrome({ tabs, groups });
    await arrange(fake, {
      rules: [{ ...youtubeRule, color: "#ff00aa" }],
      settings: baseSettings,
    });

    const result = await applyRuleColorsQueued();

    assert.equal(result.painted, 1);
    assert.equal(groups[0].color, "pink");
    assert.equal(tabs[0].groupId, 4);
    assert.equal(fake.control.groupCalls.length, 0);
  });

  test("a group in another window is not reused", async () => {
    const groups = [
      { id: 5, windowId: 2, title: "YouTube", color: "red", collapsed: false },
    ];
    const tabs = [
      tab({ id: 1, windowId: 1, active: true }),
      tab({ id: 2, windowId: 2, groupId: 5 }),
    ];
    const fake = createFakeChrome({ tabs, groups });
    await arrange(fake);

    await organizeWindowQueued(1, { mode: "all" });

    assert.notEqual(tabs[0].groupId, 5);
    assert.equal(tabs[1].groupId, 5);
    assert.equal(groups.filter((group) => group.windowId === 1).length, 1);
  });

  test("auto-collapse leaves the active group open", async () => {
    const tabs = [
      tab({ id: 1, active: true }),
      tab({ id: 2, url: "https://example.com/", active: false }),
    ];
    const groups = [];
    const fake = createFakeChrome({ tabs, groups });
    await arrange(fake, {
      rules: [{ ...youtubeRule, autoCollapse: true }],
      settings: baseSettings,
    });

    await organizeWindowQueued(1, { mode: "all" });
    assert.equal(groups[0].collapsed, false);

    tabs[0].active = false;
    tabs[1].active = true;
    tabs[0].groupId = UNGROUPED_TAB_GROUP_ID;
    groups.splice(0, groups.length);

    await organizeWindowQueued(1, { mode: "all" });
    assert.equal(groups[0].collapsed, true);
    assert.equal(tabs[1].groupId, UNGROUPED_TAB_GROUP_ID);
  });

  test("manual organize still runs when auto-organize is off", async () => {
    const tabs = [tab({ id: 1, active: true })];
    const groups = [];
    const fake = createFakeChrome({ tabs, groups });
    await arrange(fake, {
      rules: [youtubeRule],
      settings: { ...baseSettings, autoOrganizeEnabled: false },
    });

    const skipped = await organizeWindowQueued(1, {
      mode: "touched",
      tabIds: [1],
      respectEnabledFlag: true,
    });
    assert.equal(skipped.moved, 0);
    assert.equal(fake.control.groupCalls.length, 0);

    const manual = await organizeWindowQueued(1, {
      mode: "all",
      respectEnabledFlag: false,
    });
    assert.equal(manual.moved, 1);
    assert.equal(groups.length, 1);
  });

  test("all windows and ungroup and collapse stay inside each window", async () => {
    const groups = [
      { id: 1, windowId: 1, title: "YouTube", color: "red", collapsed: false },
      { id: 2, windowId: 1, title: "Social", color: "blue", collapsed: false },
    ];
    const tabs = [
      tab({ id: 1, windowId: 1, groupId: 1, active: true }),
      tab({ id: 2, windowId: 1, groupId: 2, url: "https://reddit.com/" }),
      tab({
        id: 3,
        windowId: 1,
        groupId: 2,
        pinned: true,
        url: "https://reddit.com/",
      }),
      tab({
        id: 4,
        windowId: 2,
        url: "https://youtube.com/feed",
        active: true,
      }),
    ];
    const fake = createFakeChrome({ tabs, groups });
    await arrange(fake, {
      rules: [
        youtubeRule,
        {
          id: "rule-social",
          name: "Social",
          color: "blue",
          patterns: ["reddit.com"],
          autoCollapse: false,
          priority: 1,
        },
      ],
      settings: baseSettings,
    });

    const organized = await organizeAllWindowsQueued({ mode: "all" });
    assert.equal(organized.ok, true);
    assert.equal(tabs[3].groupId === 1, false);
    assert.equal(
      groups.some((group) => group.windowId === 2 && group.title === "YouTube"),
      true,
    );

    const collapsed = await collapseInactiveQueued(1);
    assert.equal(collapsed.collapsed, 1);
    assert.equal(groups.find((group) => group.id === 1).collapsed, false);
    assert.equal(groups.find((group) => group.id === 2).collapsed, true);

    const ungrouped = await ungroupWindowQueued(1);
    assert.equal(ungrouped.ungrouped, 2);
    assert.equal(tabs[0].groupId, UNGROUPED_TAB_GROUP_ID);
    assert.equal(tabs[1].groupId, UNGROUPED_TAB_GROUP_ID);
    assert.equal(tabs[2].groupId, 2);
    assert.notEqual(tabs[3].groupId, UNGROUPED_TAB_GROUP_ID);
  });
});
