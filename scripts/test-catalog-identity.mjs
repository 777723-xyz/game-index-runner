import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "runner-catalog-identity-"));
const listPath = path.join(temporary, "list.json");
const resultsDir = path.join(temporary, "results");
const syncScript = path.resolve("scripts/sync-upstream-list.mjs");
const updateScript = path.resolve("scripts/update-list-from-results.mjs");
const id = "jsnb21-sci-high-website";
const staleId = "jsnb21-sci-high-rmmv";
const originalSource = "jsnb21/SCI-HIGH_WEBSITE";
const mirrorSource = "WebRPG-org/jsnb21-SCI-HIGH_WEBSITE";
const pagesUrl = "https://777723-xyz.github.io/jsnb21-SCI-HIGH_WEBSITE/index.html";

const upstream = [
  {
    id: staleId,
    title: "SCI-HIGH",
    repo: "https://github.com/jsnb21/SCI-HIGH_RMMV",
    owner: "jsnb21",
    name: "SCI-HIGH_RMMV",
    engine: "RPG Maker MV",
    status: "indexed",
    source: "github-code-search",
    sourcePath: "index.html",
  },
  {
    id,
    title: "SCI-HIGH",
    repo: `https://github.com/${originalSource}`,
    owner: "jsnb21",
    name: "SCI-HIGH_WEBSITE",
    engine: "RPG Maker MV",
    status: "verified",
    source: "github-code-search",
    sourcePath: "index.html",
    pagesUrl: "https://webrpg.org/jsnb21-SCI-HIGH_WEBSITE/",
    sourceRepo: originalSource,
  },
];

const local = [
  {
    ...upstream[0],
    status: "verified",
    forkName: "jsnb21-SCI-HIGH_WEBSITE",
    pagesUrl,
  },
  { ...upstream[1], status: "indexed", pagesUrl: undefined },
  {
    ...upstream[1],
    repo: `https://github.com/${mirrorSource}`,
    owner: "WebRPG-org",
    name: "jsnb21-SCI-HIGH_WEBSITE",
    status: "verified",
    pagesUrl,
    checkedAt: "2026-07-24T06:14:36.279Z",
    sourceRepo: mirrorSource,
  },
  {
    ...upstream[1],
    repo: `https://github.com/${mirrorSource}`,
    owner: "WebRPG-org",
    name: "jsnb21-SCI-HIGH_WEBSITE",
    status: "duplicate_name",
    pagesUrl,
    checkedAt: "2026-07-24T03:24:06.191Z",
    sourceRepo: mirrorSource,
  },
];

try {
  await fs.mkdir(resultsDir);
  await fs.writeFile(listPath, `${JSON.stringify(local, null, 2)}\n`);
  await fs.writeFile(path.join(resultsDir, "result.json"), `${JSON.stringify({
    forkName: "jsnb21-SCI-HIGH_WEBSITE",
    status: "verified",
    checkedAt: "2026-07-24T07:00:00.000Z",
    sourceRepo: mirrorSource,
    pagesUrl,
    entryPath: "index.html",
    engine: "RPG Maker MV",
    validationScore: 118,
    totalSize: 820218,
    dataSize: 1447138,
  }, null, 2)}\n`);

  const upstreamUrl = `data:application/json;base64,${Buffer.from(JSON.stringify(upstream)).toString("base64")}`;
  for (let cycle = 0; cycle < 5; cycle += 1) {
    await run(process.execPath, [syncScript], {
      env: { ...process.env, LIST_PATH: listPath, UPSTREAM_LIST_URL: upstreamUrl },
    });
    await run(process.execPath, [updateScript], {
      env: { ...process.env, LIST_PATH: listPath, RESULTS_DIR: resultsDir, DRY_RUN: "false" },
    });

    const catalog = JSON.parse(await fs.readFile(listPath, "utf8"));
    assert.equal(catalog.length, 2, `cycle ${cycle + 1} created a duplicate entry`);
    const published = catalog.find((entry) => entry.id === id);
    const stale = catalog.find((entry) => entry.id === staleId);
    assert.equal(published.owner, "jsnb21");
    assert.equal(published.name, "SCI-HIGH_WEBSITE");
    assert.equal(published.repo, `https://github.com/${originalSource}`);
    assert.equal(published.sourceRepo, originalSource);
    assert.equal(published.pagesUrl, pagesUrl);
    assert.equal(published.status, "verified");
    assert.equal(stale.status, "indexed");
    assert.equal(stale.pagesUrl, undefined, "stale source inherited another game's Pages URL");
    assert.equal(stale.forkName, undefined, "stale source inherited another game's fork name");
  }

  console.log("Catalog identity regression passed: 5 sync/update cycles, 2 stable sources and 1 publication.");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
