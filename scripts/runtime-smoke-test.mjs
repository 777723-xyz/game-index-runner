import fs from "node:fs/promises";
import { chromium } from "playwright";
import { applyRuntimeResults, resolveGameUrl, selectRuntimeTargets } from "./runtime-smoke-lib.mjs";

const listPath = process.env.LIST_PATH || "list.json";
const limit = boundedInteger(process.env.LIMIT, 1, 40, 15);
const concurrency = boundedInteger(process.env.CONCURRENCY, 1, 5, 5);
const timeoutMs = boundedInteger(process.env.RUNTIME_TIMEOUT_MS, 5_000, 45_000, 30_000);
const retryCooldownHours = boundedInteger(process.env.RETRY_COOLDOWN_HOURS, 1, 168, 6);
const revalidateAfterHours = boundedInteger(process.env.REVALIDATE_AFTER_HOURS, 1, 720, 168);
const dryRun = /^(1|true|yes)$/i.test(process.env.DRY_RUN || "false");
const gameIds = (process.env.GAME_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);

const list = JSON.parse(await fs.readFile(listPath, "utf8"));
if (!Array.isArray(list)) throw new Error("list.json must be an array");
const targets = selectRuntimeTargets(list, {
  limit,
  retryCooldownHours,
  revalidateAfterHours,
  gameIds,
});

if (targets.length === 0) {
  console.log("No runtime targets are due.");
  await writeOutput({ changed: false, checked: 0, results: [] });
  process.exit(0);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage"],
});
const results = new Array(targets.length);
let cursor = 0;

await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
  while (true) {
    const index = cursor++;
    if (index >= targets.length) return;
    results[index] = await checkGame(browser, targets[index]);
  }
}));
await browser.close();

const updated = applyRuntimeResults(list, results);
const changed = JSON.stringify(updated) !== JSON.stringify(list);
if (changed && !dryRun) await fs.writeFile(listPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

const summary = {
  changed,
  checked: results.length,
  playable: results.filter((result) => result.ok).length,
  failedOrUnknown: results.filter((result) => !result.ok).length,
  targets: results,
  dryRun,
};
console.log(JSON.stringify(summary, null, 2));
await writeOutput(summary);

async function checkGame(browser, game) {
  const startedAt = Date.now();
  const errors = [];
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  let httpStatus;
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (errors.length < 8) errors.push(`request: ${request.url()} ${request.failure()?.errorText || "failed"}`);
  });

  try {
    const response = await page.goto(resolveGameUrl(game), {
      waitUntil: "domcontentloaded",
      timeout: Math.min(timeoutMs, 15_000),
    }).catch((error) => {
      errors.push(`navigation: ${error.message}`);
      return null;
    });
    httpStatus = response?.status();
    const remaining = Math.max(500, timeoutMs - (Date.now() - startedAt));
    await page.waitForFunction(() => [...document.querySelectorAll("canvas")].some((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0;
    }), undefined, { timeout: remaining, polling: 250 });
    const loadMs = Date.now() - startedAt;
    return {
      id: game.id,
      ok: true,
      checkedAt: new Date().toISOString(),
      loadMs,
      httpStatus,
    };
  } catch (error) {
    const message = errors.concat(error?.message || "Canvas did not become ready").join(" | ");
    return {
      id: game.id,
      ok: false,
      checkedAt: new Date().toISOString(),
      loadMs: Date.now() - startedAt,
      httpStatus,
      error: message,
    };
  } finally {
    await context.close();
  }
}

async function writeOutput(summary) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  await fs.appendFile(output, `changed=${summary.changed ? "true" : "false"}\nchecked=${summary.checked}\n`);
}

function boundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
