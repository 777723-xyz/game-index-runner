import fs from "node:fs/promises";
import { publishGeneratedFile } from "./generated-file-publisher-lib.mjs";

const generatedPath = required("GENERATED_PATH");
const basePath = process.env.BASE_PATH || "";
const result = await publishGeneratedFile({
  token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  repository: process.env.GITHUB_REPOSITORY,
  branch: process.env.TARGET_BRANCH || "main",
  targetPath: required("TARGET_PATH"),
  generatedContent: await fs.readFile(generatedPath, "utf8"),
  baseContent: basePath ? await fs.readFile(basePath, "utf8") : undefined,
  mergeMode: process.env.MERGE_MODE || "replace",
  commitMessage: required("COMMIT_MESSAGE"),
  maxAttempts: boundedInteger(process.env.MAX_ATTEMPTS, 1, 10, 5),
  onAttempt(event) {
    if (event.phase === "retry") console.warn(`Concurrent update detected on attempt ${event.attempt}; retrying from the latest SHA.`);
  },
});

console.log(JSON.stringify(result, null, 2));
if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, [
    `changed=${result.changed ? "true" : "false"}`,
    `attempts=${result.attempts}`,
    `conflicts=${result.conflicts || 0}`,
    `commit_sha=${result.commitSha || ""}`,
    "",
  ].join("\n"));
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
