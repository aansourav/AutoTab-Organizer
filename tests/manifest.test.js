import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const readPngSize = (file) => {
  const buffer = readFileSync(file);
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

test("manifest is a minimal mv3 extension", () => {
  const manifest = JSON.parse(
    readFileSync(join(root, "manifest.json"), "utf8"),
  );

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "AutoTab Organizer");
  assert.deepEqual(manifest.permissions, ["tabs", "tabGroups", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.action.default_popup, "src/popup.html");
  assert.equal(manifest.options_ui.page, "src/options.html");
  assert.equal(manifest.options_ui.open_in_tab, true);
});

test("icons are real pngs at the chrome sizes", () => {
  for (const size of [16, 48, 128]) {
    const dimensions = readPngSize(join(root, "icons", `icon${size}.png`));
    assert.deepEqual(dimensions, { width: size, height: size });
  }
});

test("the service worker loads without a live chrome object", async () => {
  await import("../src/background.js");
});
