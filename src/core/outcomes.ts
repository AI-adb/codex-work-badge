import { stripDangerousText } from "./privacy.ts";
import type { OutcomeLedgerEntry } from "./types.ts";

export function parseOutcomeLedgerJsonl(text: string): OutcomeLedgerEntry[] {
  const entries: OutcomeLedgerEntry[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    entries.push({
      date: String(record.date || ""),
      label: stripDangerousText(String(record.artifact || record.objective || "Verified outcome")),
      bugsResolved: typeof record.bugsResolved === "number" ? record.bugsResolved : null,
      artifactsShipped: typeof record.artifactsShipped === "number" ? record.artifactsShipped : null,
      gatesPassed: typeof record.gatesPassed === "number" ? record.gatesPassed : null,
      proof: stripDangerousText(String(record.proof || "")),
      publicSafe: record.publicSafe === true
    });
  }

  return entries;
}
