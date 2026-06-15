const apiBase = "https://api.github.com";
const token = process.env.WEBRPG_APP_TOKEN || process.env.GITHUB_TOKEN || "";
const targetOrg = process.env.TARGET_ORG || "WebRPG-org";
const repoName = process.env.REPO_NAME || "";
const dryRun = parseBoolean(process.env.DRY_RUN, true);
const pagesPath = process.env.PAGES_SOURCE_PATH || "/";
const siteOrigin = (process.env.SITE_ORIGIN || "https://webrpg.org").replace(/\/+$/, "");
const scriptTag = process.env.ANALYTICS_SCRIPT_TAG
  || '<script defer src="https://insight.ravelloh.com/script.js?siteId=5ace6623-f51b-4571-8f60-e0473ea3317b"></script>';
const scriptNeedle = getScriptNeedle(scriptTag);
const htmlMaxBytes = parsePositiveInt(process.env.HTML_MAX_BYTES || "1048576");

if (!token) {
  throw new Error("WEBRPG_APP_TOKEN or GITHUB_TOKEN is required.");
}

if (!repoName) {
  throw new Error("REPO_NAME is required.");
}

const summary = [];
summary.push(`# Prepare ${targetOrg}/${repoName}`);
summary.push("");
summary.push(`Dry run: \`${dryRun}\``);

const repo = await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}`);
if (!repo.fork) {
  throw new Error(`${targetOrg}/${repoName} is not a fork repository.`);
}

const branch = repo.default_branch;
const ref = await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/git/ref/heads/${encodeGitRefPath(branch)}`);
const headSha = ref.object.sha;
const headCommit = await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/git/commits/${headSha}`);
const tree = await githubRequest(
  `/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/git/trees/${headCommit.tree.sha}?recursive=1`,
);
const htmlFiles = tree.tree
  .filter((item) => item.type === "blob" && item.path.toLowerCase().endsWith(".html"))
  .filter((item) => !shouldSkipPath(item.path))
  .filter((item) => item.size <= htmlMaxBytes)
  .sort((left, right) => left.path.localeCompare(right.path, "en"));

console.log(`Found ${htmlFiles.length} HTML files in ${targetOrg}/${repoName}.`);

const modifiedFiles = [];
for (const file of htmlFiles) {
  const blob = await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/git/blobs/${file.sha}`);
  const original = Buffer.from(blob.content, blob.encoding).toString("utf8");
  const updated = injectScript(original, scriptTag, scriptNeedle);

  if (updated !== original) {
    modifiedFiles.push({ path: file.path, content: updated });
  }
}

if (dryRun) {
  console.log(`[dry-run] Would update ${modifiedFiles.length} HTML files.`);
  for (const file of modifiedFiles) {
    console.log(`[dry-run] update ${file.path}`);
  }
  console.log(`[dry-run] Would enable GitHub Pages from ${branch}${pagesPath}.`);
  summary.push(`HTML files found: \`${htmlFiles.length}\``);
  summary.push(`HTML files to update: \`${modifiedFiles.length}\``);
  summary.push(`Pages source: \`${branch}${pagesPath}\``);
  summary.push(`Pages URL: \`${getPagesUrl()}\``);
  await writeStepSummary(summary);
  process.exit(0);
}

if (modifiedFiles.length > 0) {
  const treeEntries = [];
  for (const file of modifiedFiles) {
    const blob = await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/git/blobs`, {
      method: "POST",
      body: {
        content: Buffer.from(file.content, "utf8").toString("base64"),
        encoding: "base64",
      },
      ok: [201],
    });
    treeEntries.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const newTree = await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/git/trees`, {
    method: "POST",
    body: {
      base_tree: headCommit.tree.sha,
      tree: treeEntries,
    },
    ok: [201],
  });
  const newCommit = await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/git/commits`, {
    method: "POST",
    body: {
      message: "Add WebRPG analytics script",
      tree: newTree.sha,
      parents: [headSha],
    },
    ok: [201],
  });
  await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/git/refs/heads/${encodeGitRefPath(branch)}`, {
    method: "PATCH",
    body: {
      sha: newCommit.sha,
      force: false,
    },
  });
  console.log(`[updated] ${modifiedFiles.length} HTML files in ${targetOrg}/${repoName}`);
} else {
  console.log(`[skip] analytics script already present or no HTML files found in ${targetOrg}/${repoName}`);
}

const pages = await ensurePages(branch, pagesPath);
summary.push(`HTML files found: \`${htmlFiles.length}\``);
summary.push(`HTML files updated: \`${modifiedFiles.length}\``);
summary.push(`Pages source: \`${branch}${pagesPath}\``);
summary.push(`Pages URL: \`${getPagesUrl()}\``);
await writeStepSummary(summary);

function injectScript(content, tag, needle) {
  if (content.includes(needle)) {
    return content;
  }

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const headMatch = content.match(/^([ \t]*)<\/head>/im);

  if (headMatch?.index !== undefined) {
    const indentedTag = `${headMatch[1]}${tag}`;
    return `${content.slice(0, headMatch.index)}${indentedTag}${newline}${content.slice(headMatch.index)}`;
  }

  const bodyMatch = content.match(/^([ \t]*)<\/body>/im);
  if (bodyMatch?.index !== undefined) {
    const indentedTag = `${bodyMatch[1]}${tag}`;
    return `${content.slice(0, bodyMatch.index)}${indentedTag}${newline}${content.slice(bodyMatch.index)}`;
  }

  const suffix = content.endsWith("\n") ? "" : newline;
  return `${content}${suffix}${tag}${newline}`;
}

async function ensurePages(branch, path) {
  const current = await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/pages`, {
    ok: [200, 404],
  });

  if (current?.status === 404 || current === null) {
    const created = await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/pages`, {
      method: "POST",
      body: {
        source: {
          branch,
          path,
        },
      },
      ok: [201],
    });
    console.log(`[pages] enabled ${getPagesUrl()}`);
    return created;
  }

  const source = current.source || {};
  if (source.branch === branch && source.path === path) {
    console.log(`[pages] already enabled ${current.html_url}`);
    return current;
  }

  const updated = await githubRequest(`/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}/pages`, {
    method: "PUT",
    body: {
      source: {
        branch,
        path,
      },
    },
    ok: [204],
  });
  console.log(`[pages] updated ${getPagesUrl()}`);
  return updated || current;
}

async function githubRequest(path, options = {}) {
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
  const data = parseResponseBody(text);
  const ok = options.ok || [200];

  if (!ok.includes(response.status)) {
    const message = data?.message || response.statusText;
    throw new Error(`GitHub API ${response.status}: ${message}`);
  }

  if (response.status === 404) {
    return { status: 404 };
  }

  return data;
}

function shouldSkipPath(path) {
  return /(^|\/)(node_modules|vendor|coverage|\.git|\.github)\//i.test(path);
}

function encodeGitRefPath(ref) {
  return ref.split("/").map(encodeURIComponent).join("/");
}

function getScriptNeedle(tag) {
  const match = tag.match(/src=["']([^"']+)["']/i);
  return match?.[1] || tag;
}

function getPagesUrl() {
  return `${siteOrigin}/${repoName}/`;
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}.`);
  }

  return parsed;
}

function parseResponseBody(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function writeStepSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    return;
  }

  const fs = await import("node:fs/promises");
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}
