import crypto from "node:crypto";
import fs from "node:fs/promises";

const upstreamUrl = process.env.UPSTREAM_LIST_URL || "https://raw.githubusercontent.com/WebRPG-org/index/main/list.json";
const listPath = process.env.LIST_PATH || "list.json";
const local = JSON.parse(await fs.readFile(listPath, "utf8"));
const response = await fetch(upstreamUrl, { headers: { Accept: "application/json" } });

if (!response.ok) {
  throw new Error(`Upstream returned ${response.status}.`);
}

const upstream = await response.json();
if (!Array.isArray(local) || !Array.isArray(upstream)) {
  throw new Error("Both catalogs must be JSON arrays.");
}

const localByKey = groupBy(local, key);
const localById = groupBy(local, idKey);
const merged = upstream.map((remote) => {
  const idMatches = localById.get(idKey(remote)) || [];
  const candidates = idMatches.length ? idMatches : (localByKey.get(key(remote)) || []);
  return mergeUpstream(remote, selectPreferredEntry(candidates));
});
const upstreamKeys = new Set(upstream.map(key));
const upstreamIds = new Set(upstream.map(idKey).filter(Boolean));

// Keep discoveries made by this index even when they have not yet appeared in
// the upstream catalog. Upstream remains authoritative for shared entries.
for (const entry of local) {
  if (!upstreamKeys.has(key(entry)) && !upstreamIds.has(idKey(entry))) {
    merged.push(entry);
  }
}

const deduplicated = deduplicateById(merged);
const duplicateIdsRemoved = countDuplicateIds(local) - countDuplicateIds(deduplicated);
deduplicated.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans") || key(a).localeCompare(key(b), "en"));
await fs.writeFile(listPath, `${JSON.stringify(deduplicated, null, 2)}\n`);

console.log(JSON.stringify({
  upstream: upstream.length,
  localBefore: local.length,
  localAfter: deduplicated.length,
  duplicateIdsRemoved,
  upstreamOnly: upstream.filter((entry) => !localByKey.has(key(entry)) && !localById.has(idKey(entry))).length,
}, null, 2));

function mergeUpstream(remote, localEntry) {
  const entry = { ...remote, source: remote.source || "upstream-webrpg-index" };
  const upstreamPagesUrl = remote.pagesUrl;
  const upstreamCover = remote.cover;
  const matchesSource = localEntry && publicationMatchesSource(remote, localEntry);

  // Upstream Pages and covers belong to a different publisher. Never carry
  // those URLs into this organization’s playable catalog.
  delete entry.pagesUrl;
  delete entry.cover;
  delete entry.lastCheckError;
  entry.status = remote.status === "duplicate_name" ? "duplicate_name" : "indexed";

  if (upstreamPagesUrl) entry.upstreamPagesUrl = upstreamPagesUrl;
  if (upstreamCover) entry.upstreamCover = upstreamCover;
  if (remote.status) entry.upstreamStatus = remote.status;

  if (!localEntry) return clean(entry);

  const localPagesUrl = localEntry.pagesUrl;
  if (isOurPagesUrl(localPagesUrl) && matchesSource) {
    entry.pagesUrl = localPagesUrl;
    entry.cover = localEntry.cover;
    entry.status = localEntry.status || "verified";
    entry.checkedAt = localEntry.checkedAt;
    entry.entryPath = localEntry.entryPath;
    entry.coverPath = localEntry.coverPath;
    entry.validationScore = localEntry.validationScore;
    entry.totalSize = localEntry.totalSize;
    entry.dataSize = localEntry.dataSize;
    entry.runtimeStatus = localEntry.runtimeStatus;
    entry.runtimeCheckedAt = localEntry.runtimeCheckedAt;
    entry.runtimeLoadMs = localEntry.runtimeLoadMs;
    entry.runtimeHttpStatus = localEntry.runtimeHttpStatus;
    entry.runtimeFailureCount = localEntry.runtimeFailureCount;
    entry.runtimeLastError = localEntry.runtimeLastError;
  } else if (["invalid_structure", "check_error", "duplicate_name", "hidden"].includes(localEntry.status)) {
    entry.status = localEntry.status;
    entry.checkedAt = localEntry.checkedAt;
    entry.invalidReason = localEntry.invalidReason;
    entry.lastCheckError = localEntry.lastCheckError;
  }

  if (localEntry.forkName && matchesSource) entry.forkName = localEntry.forkName;
  return clean(entry);
}

function key(entry) {
  return `${entry.owner || ""}/${entry.name || ""}`.toLowerCase();
}

function idKey(entry) {
  return String(entry.id || "").trim().toLowerCase();
}

function groupBy(entries, getKey) {
  const groups = new Map();
  for (const entry of entries) {
    const value = getKey(entry);
    if (!value) continue;
    const group = groups.get(value) || [];
    group.push(entry);
    groups.set(value, group);
  }
  return groups;
}

function selectPreferredEntry(entries) {
  const unique = [...new Set(entries)];
  return unique.sort((left, right) => entryScore(right) - entryScore(left))[0];
}

function deduplicateById(entries) {
  const result = [];
  const positionById = new Map();

  for (const entry of entries) {
    const id = idKey(entry);
    if (!id) {
      result.push(entry);
      continue;
    }

    const position = positionById.get(id);
    if (position === undefined) {
      positionById.set(id, result.length);
      result.push(entry);
      continue;
    }

    if (entryScore(entry) > entryScore(result[position])) {
      result[position] = entry;
    }
  }

  return result;
}

function countDuplicateIds(entries) {
  const seen = new Set();
  let duplicates = 0;
  for (const entry of entries) {
    const id = idKey(entry);
    if (!id) continue;
    if (seen.has(id)) duplicates += 1;
    seen.add(id);
  }
  return duplicates;
}

function entryScore(entry) {
  let score = 0;
  if (isOurPagesUrl(entry.pagesUrl)) score += 100;
  if (entry.status === "verified") score += 50;
  if (entry.status !== "duplicate_name") score += 10;
  const checkedAt = Date.parse(entry.checkedAt || "");
  if (Number.isFinite(checkedAt)) score += checkedAt / 1e13;
  return score;
}

function publicationMatchesSource(remote, localEntry) {
  const source = `${remote.owner || ""}/${remote.name || ""}`;
  const forkName = String(localEntry.forkName || "").toLowerCase();
  if (!remote.owner || !remote.name || !forkName) return false;

  const expected = makeForkName(remote.owner, remote.name).toLowerCase();
  const collisionName = makeForkName(remote.owner, `${remote.name}-${shortHash(source)}`).toLowerCase();
  return forkName === expected || forkName === collisionName;
}

function makeForkName(owner, name) {
  const raw = `${owner}-${name}`;
  let safe = raw
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");

  if (!safe) safe = `repo-${shortHash(raw)}`;
  if (safe.length <= 100) return safe;
  return `${safe.slice(0, 91).replace(/[.-]+$/g, "")}-${shortHash(raw)}`;
}

function shortHash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function isOurPagesUrl(value) {
  try {
    return new URL(value).hostname === "777723-xyz.github.io";
  } catch {
    return false;
  }
}

function clean(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}
