import { createBadgeManifest } from "./badge.ts";
import type { CodexAggregate, OutcomeLedgerEntry } from "./types.ts";

export const zeroAggregate: CodexAggregate = {
  periodLabel: "No scan yet",
  dateRange: {
    from: null,
    to: null
  },
  sessions: 0,
  userMessages: 0,
  assistantMessages: 0,
  toolCalls: 0,
  tokens: 0,
  activeMinutesEstimate: 0,
  activityDays: [],
  confidence: "empty",
  sourceCounts: {
    threads: 0,
    rolloutsRead: 0,
    missingRollouts: 0,
    skippedOutOfScope: 0,
    malformedLines: 0
  }
};

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
  activityDays: [
    { date: "2025-02-24", sessions: 12, messages: 140, toolCalls: 82, tokens: 420000, activeMinutesEstimate: 380 },
    { date: "2025-03-18", sessions: 18, messages: 220, toolCalls: 146, tokens: 760000, activeMinutesEstimate: 620 },
    { date: "2025-05-02", sessions: 22, messages: 310, toolCalls: 208, tokens: 1140000, activeMinutesEstimate: 860 },
    { date: "2025-08-28", sessions: 31, messages: 430, toolCalls: 255, tokens: 1560000, activeMinutesEstimate: 980 },
    { date: "2025-12-04", sessions: 42, messages: 520, toolCalls: 318, tokens: 2100000, activeMinutesEstimate: 1240 },
    { date: "2026-02-21", sessions: 56, messages: 680, toolCalls: 434, tokens: 2680000, activeMinutesEstimate: 1620 },
    { date: "2026-05-12", sessions: 66, messages: 840, toolCalls: 548, tokens: 3380000, activeMinutesEstimate: 1880 },
    { date: "2026-06-18", sessions: 72, messages: 910, toolCalls: 622, tokens: 4180000, activeMinutesEstimate: 2140 },
    { date: "2026-06-19", sessions: 69, messages: 770, toolCalls: 552, tokens: 3490000, activeMinutesEstimate: 1960 },
    { date: "2026-06-20", sessions: 53, messages: 640, toolCalls: 434, tokens: 2690000, activeMinutesEstimate: 1480 },
    { date: "2026-06-21", sessions: 45, messages: 450, toolCalls: 263, tokens: 1280000, activeMinutesEstimate: 2260 }
  ],
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
