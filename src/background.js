import { MessageType } from "./messages.js";
import {
  applyRuleColorsQueued,
  collapseInactiveQueued,
  organizeAllWindowsQueued,
  organizeWindowQueued,
  ungroupWindowQueued,
} from "./organizer.js";
import {
  ORGANIZE_DEBOUNCE_MS,
  createWindowDebouncer,
  shouldOrganizeOnUpdate,
} from "./schedule.js";
import { ensureDefaultState, watchStorage } from "./storage.js";

const requireWindowId = (windowId) => {
  if (!Number.isInteger(windowId))
    throw new Error("No browser window was selected.");
  return windowId;
};

const handlers = {
  [MessageType.organizeWindow]: (message) =>
    organizeWindowQueued(requireWindowId(message.windowId), {
      mode: "all",
      respectEnabledFlag: false,
    }),
  [MessageType.organizeAllWindows]: () =>
    organizeAllWindowsQueued({ mode: "all", respectEnabledFlag: false }),
  [MessageType.collapseInactive]: (message) =>
    collapseInactiveQueued(requireWindowId(message.windowId)),
  [MessageType.ungroupWindow]: (message) =>
    ungroupWindowQueued(requireWindowId(message.windowId)),
  [MessageType.applyColors]: () => applyRuleColorsQueued(),
};

const handleMessage = (message) => {
  const handler = handlers[message?.type];
  if (!handler)
    return Promise.resolve({ ok: false, error: "Unknown request." });
  return handler(message);
};

const debouncer = createWindowDebouncer({
  waitMs: ORGANIZE_DEBOUNCE_MS,
  onFlush: (windowId, tabIds) => {
    void organizeWindowQueued(windowId, {
      mode: "touched",
      tabIds,
      respectEnabledFlag: true,
    });
  },
});

const scheduleTab = (tab) => {
  if (typeof tab?.windowId !== "number" || typeof tab?.id !== "number") return;
  debouncer.push(tab.windowId, tab.id);
};

const register = () => {
  const api = globalThis.chrome;
  if (!api?.runtime || !api?.tabs) return;

  watchStorage();
  void ensureDefaultState();

  api.runtime.onInstalled.addListener(() => {
    void ensureDefaultState();
  });

  api.tabs.onCreated.addListener((tab) => {
    scheduleTab(tab);
  });

  api.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (!shouldOrganizeOnUpdate(changeInfo)) return;
    scheduleTab(tab);
  });

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message).then(sendResponse, (error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Something went wrong.",
      });
    });
    return true;
  });
};

register();
