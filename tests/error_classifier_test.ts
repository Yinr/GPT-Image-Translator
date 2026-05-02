import { assertEquals } from "@std/assert";
import { classifyFetchError, classifyHttpError } from "../src/openai/error-classifier.ts";

Deno.test("classifyHttpError treats 429 as retryable rate limit", () => {
  const error = classifyHttpError(
    429,
    JSON.stringify({ error: { message: "slow down" } }),
    new Headers({ "retry-after": "2" }),
  );

  assertEquals(error.info.kind, "rate_limit");
  assertEquals(error.info.retryable, true);
  assertEquals(error.info.retryAfterMs, 2000);
});

Deno.test("classifyHttpError treats 401 as stop-run auth error", () => {
  const error = classifyHttpError(
    401,
    JSON.stringify({ error: { message: "bad key" } }),
    new Headers(),
  );

  assertEquals(error.info.kind, "authentication_error");
  assertEquals(error.info.retryable, false);
  assertEquals(error.info.stopRun, true);
});

Deno.test("classifyHttpError treats 500 as retryable server error", () => {
  const error = classifyHttpError(500, "server exploded", new Headers());

  assertEquals(error.info.kind, "server_error");
  assertEquals(error.info.retryable, true);
  assertEquals(error.info.stopRun, false);
});

Deno.test("classifyFetchError treats thrown errors as retryable network errors", () => {
  const error = classifyFetchError(new Error("connection reset"));

  assertEquals(error.info.kind, "network_error");
  assertEquals(error.info.retryable, true);
});
