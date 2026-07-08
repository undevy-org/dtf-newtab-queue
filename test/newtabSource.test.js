import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const NEWTAB_SOURCE = new URL("../src/newtab.js", import.meta.url);

describe("newtab favorites source", () => {
  it("lets favorite URL fields reach service normalization without native URL validation", async () => {
    const source = await readFile(NEWTAB_SOURCE, "utf8");

    assert.match(
      source,
      /input\.name = "url";\s+input\.type = "text";\s+input\.inputMode = "url";/
    );
    assert.match(
      source,
      /url\.name = "url";\s+url\.type = "text";\s+url\.inputMode = "url";/
    );
    assert.match(
      source,
      /customIconUrl\.name = "customIconUrl";\s+customIconUrl\.type = "text";\s+customIconUrl\.inputMode = "url";/
    );
  });
});
