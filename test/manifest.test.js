import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function readManifest() {
  const contents = await readFile(
    new URL("../manifest.json", import.meta.url),
    "utf8"
  );
  return JSON.parse(contents);
}

describe("manifest", () => {
  it("uses only the required storage, favicon, and DTF API privileges", async () => {
    const manifest = await readManifest();

    assert.deepEqual(manifest.permissions, ["storage", "favicon"]);
    assert.deepEqual(manifest.host_permissions, [
      "https://api.dtf.ru/*",
      "https://api.open-meteo.com/*",
      "https://air-quality-api.open-meteo.com/*",
      "https://geocoding-api.open-meteo.com/*"
    ]);
  });

  it("pins a fixed key so every unpacked install gets the same extension id", async () => {
    const manifest = await readManifest();

    assert.equal(typeof manifest.key, "string");
    assert.ok(manifest.key.length > 0);
  });
});
