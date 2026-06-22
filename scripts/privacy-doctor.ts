import fs from "node:fs";
import path from "node:path";
import { combineAggregateFromThreads } from "../src/core/aggregation.ts";
import { createBadgeManifest } from "../src/core/badge.ts";
import { assertPublicManifestSafe, findForbiddenPublicData } from "../src/core/privacy.ts";
import { readTextIfExists } from "../src/core/nodeSources.ts";
import type { ThreadRow } from "../src/core/types.ts";

const root = process.cwd();
const appRoot = root;
const failures: string[] = [];

function fail(message: string) {
  failures.push(message);
}

function assertFile(relativePath: string) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required file: ${relativePath}`);
}

for (const file of [
  "src/core/aggregation.ts",
  "src/core/badge.ts",
  "src/core/privacy.ts",
  "src-tauri/tauri.conf.json",
  "src-tauri/src/main.rs"
]) {
  assertFile(file);
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

const sourceFiles = walkFiles(path.join(appRoot, "src")).filter((file) => /\.(ts|tsx|css)$/.test(file));

for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (/\bfetch\s*\(|XMLHttpRequest|sendBeacon|navigator\.geolocation/i.test(text)) {
    fail(`Network-capable browser API found in ${path.relative(root, file)}`);
  }
  if (/localStorage|sessionStorage/i.test(text)) {
    fail(`Persistent browser storage found in ${path.relative(root, file)}`);
  }
}

const fixtureRoot = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "codex-badge-doctor-"));
const rolloutPath = path.join(fixtureRoot, "rollout.jsonl");
const fakeOpenAiKey = ["sk", "proj", "abc1234567890"].join("-");
fs.writeFileSync(
  rolloutPath,
  [
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "text", text: `secret ${fakeOpenAiKey} /Users/private/.env` }]
      }
    }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [] } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete", duration_ms: 120000 } })
  ].join("\n"),
  "utf8"
);

const threads: ThreadRow[] = [
  {
    id: "019abcdef-do-not-export",
    rolloutPath,
    createdAtMs: 1780000000000,
    updatedAtMs: 1780000120000,
    tokensUsed: 1000
  }
];

const aggregate = combineAggregateFromThreads(threads, readTextIfExists, (candidate) => candidate.startsWith(fixtureRoot));
const manifest = createBadgeManifest(aggregate, [], "private");

try {
  assertPublicManifestSafe(manifest);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const publicFindings = findForbiddenPublicData({ aggregate, manifest });
if (publicFindings.length) {
  fail(`Doctor aggregate leaked forbidden data: ${publicFindings.join(", ")}`);
}

if (aggregate.userMessages !== 1 || aggregate.assistantMessages !== 1 || aggregate.toolCalls !== 1) {
  fail("Doctor fixture aggregate counts are incorrect.");
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      network: "none detected",
      storage: "no browser persistence detected",
      aggregateFields: Object.keys(aggregate),
      publicManifest: "safe"
    },
    null,
    2
  )
);
