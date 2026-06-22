import type { BadgeManifest } from "./types";

const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "absolute macOS path", pattern: /\/Users\/[A-Za-z0-9._ -]+\/[^\s"'<>]+/ },
  { label: "environment file", pattern: /\.env(?:\b|[._-])/i },
  { label: "OpenAI key", pattern: /sk-(?:proj|live|test)?-[A-Za-z0-9_-]{12,}/i },
  { label: "Shopify token", pattern: /shpat_[A-Za-z0-9_]{12,}|shp[a-z]_[A-Za-z0-9_]{12,}/i },
  { label: "bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{12,}/i },
  { label: "email", pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { label: "thread id", pattern: /\b019[a-f0-9]{5,}-[a-f0-9-]{20,}\b/i },
  { label: "store identity", pattern: /\b[a-z0-9-]+\.myshopify\.com\b/i }
];

export function findForbiddenPublicData(value: unknown): string[] {
  const text = JSON.stringify(value);
  return FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

export function assertPublicManifestSafe(manifest: BadgeManifest) {
  const findings = findForbiddenPublicData(manifest);
  if (findings.length) {
    throw new Error(`BadgeManifest contains forbidden public data: ${findings.join(", ")}`);
  }
}

export function stripDangerousText(value: string): string {
  let safe = value;
  for (const { pattern } of FORBIDDEN_PATTERNS) {
    safe = safe.replace(pattern, "[private]");
  }
  return safe;
}
