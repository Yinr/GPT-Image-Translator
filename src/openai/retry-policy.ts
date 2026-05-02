import type { ApiErrorInfo, RetryConfig, RetryDecision } from "../shared/types.ts";

export function getRetryDecision(
  error: ApiErrorInfo,
  attemptNo: number,
  config: RetryConfig,
): RetryDecision {
  const exhausted = attemptNo >= config.maxAttempts;
  if (!error.retryable || exhausted) {
    return { shouldRetry: false, delayMs: 0, exhausted };
  }

  return {
    shouldRetry: true,
    delayMs: error.retryAfterMs ?? calculateBackoffDelay(attemptNo, config),
    exhausted: false,
  };
}

export function calculateBackoffDelay(attemptNo: number, config: RetryConfig): number {
  const exponent = Math.max(0, attemptNo - 1);
  const delay = config.initialDelayMs * config.backoffFactor ** exponent;
  return Math.min(config.maxDelayMs, Math.round(delay));
}
