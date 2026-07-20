import crypto from "node:crypto";
import fs from "node:fs/promises";

const apiBase = "https://api.github.com";
const token = process.env.WEBRPG_APP_TOKEN || process.env.GITHUB_TOKEN || "";
const targetOrg = process.env.TARGET_ORG || "777723-xyz";
const limit = parseNonNegativeInt(process.env.LIMIT || "0");
const maxMatrixSize = parseNonNegativeInt(process.env.MAX_MATRIX_SIZE || "256");
const revalidateAfterHours = parsePositiveInt(process.env.REVALIDATE_AFTER_HOURS || "168");
const retryCooldownHours = parsePositiveInt(process.env.RETRY_COOLDOWN_HOURS || "6");

if (!token) {
  throw new Error("WEBRPG_APP_TOKEN or GITHUB_TOKEN is required.");
}

const list = JSON.parse(await fs.readFile("list.json", "utf8"));
const indexedSources = getUniqueSources(list);
const indexedByName = new Map(indexedSources.map((item) => [item.forkName.toLowerCase(), item]));
const orgRepos = await loadOrgRepos(targetOrg);
const now = Date.now();
const targets = orgRepos
  .filter((repo) => repo.fork && indexedByName.has(repo.name.toLowerCase()))
  .filter((repo) => shouldValidate(indexedByName.get(repo.name.toLowerCase()), now))
  .sort((left, right) => {
    const leftIndex = indexedByName.get(left.name.toLowerCase());
    const rightIndex = indexedByName.get(right.name.toLowerCase());
    const priorityDifference = validationPriority(leftIndex) - validationPriority(rightIndex);
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    const leftChecked = new Date(leftIndex.checkedAt || 0).valueOf();
    const rightChecked = new Date(rightIndex.checkedAt || 0).valueOf();
    if (leftChecked !== rightChecked) {
      return leftChecked - rightChecked;
    }

    return left.name.localeCompare(right.name, "en");
  });
const planned = limit > 0 ? targets.slice(0, limit) : targets.slice(0, maxMatrixSize);
const matrix = {
  include: planned.map((repo) => ({
    repo: repo.name,
  })),
};

console.log(`Indexed source repositories: ${indexedByName.size}`);
console.log(`Fork repositories in ${targetOrg}: ${targets.length}`);
console.log(`Repositories in this run: ${planned.length}`);
console.log(`Verified recheck interval: ${revalidateAfterHours}h; retry cooldown: ${retryCooldownHours}h.`);

await writeOutput("matrix", JSON.stringify(matrix));
await writeOutput("has_targets", planned.length > 0 ? "true" : "false");
await writeOutput("target_count", String(planned.length));

async function loadOrgRepos(org) {
  const repos = [];

  for (let page = 1; ; page += 1) {
    const batch = await githubRequest(`/orgs/${encodeURIComponent(org)}/repos?type=all&per_page=100&page=${page}`);
    if (batch.length === 0) {
      break;
    }

    repos.push(...batch);
  }

  return repos;
}

function getUniqueSources(entries) {
  const bySource = new Map();
  const seenRepoNames = new Set();

  for (const entry of entries) {
    if (isSkippedEntry(entry)) {
      continue;
    }

    const source = `${entry.owner}/${entry.name}`;
    const sourceKey = source.toLowerCase();
    const repoNameKey = String(entry.name).toLowerCase();

    if (seenRepoNames.has(repoNameKey)) {
      continue;
    }
    seenRepoNames.add(repoNameKey);

    if (!bySource.has(sourceKey)) {
      bySource.set(sourceKey, {
        source,
        owner: entry.owner,
        name: entry.name,
        forkName: makeForkName(entry.owner, entry.name),
        status: entry.status || "indexed",
        checkedAt: entry.checkedAt,
      });
    }
  }

  const usedNames = new Map();
  for (const item of bySource.values()) {
    const nameKey = item.forkName.toLowerCase();
    const existingSource = usedNames.get(nameKey);
    if (existingSource && existingSource !== item.source.toLowerCase()) {
      item.forkName = makeForkName(item.owner, `${item.name}-${shortHash(item.source)}`);
    }
    usedNames.set(item.forkName.toLowerCase(), item.source.toLowerCase());
  }

  return [...bySource.values()];
}

function makeForkName(owner, name) {
  const raw = `${owner}-${name}`;
  let safe = raw
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");

  if (!safe) {
    safe = `repo-${shortHash(raw)}`;
  }

  if (safe.length <= 100) {
    return safe;
  }

  return `${safe.slice(0, 91).replace(/[.-]+$/g, "")}-${shortHash(raw)}`;
}

function isSkippedEntry(entry) {
  return ["invalid_structure", "deleted_invalid_structure", "duplicate_name", "hidden"].includes(entry.status);
}

function validationPriority(entry) {
  return entry.status === "verified" ? 1 : entry.lastCheckError ? 2 : 0;
}

function shouldValidate(entry, timestamp) {
  if (!entry) return false;

  const ageHours = checkedAgeHours(entry.checkedAt, timestamp);
  if (entry.status === "verified") {
    return ageHours === null || ageHours >= revalidateAfterHours;
  }

  if (entry.lastCheckError) {
    return ageHours === null || ageHours >= retryCooldownHours;
  }

  return true;
}

function checkedAgeHours(value, timestamp) {
  const checkedAt = new Date(value || 0).valueOf();
  if (!Number.isFinite(checkedAt) || checkedAt <= 0) return null;
  return Math.max(0, (timestamp - checkedAt) / 3_600_000);
}

async function githubRequest(path, options = {}) {
  const maxRetries = 5;
  const baseDelayMs = 10_000;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(`${apiBase}${path}`, {
      method: options.method || "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (response.ok) {
      return data;
    }

    // Rate limit: retry with exponential backoff
    if (response.status === 403 || response.status === 429) {
      const retryAfter = data?.["retry-after"];
      const delayMs = retryAfter
        ? Number.parseInt(retryAfter, 10) * 1000
        : Math.min(baseDelayMs * (2 ** attempt), 300_000);

      if (attempt < maxRetries) {
        console.log(`[rate-limit] ${data?.message?.slice(0, 60)}; waiting ${Math.round(delayMs / 1000)}s before retry ${attempt + 1}/${maxRetries}`);
        await sleep(delayMs);
        continue;
      }
    }

    throw new Error(`GitHub API ${response.status}: ${data?.message || response.statusText}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function parseNonNegativeInt(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`LIMIT must be a non-negative integer, got ${value}.`);
  }

  return parsed;
}

function parsePositiveInt(value) {
  const parsed = parseNonNegativeInt(value);
  if (parsed <= 0) throw new Error(`Expected a positive integer, got ${value}.`);
  return parsed;
}

function shortHash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
}

async function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  await fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
