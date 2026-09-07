export type PublicSourceState =
  | "healthy"
  | "empty"
  | "stale"
  | "malformed"
  | "blocked"
  | "failed";

export type PublicSourceHealth = {
  source: string;
  state: PublicSourceState;
  checkedAt: string;
  lastSuccessAt?: string;
  rows: number;
  consecutiveFailures: number;
  reason?: string;
};

const sourceHealth = new Map<string, PublicSourceHealth>();

function failureReason(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  const message = error instanceof Error ? error.message : "unknown";
  const status = message.match(/\b(?:returned|provider)\s+(\d{3})\b/i)?.[1];
  if (status === "403" || status === "429") return `http_${status}`;
  if (status) return `http_${status}`;
  if (/json|parse|token|payload|response/i.test(message)) return "malformed_response";
  return "request_failed";
}

export function recordPublicSourceHealth(
  source: string,
  state: PublicSourceState,
  rows = 0,
  reason?: string
) {
  const previous = sourceHealth.get(source);
  const checkedAt = new Date().toISOString();
  const healthy = state === "healthy";
  const next: PublicSourceHealth = {
    source,
    state,
    checkedAt,
    lastSuccessAt: healthy ? checkedAt : previous?.lastSuccessAt,
    rows,
    consecutiveFailures: healthy ? 0 : (previous?.consecutiveFailures ?? 0) + 1,
    reason
  };

  sourceHealth.set(source, next);

  if (!healthy && (previous?.state !== state || next.consecutiveFailures === 1)) {
    // Public-source diagnostics only. Never pass request bodies or upstream payloads here.
    console.warn(
      "[ipo-source-health]",
      JSON.stringify({
        source,
        state,
        reason,
        rows,
        consecutiveFailures: next.consecutiveFailures,
        checkedAt
      })
    );
  } else if (healthy && previous && previous.state !== "healthy") {
    console.info(
      "[ipo-source-health]",
      JSON.stringify({ source, state, rows, checkedAt })
    );
  }
}

export async function observePublicSource<T>(
  source: string,
  request: () => Promise<T>,
  rowCount: (value: T) => number,
  emptyState: PublicSourceState = "empty"
) {
  try {
    const value = await request();
    const rows = Math.max(0, rowCount(value));
    recordPublicSourceHealth(source, rows ? "healthy" : emptyState, rows);
    return value;
  } catch (error) {
    const reason = failureReason(error);
    recordPublicSourceHealth(
      source,
      reason === "http_403" || reason === "http_429" ? "blocked" : "failed",
      0,
      reason
    );
    throw error;
  }
}

export function assessPublicSourceFreshness(
  source: string,
  rows: number,
  updatedValues: Array<string | undefined>,
  maxAgeMs = 36 * 60 * 60 * 1000
) {
  const newest = Math.max(
    0,
    ...updatedValues.map((value) => {
      const timestamp = value ? new Date(value).getTime() : 0;
      return Number.isFinite(timestamp) ? timestamp : 0;
    })
  );

  if (rows > 0 && newest > 0 && Date.now() - newest > maxAgeMs) {
    recordPublicSourceHealth(source, "stale", rows, "update_timestamp_stale");
  }
}

export function getPublicSourceHealthSnapshot() {
  return Array.from(sourceHealth.values()).map((entry) => ({ ...entry }));
}
