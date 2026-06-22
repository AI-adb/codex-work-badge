export type PrivacyMode = "private" | "public";
export type ConfidenceLevel = "verified" | "partial" | "empty";

export type CodexAggregate = {
  periodLabel: string;
  dateRange: {
    from: string | null;
    to: string | null;
  };
  sessions: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  tokens: number;
  activeMinutesEstimate: number;
  confidence: ConfidenceLevel;
  sourceCounts: {
    threads: number;
    rolloutsRead: number;
    missingRollouts: number;
    skippedOutOfScope: number;
    malformedLines: number;
  };
};

export type OutcomeLedgerEntry = {
  date: string;
  label: string;
  bugsResolved: number | null;
  artifactsShipped: number | null;
  gatesPassed: number | null;
  proof: string;
  publicSafe: boolean;
};

export type BadgeChip = {
  label: string;
  value: string;
};

export type BadgeManifest = {
  title: string;
  period: string;
  profileName: string;
  profileSubtitle: string;
  heroMetric: {
    label: string;
    value: string;
  };
  chips: BadgeChip[];
  tier: "Seed" | "Builder" | "Shipper" | "Operator";
  confidenceStrip: string;
  privacyMode: PrivacyMode;
  shareUrl: string;
  caption: string;
  altText: string;
};

export type RolloutAggregate = {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  activeMs: number;
  malformedLines: number;
};

export type ThreadRow = {
  id: string;
  rolloutPath: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  tokensUsed: number;
};
