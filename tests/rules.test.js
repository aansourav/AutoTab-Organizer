import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePatternList } from "../src/patterns.js";
import { GROUP_COLORS } from "../src/color.js";
import {
  DEFAULT_SETTINGS,
  defaultRules,
  normalizeState,
  parseBackup,
  serializeBackup,
} from "../src/rules.js";

const swatch = (id) => GROUP_COLORS.find((color) => color.id === id).swatch;

test("patterns accept commas, newlines, protocols, and duplicates", () => {
  assert.deepEqual(
    parsePatternList(
      " YouTube.com, https://www.youtube.com/watch?v=1\n\n*.Google.com, inbox ",
    ),
    ["youtube.com", "youtube.com/watch", "*.google.com", "inbox"],
  );
});

test("missing storage seeds defaults and an empty list stays empty", () => {
  const seeded = normalizeState({});
  assert.deepEqual(
    seeded.rules.map((rule) => rule.name),
    defaultRules().map((rule) => rule.name),
  );
  assert.deepEqual(seeded.settings, DEFAULT_SETTINGS);

  const cleared = normalizeState({
    rules: [],
    settings: { autoGroupByDomain: false },
  });
  assert.deepEqual(cleared.rules, []);
  assert.equal(cleared.settings.autoGroupByDomain, false);
});

test("settings clamp the threshold and always skip pinned tabs", () => {
  const low = normalizeState({
    rules: [],
    settings: { domainThreshold: 0, ignorePinnedTabs: false },
  });
  assert.equal(low.settings.domainThreshold, 1);
  assert.equal(low.settings.ignorePinnedTabs, true);

  const high = normalizeState({
    rules: [],
    settings: { domainThreshold: 2.8 },
  });
  assert.equal(high.settings.domainThreshold, 3);

  const huge = normalizeState({ rules: [], settings: { domainThreshold: 99 } });
  assert.equal(huge.settings.domainThreshold, 50);
});

test("saved order wins over stale priority numbers", () => {
  const state = normalizeState(
    {
      rules: [
        {
          id: "b",
          name: "Second",
          color: "blue",
          patterns: ["b.example"],
          priority: 0,
        },
        {
          id: "a",
          name: "First",
          color: "nope",
          patterns: ["a.example"],
          priority: 9,
        },
      ],
    },
    { trustOrder: true },
  );

  assert.deepEqual(
    state.rules.map((rule) => [rule.name, rule.priority, rule.color]),
    [
      ["Second", 0, swatch("blue")],
      ["First", 1, swatch("grey")],
    ],
  );
});

test("backup import keeps current settings when the file has none", () => {
  const current = {
    ...DEFAULT_SETTINGS,
    autoGroupByDomain: false,
    domainThreshold: 4,
  };
  const parsed = parseBackup(
    JSON.stringify({ version: 1, rules: defaultRules() }),
    current,
  );

  assert.equal(parsed.rules[0].name, "YouTube");
  assert.equal(parsed.settings.autoGroupByDomain, false);
  assert.equal(parsed.settings.domainThreshold, 4);
  assert.throws(() => parseBackup('{ "rules": "nope" }'), /rules array/);
});

test("saved colors keep an exact hex and still accept the old chrome names", () => {
  const state = normalizeState(
    {
      rules: [
        { id: "custom", name: "Custom", color: "#FF00AA", patterns: ["example.com"] },
        { id: "named", name: "Named", color: "cyan", patterns: ["example.org"] },
      ],
    },
    { trustOrder: true },
  );

  assert.deepEqual(
    state.rules.map((rule) => rule.color),
    ["#ff00aa", swatch("cyan")],
  );
});

test("backup round trip keeps rules and settings", () => {
  const state = normalizeState({
    rules: defaultRules(),
    settings: { autoOrganizeEnabled: false, domainThreshold: 3 },
  });
  const restored = parseBackup(serializeBackup(state), state.settings);
  assert.equal(restored.settings.autoOrganizeEnabled, false);
  assert.equal(restored.settings.domainThreshold, 3);
  assert.equal(restored.rules.length, state.rules.length);
});
