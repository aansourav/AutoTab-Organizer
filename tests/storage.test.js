import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clearCachedState,
  ensureDefaultState,
  loadState,
  saveState,
} from "../src/storage.js";
import { createFakeChrome } from "./fake-chrome.js";

describe("storage", { concurrency: 1 }, () => {
  test("first run seeds defaults and later runs keep an empty rule list", async () => {
    const fake = createFakeChrome();
    globalThis.chrome = fake.chrome;
    clearCachedState();

    const seeded = await ensureDefaultState();
    assert.equal(seeded.rules[0].name, "YouTube");
    assert.equal(seeded.settings.domainThreshold, 2);

    clearCachedState();
    await saveState({
      rules: [],
      settings: { ...seeded.settings, autoGroupByDomain: false },
    });
    const kept = await ensureDefaultState();
    assert.deepEqual(kept.rules, []);
    assert.equal(kept.settings.autoGroupByDomain, false);
  });

  test("a sync quota error falls back to local storage", async () => {
    const fake = createFakeChrome();
    globalThis.chrome = fake.chrome;
    clearCachedState();
    fake.control.quotaExceeded = true;

    await saveState({
      rules: [
        {
          id: "amazon",
          name: "Amazon",
          color: "orange",
          patterns: ["amazon.com"],
          autoCollapse: false,
          priority: 0,
        },
      ],
      settings: {
        autoOrganizeEnabled: true,
        autoGroupByDomain: false,
        domainThreshold: 4,
        ignorePinnedTabs: false,
      },
    });

    assert.equal(fake.chrome.storage.sync.data.useLocal, true);
    assert.equal(fake.chrome.storage.local.data.rules[0].name, "Amazon");

    clearCachedState();
    fake.control.quotaExceeded = false;
    const loaded = await loadState();
    assert.equal(loaded.rules[0].name, "Amazon");
    assert.equal(loaded.settings.domainThreshold, 4);
    assert.equal(loaded.settings.autoGroupByDomain, false);
    assert.equal(loaded.settings.ignorePinnedTabs, true);
  });
});
