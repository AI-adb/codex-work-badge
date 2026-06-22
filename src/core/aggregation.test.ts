import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { combineAggregateFromThreads, parseRolloutJsonl } from "./aggregation";
import { isPathInsideRoot, loadThreadRowsFromSqlite, readTextIfExists } from "./nodeSources";

const messageLine = (role: "user" | "assistant", content = "secret text should never be retained") =>
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: "text", text: content }]
    }
  });

it("counts rollout metadata without retaining content", () => {
  const fakeOpenAiKey = ["sk", "proj", "not-retained-example"].join("-");
  const parsed = parseRolloutJsonl([
    messageLine("user", fakeOpenAiKey),
    messageLine("assistant"),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "exec_command" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete", duration_ms: 999999 } }),
    "{bad json"
  ].join("\n"));

  expect(parsed.userMessages).toBe(1);
  expect(parsed.assistantMessages).toBe(1);
  expect(parsed.toolCalls).toBe(1);
  expect(parsed.activeMs).toBe(600000);
  expect(parsed.malformedLines).toBe(1);
  expect(JSON.stringify(parsed)).not.toContain(fakeOpenAiKey);
});

it("combines only rollout files inside the selected root", () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-badge-root-"));
  const outside = mkdtempSync(path.join(tmpdir(), "codex-badge-outside-"));
  const insideRollout = path.join(root, "rollout.jsonl");
  const outsideRollout = path.join(outside, "rollout.jsonl");
  writeFileSync(insideRollout, `${messageLine("user")}\n${messageLine("assistant")}\n`, "utf8");
  writeFileSync(outsideRollout, messageLine("user"), "utf8");

  const aggregate = combineAggregateFromThreads(
    [
      { id: "a", rolloutPath: insideRollout, createdAtMs: 1780000000000, updatedAtMs: 1780000100000, tokensUsed: 50 },
      { id: "b", rolloutPath: outsideRollout, createdAtMs: 1780000200000, updatedAtMs: 1780000300000, tokensUsed: 50 }
    ],
    readTextIfExists,
    (rolloutPath) => isPathInsideRoot(rolloutPath, root)
  );

  expect(aggregate.sessions).toBe(2);
  expect(aggregate.sourceCounts.rolloutsRead).toBe(1);
  expect(aggregate.sourceCounts.skippedOutOfScope).toBe(1);
  expect(aggregate.userMessages).toBe(1);
  expect(aggregate.assistantMessages).toBe(1);
  expect(aggregate.tokens).toBe(100);
  expect(aggregate.activityDays).toEqual([
    {
      date: "2026-05-28",
      sessions: 2,
      messages: 2,
      toolCalls: 0,
      tokens: 100,
      activeMinutesEstimate: 0
    }
  ]);
  expect(aggregate.confidence).toBe("partial");
});

it("loads thread rows from a sqlite fixture when sqlite3 is available", () => {
  const sqliteAvailable = spawnSync("sqlite3", ["--version"], { encoding: "utf8" }).status === 0;
  if (!sqliteAvailable) {
    expect(sqliteAvailable).toBe(false);
    return;
  }

  const root = mkdtempSync(path.join(tmpdir(), "codex-badge-sqlite-"));
  const db = path.join(root, "state_5.sqlite");
  const escapedRoot = root.replaceAll("'", "''");
  const sql = `
    create table threads (
      id text primary key,
      rollout_path text not null,
      created_at_ms integer,
      updated_at_ms integer,
      tokens_used integer not null default 0
    );
    insert into threads values ('thread-a', '${escapedRoot}/rollout.jsonl', 1780000000000, 1780000100000, 123);
  `;
  const result = spawnSync("sqlite3", [db], { input: sql, encoding: "utf8" });
  expect(result.status).toBe(0);

  const rows = loadThreadRowsFromSqlite(db);
  expect(rows).toEqual([
    {
      id: "thread-a",
      rolloutPath: `${root}/rollout.jsonl`,
      createdAtMs: 1780000000000,
      updatedAtMs: 1780000100000,
      tokensUsed: 123
    }
  ]);
});
