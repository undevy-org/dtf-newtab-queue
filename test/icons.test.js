import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { ICON_PATHS, createIconNode } from "../src/icons.js";

const ICON_NAMES = [
  "settings",
  "chevronLeft",
  "chevronRight",
  "pencil",
  "plus",
  "check",
  "checkCheck",
  "loaderCircle",
  "x",
  "trash2"
];

describe("icons", () => {
  it("has SVG path/circle markup for every icon the toolbar and forms use", () => {
    for (const name of ICON_NAMES) {
      assert.equal(typeof ICON_PATHS[name], "string", name);
      assert.match(ICON_PATHS[name], /<(path|circle)\b/, name);
    }
  });

  it("throws a clear error for an unknown icon name", () => {
    assert.throws(() => createIconNode("nope"), /Unknown icon: nope/);
  });

  it("is vendored locally with no new runtime dependency", async () => {
    const packageJson = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(packageJson, /lucide/i);
  });

  it("supports an optional extra className for one-off modifiers like a spinning icon", async () => {
    const code = await readFile(new URL("../src/icons.js", import.meta.url), "utf8");
    assert.match(
      code,
      /export function createIconNode\(name, \{ size = 18, className = "" \} = \{\}\)/
    );
    assert.match(code, /wrapper\.className = className \? `icon \$\{className\}` : "icon";/);
  });
});
