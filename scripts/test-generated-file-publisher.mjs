import assert from "node:assert/strict";
import { mergeCatalogUpdate, publishGeneratedFile } from "./generated-file-publisher-lib.mjs";

const base = [
  { id: "alpha", title: "乙", status: "pending", pagesUrl: "old" },
  { id: "remove", title: "删除", status: "pending" },
];
const generated = [
  { id: "alpha", title: "乙", status: "verified", pagesUrl: "new" },
  { id: "added", title: "甲", status: "verified" },
];
const current = [
  { id: "alpha", title: "乙", status: "pending", pagesUrl: "old", runtimeStatus: "playable" },
  { id: "remove", title: "删除", status: "pending" },
  { id: "concurrent", title: "丙", status: "verified" },
];
const merged = mergeCatalogUpdate(base, generated, current);
assert.deepEqual(merged.catalog.map((entry) => entry.id), ["concurrent", "added", "alpha"]);
assert.deepEqual(merged.catalog.find((entry) => entry.id === "alpha"), {
  id: "alpha",
  title: "乙",
  status: "verified",
  pagesUrl: "new",
  runtimeStatus: "playable",
});
assert.equal(merged.changedEntries, 3);

let remoteContent = `${JSON.stringify(current, null, 2)}\n`;
let remoteSha = "sha-1";
let updateCalls = 0;
const fakeFetch = async (_url, options = {}) => {
  if (!options.method) return response(200, { content: Buffer.from(remoteContent).toString("base64"), sha: remoteSha });
  updateCalls += 1;
  if (updateCalls === 1) {
    remoteContent = `${JSON.stringify([...current, { id: "racer", title: "丁", status: "verified" }], null, 2)}\n`;
    remoteSha = "sha-2";
    return response(409, { message: "sha does not match" });
  }
  const payload = JSON.parse(options.body);
  assert.equal(payload.sha, "sha-2");
  remoteContent = Buffer.from(payload.content, "base64").toString("utf8");
  return response(200, { commit: { sha: "commit-3" } });
};
const published = await publishGeneratedFile({
  token: "test-token",
  repository: "owner/repo",
  targetPath: "list.json",
  generatedContent: `${JSON.stringify(generated)}\n`,
  baseContent: `${JSON.stringify(base)}\n`,
  mergeMode: "catalog",
  commitMessage: "test",
  maxAttempts: 3,
  apiBaseUrl: "https://example.invalid",
  fetchImpl: fakeFetch,
  delayImpl: async () => {},
});
assert.equal(published.changed, true);
assert.equal(published.attempts, 2);
assert.equal(published.commitSha, "commit-3");
const finalCatalog = JSON.parse(remoteContent);
assert.ok(finalCatalog.some((entry) => entry.id === "racer"), "concurrent additions must survive a retry");
assert.equal(finalCatalog.find((entry) => entry.id === "alpha").runtimeStatus, "playable");
assert.equal(finalCatalog.find((entry) => entry.id === "alpha").status, "verified");

const stressBase = Array.from({ length: 8 }, (_, index) => ({
  id: `game-${index}`,
  title: `Game ${index}`,
  status: "verified",
}));
let stressContent = `${JSON.stringify(stressBase, null, 2)}\n`;
let stressVersion = 1;
let stressConflicts = 0;
const stressFetch = async (_url, options = {}) => {
  if (!options.method) {
    return response(200, { content: Buffer.from(stressContent).toString("base64"), sha: `sha-${stressVersion}` });
  }

  const payload = JSON.parse(options.body);
  await Promise.resolve();
  if (payload.sha !== `sha-${stressVersion}`) {
    stressConflicts += 1;
    return response(409, { message: "sha does not match" });
  }
  stressContent = Buffer.from(payload.content, "base64").toString("utf8");
  stressVersion += 1;
  return response(200, { commit: { sha: `commit-${stressVersion}` } });
};
await Promise.all(stressBase.map((entry, index) => {
  const generatedEntry = { ...entry, [`writer${index}`]: true };
  const generatedCatalog = stressBase.map((item) => item.id === entry.id ? generatedEntry : item);
  return publishGeneratedFile({
    token: "test-token",
    repository: "owner/repo",
    targetPath: "list.json",
    generatedContent: `${JSON.stringify(generatedCatalog)}\n`,
    baseContent: `${JSON.stringify(stressBase)}\n`,
    mergeMode: "catalog",
    commitMessage: `writer ${index}`,
    maxAttempts: 10,
    apiBaseUrl: "https://example.invalid",
    fetchImpl: stressFetch,
    delayImpl: async () => {},
  });
}));
const stressedCatalog = JSON.parse(stressContent);
assert.ok(stressConflicts > 0, "stress test must exercise SHA conflicts");
for (let index = 0; index < stressBase.length; index += 1) {
  assert.equal(stressedCatalog.find((entry) => entry.id === `game-${index}`)[`writer${index}`], true);
}

console.log(`Generated file publisher tests passed: catalog merge, ${stressConflicts} concurrent SHA conflicts, bounded retry.`);

function response(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
