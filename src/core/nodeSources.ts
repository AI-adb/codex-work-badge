import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ThreadRow } from "./types.ts";

export function canonicalPath(value: string): string {
  return fs.realpathSync(value);
}

export function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  try {
    const root = canonicalPath(rootPath);
    const candidate = canonicalPath(candidatePath);
    return candidate === root || candidate.startsWith(`${root}${path.sep}`);
  } catch {
    return false;
  }
}

export function loadThreadRowsFromSqlite(dbPath: string): ThreadRow[] {
  const query = `
    select json_object(
      'id', id,
      'rolloutPath', rollout_path,
      'createdAtMs', created_at_ms,
      'updatedAtMs', updated_at_ms,
      'tokensUsed', tokens_used
    )
    from threads;
  `;
  const output = execFileSync("sqlite3", [dbPath, query], { encoding: "utf8" });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ThreadRow);
}

export function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
