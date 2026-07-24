const OWN_PAGES_HOST = "777723-xyz.github.io";
const DEFAULT_RETRY_COOLDOWN_HOURS = 6;
const DEFAULT_REVALIDATE_AFTER_HOURS = 168;

export function selectRuntimeTargets(list, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const limit = clampInteger(options.limit, 1, 40, 15);
  const retryCooldownMs = clampInteger(options.retryCooldownHours, 1, 168, DEFAULT_RETRY_COOLDOWN_HOURS) * 3_600_000;
  const revalidateAfterMs = clampInteger(options.revalidateAfterHours, 1, 720, DEFAULT_REVALIDATE_AFTER_HOURS) * 3_600_000;
  const ids = new Set((options.gameIds || []).map((id) => String(id).trim()).filter(Boolean));

  return (Array.isArray(list) ? list : [])
    .filter((entry) => entry?.status === "verified" && isOwnPagesUrl(entry.pagesUrl))
    .filter((entry) => ids.size === 0 || ids.has(String(entry.id)))
    .map((entry) => ({ entry, priority: targetPriority(entry, now, retryCooldownMs, revalidateAfterMs) }))
    .filter((item) => item.priority !== null)
    .sort((left, right) => left.priority - right.priority
      || Date.parse(left.entry.runtimeCheckedAt || "") - Date.parse(right.entry.runtimeCheckedAt || "")
      || String(left.entry.id).localeCompare(String(right.entry.id), "en"))
    .slice(0, limit)
    .map((item) => item.entry);
}

export function applyRuntimeResults(list, results, now = new Date()) {
  const byId = new Map((Array.isArray(results) ? results : []).map((result) => [String(result.id), result]));
  const checkedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  return (Array.isArray(list) ? list : []).map((entry) => {
    const result = byId.get(String(entry.id));
    if (!result) return entry;
    if (result.ok) {
      return clean({
        ...entry,
        runtimeStatus: "playable",
        runtimeCheckedAt: result.checkedAt || checkedAt,
        runtimeLoadMs: finiteNumber(result.loadMs),
        runtimeHttpStatus: finiteNumber(result.httpStatus),
        runtimeFailureCount: undefined,
        runtimeLastError: undefined,
      });
    }

    const failures = (Number(entry.runtimeFailureCount) || 0) + 1;
    const hardFailure = Number(result.httpStatus) >= 400 && Number(result.httpStatus) < 500;
    const status = hardFailure || failures >= 2 ? "failed" : entry.runtimeStatus;
    return clean({
      ...entry,
      ...(status ? { runtimeStatus: status } : {}),
      runtimeCheckedAt: result.checkedAt || checkedAt,
      runtimeLoadMs: finiteNumber(result.loadMs),
      runtimeHttpStatus: finiteNumber(result.httpStatus),
      runtimeFailureCount: failures,
      runtimeLastError: truncate(result.error || "Canvas did not become ready"),
    });
  });
}

export function isOwnPagesUrl(value) {
  try { return new URL(value).hostname === OWN_PAGES_HOST; } catch { return false; }
}

export function resolveGameUrl(game) {
  const base = new URL(game.pagesUrl);
  const entry = String(game.entryPath || "index.html").replace(/^\/+/, "");
  let decodedPath = base.pathname;
  try { decodedPath = decodeURIComponent(base.pathname); } catch { /* keep encoded path */ }
  if (/\.html?$/i.test(base.pathname) || decodedPath.replace(/^\/+/, "").endsWith(entry)) return base.href;
  const normalized = base.href.endsWith("/") ? base.href : `${base.href}/`;
  return new URL(entry, normalized).href;
}

function targetPriority(entry, now, retryCooldownMs, revalidateAfterMs) {
  const checked = Date.parse(entry.runtimeCheckedAt || "");
  if (!Number.isFinite(checked)) return 0;
  const age = now.getTime() - checked;
  if (Number(entry.runtimeFailureCount) > 0 && age >= retryCooldownMs) return 1;
  if (age >= revalidateAfterMs) return 2;
  return null;
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function truncate(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 500);
}

function clean(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
