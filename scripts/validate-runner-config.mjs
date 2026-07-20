import fs from "node:fs/promises";

const paths = {
  index: ".github/workflows/index-github-rpgmaker-repos.yml",
  fork: ".github/workflows/fork-listed-repos.yml",
  prepare: ".github/workflows/prepare-fork-repos.yml",
  bulk: ".github/workflows/bulk-drain-pending.yml",
  legacyFork: ".github/workflows/continuous-fork-scheduler.yml",
  legacyIndex: ".github/workflows/continuous-index-scheduler.yml",
  process: "scripts/process-fork-repo.mjs",
};

const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await fs.readFile(path, "utf8")]));
const source = Object.fromEntries(entries);
const list = JSON.parse(await fs.readFile("list.json", "utf8"));
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(Array.isArray(list), "list.json must be an array");
const ids = new Set();
for (const game of Array.isArray(list) ? list : []) {
  requireValue(typeof game.id === "string" && game.id.length > 0, "a catalog entry is missing id");
  requireValue(!ids.has(game.id), `duplicate catalog id: ${game.id}`);
  ids.add(game.id);
}

requireValue(source.index.includes('cron: "17 * * * *"'), "index schedule must run hourly at minute 17");
requireValue(source.fork.includes('cron: "*/30 * * * *"'), "fork schedule must run every 30 minutes");
requireValue(source.fork.includes('LIMIT: "40"'), "fork batch limit must be 40");
requireValue(source.fork.includes('CREATE_DELAY_SECONDS: "8"'), "fork delay must be 8 seconds");
requireValue(source.prepare.includes('LIMIT: "40"'), "prepare batch limit must be 40");
requireValue(source.prepare.includes('MAX_MATRIX_SIZE: "40"'), "prepare matrix limit must be 40");
requireValue(source.prepare.includes("max-parallel: 5"), "prepare parallelism must be 5");
requireValue(source.prepare.includes("timeout-minutes: 20"), "prepare jobs need a hard timeout");
requireValue(source.prepare.includes('DELETE_INVALID_REPOS: "false"'), "prepare must not delete invalid repositories");
requireValue(source.prepare.includes("SITE_ORIGIN: https://777723-xyz.github.io"), "prepare Pages origin is incorrect");
requireValue(source.bulk.includes("timeout-minutes: 20"), "bulk jobs need a hard timeout");
requireValue(!/\bschedule\s*:/.test(source.legacyFork), "legacy fork scheduler must remain manual-only");
requireValue(!/\bschedule\s*:/.test(source.legacyIndex), "legacy index scheduler must remain manual-only");
requireValue(!source.legacyFork.includes("repository_dispatch"), "legacy fork self-dispatch must stay disabled");
requireValue(!source.legacyIndex.includes("repository_dispatch"), "legacy index self-dispatch must stay disabled");
requireValue(source.process.includes('HTML_MAX_FILES || "120"'), "HTML candidate limit is missing");
requireValue(source.process.includes('HTML_FETCH_CONCURRENCY || "5"'), "HTML fetch concurrency limit is missing");
requireValue(source.process.includes('GITHUB_API_TIMEOUT_MS || "30000"'), "GitHub API timeout is missing");
requireValue(!Object.values(source).some((text) => /google-analytics|googletagmanager|gtag\(|matomo|umami|plausible/i.test(text)), "unapproved analytics integration found");
requireValue(![source.prepare, source.bulk].some((text) => text.includes("ANALYTICS_SCRIPT_TAG")), "game source injection must stay disabled");

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Runner validation passed: ${list.length} unique entries, 40/5 batches, bounded repository inspection.`);
}
