import { assertEquals } from "@std/assert";
import { calculateBackoffDelay, getRetryDecision } from "../src/openai/retry-policy.ts";
import type { ApiErrorInfo, RetryConfig } from "../src/shared/types.ts";

const config: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 10_000,
  backoffFactor: 2,
};

Deno.test("calculateBackoffDelay applies exponential backoff", () => {
  assertEquals(calculateBackoffDelay(1, config), 1000);
  assertEquals(calculateBackoffDelay(2, config), 2000);
  assertEquals(calculateBackoffDelay(4, config), 8000);
});

Deno.test("calculateBackoffDelay caps at max delay", () => {
  assertEquals(calculateBackoffDelay(10, config), 10_000);
});

Deno.test("getRetryDecision honors retry-after", () => {
  const error: ApiErrorInfo = {
    kind: "rate_limit",
    retryable: true,
    stopRun: false,
    message: "slow down",
    retryAfterMs: 3000,
  };

  assertEquals(getRetryDecision(error, 1, config), {
    shouldRetry: true,
    delayMs: 3000,
    exhausted: false,
  });
});

Deno.test("getRetryDecision stops after max attempts", () => {
  const error: ApiErrorInfo = {
    kind: "server_error",
    retryable: true,
    stopRun: false,
    message: "server error",
  };

  assertEquals(getRetryDecision(error, 5, config), {
    shouldRetry: false,
    delayMs: 0,
    exhausted: true,
  });
});
