import fs from "node:fs/promises";

const upstreamUrl = process.env.UPSTREAM_LIST_URL || "https://raw.githubusercontent.com/WebRPG-org/index/main/list.json";
const localPath = process.env.LIST_PATH || "list.json";
const outputPath = process.env.OUTPUT_PATH || "reports/upstream-list-comparison.json";
const [local, upstream] = await Promise.all([
  fs.readFile(localPath, "utf8").then(JSON.parse),
  fetch(upstreamUrl).then(async (response) => { if (!response.ok) throw new Error(`Upstream returned ${response.status}`); return response.json(); }),
]);
if (!Array.isArray(local) || !Array.isArray(upstream)) throw new Error("Both catalogs must be arrays.");
const key = (x) => `${x.owner || ""}/${x.name || ""}`.toLowerCase();
const localByKey = new Map(local.map((x) => [key(x), x]));
const upstreamByKey = new Map(upstream.map((x) => [key(x), x]));
const upstreamOnly = upstream.filter((x) => !localByKey.has(key(x))).map(summary);
const localOnly = local.filter((x) => !upstreamByKey.has(key(x))).map(summary);
const changed = upstream.flatMap((remote) => {
  const ours = localByKey.get(key(remote));
  if (!ours) return [];
  const fields = ["status", "forkName", "pagesUrl", "entryPath", "engine"];
  const differences = Object.fromEntries(fields.filter((name) => String(ours[name] || "") !== String(remote[name] || "")).map((name) => [name, { ours: ours[name] || null, upstream: remote[name] || null }]));
  return Object.keys(differences).length ? [{ sourceRepo: key(remote), differences }] : [];
});
const report = { generatedAt: new Date().toISOString(), upstreamUrl, localTotal: local.length, upstreamTotal: upstream.length, shared: local.length - localOnly.length, upstreamOnly, localOnly, changed };
await fs.mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ localTotal: report.localTotal, upstreamTotal: report.upstreamTotal, shared: report.shared, upstreamOnly: upstreamOnly.length, localOnly: localOnly.length, changed: changed.length }, null, 2));
function summary(x) { return { id: x.id, sourceRepo: key(x), status: x.status || null, forkName: x.forkName || null, pagesUrl: x.pagesUrl || null }; }
