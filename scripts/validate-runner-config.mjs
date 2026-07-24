import fs from "node:fs/promises";

const paths = {
  index: ".github/workflows/index-github-rpgmaker-repos.yml",
  fork: ".github/workflows/fork-listed-repos.yml",
  prepare: ".github/workflows/prepare-fork-repos.yml",
  bulk: ".github/workflows/bulk-drain-pending.yml",
  legacyFork: ".github/workflows/continuous-fork-scheduler.yml",
  legacyIndex: ".github/workflows/continuous-index-scheduler.yml",
  process: "scripts/process-fork-repo.mjs",
  forkScript: "scripts/fork-listed-repos.mjs",
  runtimeWorkflow: ".github/workflows/runtime-smoke-test.yml",
  runtimeScript: "scripts/runtime-smoke-test.mjs",
  runtimeLib: "scripts/runtime-smoke-lib.mjs",
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
requireValue(source.prepare.includes('REVALIDATE_AFTER_HOURS: "168"'), "verified recheck interval must be seven days");
requireValue(source.prepare.includes('RETRY_COOLDOWN_HOURS: "6"'), "check-error cooldown must be six hours");
requireValue(source.prepare.includes("timeout-minutes: 20"), "prepare jobs need a hard timeout");
requireValue(source.prepare.includes('DELETE_INVALID_REPOS: "false"'), "prepare must not delete invalid repositories");
requireValue(source.prepare.includes("SITE_ORIGIN: https://777723-xyz.github.io"), "prepare Pages origin is incorrect");
requireValue(source.bulk.includes("timeout-minutes: 20"), "bulk jobs need a hard timeout");
requireValue(source.bulk.includes('default: "40"'), "manual catch-up batch must default to 40");
requireValue(source.bulk.includes("max-parallel: 5"), "manual catch-up parallelism must be 5");
requireValue(!source.bulk.includes("remaining_batches"), "bulk workflow must not claim unsupported self-renewal");
requireValue(!/\bschedule\s*:/.test(source.legacyFork), "legacy fork scheduler must remain manual-only");
requireValue(!/\bschedule\s*:/.test(source.legacyIndex), "legacy index scheduler must remain manual-only");
requireValue(!source.legacyFork.includes("repository_dispatch"), "legacy fork self-dispatch must stay disabled");
requireValue(!source.legacyIndex.includes("repository_dispatch"), "legacy index self-dispatch must stay disabled");
requireValue(source.process.includes('HTML_MAX_FILES || "120"'), "HTML candidate limit is missing");
requireValue(source.process.includes('HTML_FETCH_CONCURRENCY || "5"'), "HTML fetch concurrency limit is missing");
requireValue(source.process.includes('GITHUB_API_TIMEOUT_MS || "30000"'), "GitHub API timeout is missing");
requireValue(source.forkScript.includes('"hidden"].includes(entry.status)'), "hidden entries must be skipped before forking");
requireValue(source.prepare.includes("catalog-updated"), "prepare workflow must notify the portal after aggregation");
requireValue(source.bulk.includes("catalog-updated"), "manual catch-up workflow must notify the portal after aggregation");
requireValue(source.runtimeWorkflow.includes('cron: "7,37 * * * *"'), "runtime smoke test must run twice per hour");
requireValue(source.runtimeWorkflow.includes('default: "15"'), "runtime smoke test batch must default to 15");
requireValue(source.runtimeWorkflow.includes('LIMIT: ${{ inputs.batch_limit || \'15\' }}'), "runtime smoke test input is not wired");
requireValue(source.runtimeWorkflow.includes('CONCURRENCY: "5"'), "runtime smoke test concurrency must be 5");
requireValue(source.runtimeWorkflow.includes('RUNTIME_TIMEOUT_MS: "30000"'), "runtime smoke test timeout must be 30 seconds");
requireValue(source.runtimeWorkflow.includes("npx playwright install --with-deps chromium"), "runtime smoke test must install a pinned browser");
requireValue(source.runtimeWorkflow.includes("Record browser runtime checks"), "runtime results must be committed");
requireValue(source.runtimeWorkflow.includes("runtime-smoke-test"), "runtime results must notify the portal");
requireValue(source.runtimeScript.includes("page.waitForFunction"), "runtime checker must wait for a real canvas");
requireValue(source.runtimeScript.includes("resolveGameUrl(game)"), "runtime checker must combine Pages URL and entryPath");
requireValue(source.runtimeScript.includes("serviceWorkers: \"allow\""), "runtime checker must not disable game service workers");
requireValue(source.runtimeLib.includes("runtimeFailureCount"), "runtime checker must retain transient failure state");
requireValue(!Object.values(source).some((text) => /google-analytics|googletagmanager|gtag\(|matomo|umami|plausible/i.test(text)), "unapproved analytics integration found");
requireValue(![source.prepare, source.bulk].some((text) => text.includes("ANALYTICS_SCRIPT_TAG")), "game source injection must stay disabled");

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Runner validation passed: ${list.length} unique entries, 40/5 batches, bounded repository inspection.`);
}
