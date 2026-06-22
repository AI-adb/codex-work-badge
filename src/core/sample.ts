import { createBadgeManifest } from "./badge.ts";
import type { CodexAggregate, OutcomeLedgerEntry } from "./types.ts";

export const sampleAggregate: CodexAggregate = {
  periodLabel: "2025-02-24 to 2026-06-21",
  dateRange: {
    from: "2025-02-24",
    to: "2026-06-21"
  },
  sessions: 486,
  userMessages: 2184,
  assistantMessages: 3017,
  toolCalls: 3312,
  tokens: 18400000,
  activeMinutesEstimate: 15420,
  confidence: "verified",
  sourceCounts: {
    threads: 18,
    rolloutsRead: 18,
    missingRollouts: 0,
    skippedOutOfScope: 0,
    malformedLines: 0
  }
};

export const sampleOutcomes: OutcomeLedgerEntry[] = [
  {
    date: "2026-06-21",
    label: "Local launch tranche",
    bugsResolved: 19,
    artifactsShipped: 37,
    gatesPassed: 142,
    proof: "Local verifier pass",
    publicSafe: true
  }
];

export const sampleBadgeManifest = createBadgeManifest(sampleAggregate, sampleOutcomes);
