import type { CodexAggregate, RolloutAggregate, ThreadRow } from "./types.ts";

const IDLE_CAP_MS = 10 * 60 * 1000;

function toIsoDate(value: number | null): string | null {
  if (!value || Number.isNaN(value)) return null;
  return new Date(value).toISOString().slice(0, 10);
}

export function parseRolloutJsonl(text: string): RolloutAggregate {
  const aggregate: RolloutAggregate = {
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    activeMs: 0,
    malformedLines: 0
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      aggregate.malformedLines += 1;
      continue;
    }

    if (!event || typeof event !== "object") continue;
    const record = event as { type?: string; payload?: Record<string, unknown> };
    const payload = record.payload || {};

    if (record.type === "response_item") {
      if (payload.type === "message") {
        if (payload.role === "user") aggregate.userMessages += 1;
        if (payload.role === "assistant") aggregate.assistantMessages += 1;
      }

      if (
        payload.type === "function_call" ||
        payload.type === "custom_tool_call" ||
        payload.type === "web_search_call" ||
        payload.type === "image_generation_call" ||
        payload.type === "tool_search_call"
      ) {
        aggregate.toolCalls += 1;
      }
    }

    if (record.type === "event_msg" && payload.type === "task_complete") {
      const duration = Number(payload.duration_ms || 0);
      if (duration > 0) aggregate.activeMs += Math.min(duration, IDLE_CAP_MS);
    }
  }

  return aggregate;
}

export function combineAggregateFromThreads(
  threads: ThreadRow[],
  readRollout: (rolloutPath: string) => string | null,
  isAllowedRolloutPath: (rolloutPath: string) => boolean
): CodexAggregate {
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let activeMs = 0;
  let rolloutsRead = 0;
  let missingRollouts = 0;
  let skippedOutOfScope = 0;
  let malformedLines = 0;
  let tokens = 0;

  const createdValues = threads
    .map((thread) => thread.createdAtMs)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const updatedValues = threads
    .map((thread) => thread.updatedAtMs)
    .filter((value): value is number => typeof value === "number" && value > 0);

  for (const thread of threads) {
    tokens += Math.max(0, thread.tokensUsed || 0);

    if (!isAllowedRolloutPath(thread.rolloutPath)) {
      skippedOutOfScope += 1;
      continue;
    }

    const rolloutText = readRollout(thread.rolloutPath);
    if (rolloutText === null) {
      missingRollouts += 1;
      continue;
    }

    const rollout = parseRolloutJsonl(rolloutText);
    rolloutsRead += 1;
    userMessages += rollout.userMessages;
    assistantMessages += rollout.assistantMessages;
    toolCalls += rollout.toolCalls;
    activeMs += rollout.activeMs;
    malformedLines += rollout.malformedLines;
  }

  const from = createdValues.length ? Math.min(...createdValues) : null;
  const to = updatedValues.length ? Math.max(...updatedValues) : null;
  const confidence =
    threads.length === 0
      ? "empty"
      : missingRollouts || skippedOutOfScope || malformedLines
        ? "partial"
        : "verified";

  return {
    periodLabel: from && to ? `${toIsoDate(from)} to ${toIsoDate(to)}` : "No verified period",
    dateRange: {
      from: toIsoDate(from),
      to: toIsoDate(to)
    },
    sessions: threads.length,
    userMessages,
    assistantMessages,
    toolCalls,
    tokens,
    activeMinutesEstimate: Math.round(activeMs / 60000),
    confidence,
    sourceCounts: {
      threads: threads.length,
      rolloutsRead,
      missingRollouts,
      skippedOutOfScope,
      malformedLines
    }
  };
}
