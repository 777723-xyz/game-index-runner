import { setTimeout as delay } from "node:timers/promises";

export function mergeCatalogUpdate(base, generated, current) {
  assertCatalog(base, "base catalog");
  assertCatalog(generated, "generated catalog");
  assertCatalog(current, "current catalog");

  const baseByKey = catalogMap(base, "base catalog");
  const generatedByKey = catalogMap(generated, "generated catalog");
  const currentByKey = catalogMap(current, "current catalog");
  const changes = new Map();
  const removals = new Set();
  let conflicts = 0;

  for (const [key, baseEntry] of baseByKey) {
    const generatedEntry = generatedByKey.get(key);
    if (!generatedEntry) {
      removals.add(key);
      continue;
    }

    const fields = new Map();
    for (const field of new Set([...Object.keys(baseEntry), ...Object.keys(generatedEntry)])) {
      if (!sameValue(baseEntry[field], generatedEntry[field])) {
        fields.set(field, Object.hasOwn(generatedEntry, field)
          ? { deleted: false, value: generatedEntry[field] }
          : { deleted: true });
      }
    }
    if (fields.size) changes.set(key, fields);
  }

  for (const [key, generatedEntry] of generatedByKey) {
    if (!baseByKey.has(key)) changes.set(key, new Map([["__entry__", { deleted: false, value: generatedEntry }]]));
  }

  for (const key of removals) currentByKey.delete(key);
  for (const [key, fields] of changes) {
    if (fields.has("__entry__")) {
      if (!currentByKey.has(key)) currentByKey.set(key, structuredClone(fields.get("__entry__").value));
      continue;
    }

    const baseEntry = baseByKey.get(key) || {};
    const currentEntry = structuredClone(currentByKey.get(key) || baseEntry);
    for (const [field, change] of fields) {
      const generatedValue = change.deleted ? undefined : change.value;
      if (!sameValue(currentEntry[field], baseEntry[field]) && !sameValue(currentEntry[field], generatedValue)) {
        conflicts += 1;
      }
      if (change.deleted) delete currentEntry[field];
      else currentEntry[field] = structuredClone(change.value);
    }
    currentByKey.set(key, currentEntry);
  }

  const merged = [...currentByKey.values()];
  merged.sort((left, right) => String(left.title || "").localeCompare(String(right.title || ""), "zh-Hans")
    || String(left.repo || "").localeCompare(String(right.repo || ""), "en"));
  return { catalog: merged, conflicts, changedEntries: changes.size + removals.size };
}

export async function publishGeneratedFile({
  token,
  repository,
  branch = "main",
  targetPath,
  generatedContent,
  baseContent,
  mergeMode = "replace",
  commitMessage,
  maxAttempts = 5,
  apiBaseUrl = "https://api.github.com",
  fetchImpl = fetch,
  delayImpl = delay,
  onAttempt = () => {},
}) {
  if (!token) throw new Error("GITHUB_TOKEN is required");
  if (!repository || !repository.includes("/")) throw new Error("GITHUB_REPOSITORY must be owner/repository");
  if (!targetPath) throw new Error("TARGET_PATH is required");
  if (!commitMessage) throw new Error("COMMIT_MESSAGE is required");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("MAX_ATTEMPTS must be between 1 and 10");

  const encodedPath = targetPath.split("/").map(encodeURIComponent).join("/");
  const endpoint = `${apiBaseUrl}/repos/${repository}/contents/${encodedPath}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "777723-game-index-runner",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onAttempt({ attempt, phase: "read" });
    const currentResponse = await fetchImpl(`${endpoint}?ref=${encodeURIComponent(branch)}`, { headers });
    if (!currentResponse.ok) throw await responseError("read current file", currentResponse);
    const currentPayload = await currentResponse.json();
    const currentContent = Buffer.from(currentPayload.content.replace(/\s/g, ""), "base64").toString("utf8");
    const merged = buildContent({ mergeMode, baseContent, generatedContent, currentContent });

    if (normalizeText(merged.content) === normalizeText(currentContent)) {
      return { changed: false, attempts: attempt, conflicts: merged.conflicts, changedEntries: merged.changedEntries };
    }

    const updateResponse = await fetchImpl(endpoint, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(merged.content, "utf8").toString("base64"),
        sha: currentPayload.sha,
        branch,
      }),
    });
    if (updateResponse.ok) {
      const updatePayload = await updateResponse.json();
      return {
        changed: true,
        attempts: attempt,
        conflicts: merged.conflicts,
        changedEntries: merged.changedEntries,
        commitSha: updatePayload.commit?.sha || "",
      };
    }

    if (![409, 422].includes(updateResponse.status) || attempt === maxAttempts) {
      throw await responseError("update generated file", updateResponse);
    }
    await updateResponse.text();
    onAttempt({ attempt, phase: "retry", status: updateResponse.status });
    await delayImpl(Math.min(8_000, 500 * (2 ** (attempt - 1))));
  }

  throw new Error("Generated file update exhausted retries");
}

function buildContent({ mergeMode, baseContent, generatedContent, currentContent }) {
  if (mergeMode === "replace") return { content: ensureTrailingNewline(generatedContent), conflicts: 0, changedEntries: 1 };
  if (mergeMode !== "catalog") throw new Error(`Unsupported MERGE_MODE: ${mergeMode}`);
  if (baseContent === undefined) throw new Error("BASE_PATH is required for catalog merge mode");

  const result = mergeCatalogUpdate(
    JSON.parse(baseContent),
    JSON.parse(generatedContent),
    JSON.parse(currentContent),
  );
  return {
    content: `${JSON.stringify(result.catalog, null, 2)}\n`,
    conflicts: result.conflicts,
    changedEntries: result.changedEntries,
  };
}

function catalogMap(entries, label) {
  const result = new Map();
  for (const entry of entries) {
    const key = catalogKey(entry);
    if (!key) throw new Error(`${label} contains an entry without id or owner/name`);
    if (result.has(key)) throw new Error(`${label} contains duplicate key: ${key}`);
    result.set(key, structuredClone(entry));
  }
  return result;
}

function catalogKey(entry) {
  const id = String(entry?.id || "").trim().toLowerCase();
  if (id) return `id:${id}`;
  const owner = String(entry?.owner || "").trim().toLowerCase();
  const name = String(entry?.name || "").trim().toLowerCase();
  return owner && name ? `repo:${owner}/${name}` : "";
}

function assertCatalog(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeText(value) {
  return String(value).replace(/\r\n/g, "\n").replace(/\s+$/, "");
}

function ensureTrailingNewline(value) {
  return `${normalizeText(value)}\n`;
}

async function responseError(action, response) {
  const body = await response.text().catch(() => "");
  return new Error(`GitHub API failed to ${action}: ${response.status} ${body.slice(0, 1_000)}`);
}
