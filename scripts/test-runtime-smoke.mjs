import assert from "node:assert/strict";
import { applyRuntimeResults, resolveGameUrl, selectRuntimeTargets } from "./runtime-smoke-lib.mjs";

const now = new Date("2026-07-24T12:00:00Z");
const list = [
  { id: "new-game", status: "verified", pagesUrl: "https://777723-xyz.github.io/new/" },
  { id: "recent-playable", status: "verified", pagesUrl: "https://777723-xyz.github.io/recent/", runtimeStatus: "playable", runtimeCheckedAt: "2026-07-24T11:00:00Z" },
  { id: "old-playable", status: "verified", pagesUrl: "https://777723-xyz.github.io/old/", runtimeStatus: "playable", runtimeCheckedAt: "2026-07-01T00:00:00Z" },
  { id: "retry-me", status: "verified", pagesUrl: "https://777723-xyz.github.io/retry/", runtimeFailureCount: 1, runtimeCheckedAt: "2026-07-24T00:00:00Z" },
  { id: "foreign", status: "verified", pagesUrl: "https://example.com/foreign/" },
];

assert.deepEqual(selectRuntimeTargets(list, { now, limit: 4 }).map((entry) => entry.id), ["new-game", "retry-me", "old-playable"]);
assert.equal(resolveGameUrl({ pagesUrl: "https://777723-xyz.github.io/nested/", entryPath: "MapOnly/index.html" }), "https://777723-xyz.github.io/nested/MapOnly/index.html");
const firstFailure = applyRuntimeResults(list, [{ id: "new-game", ok: false, error: "timeout" }], now);
assert.equal(firstFailure[0].runtimeStatus, undefined);
assert.equal(firstFailure[0].runtimeFailureCount, 1);
const secondFailure = applyRuntimeResults(firstFailure, [{ id: "new-game", ok: false, error: "404", httpStatus: 404 }], now);
assert.equal(secondFailure[0].runtimeStatus, "failed");
const success = applyRuntimeResults(secondFailure, [{ id: "new-game", ok: true, loadMs: 1234, httpStatus: 200 }], now);
assert.equal(success[0].runtimeStatus, "playable");
assert.equal(success[0].runtimeFailureCount, undefined);
assert.equal(success[0].runtimeLoadMs, 1234);

console.log("Runtime smoke state test passed.");
