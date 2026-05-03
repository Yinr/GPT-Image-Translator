import type { ApiErrorInfo } from "../shared/types.ts";

export class ApiError extends Error {
  constructor(readonly info: ApiErrorInfo) {
    super(info.message);
    this.name = "ApiError";
  }
}

export function classifyFetchError(error: unknown): ApiError {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ApiError({
      kind: "timeout",
      retryable: true,
      stopRun: false,
      message: "Request timed out",
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ApiError({
    kind: "network_error",
    retryable: true,
    stopRun: false,
    message,
  });
}

export function classifyHttpError(status: number, body: string, headers: Headers): ApiError {
  const message = extractErrorMessage(body) ?? `HTTP ${status}`;
  const retryAfterMs = parseRetryAfter(headers.get("retry-after"));

  if (status === 200) {
    return new ApiError({
      kind: "invalid_response",
      retryable: false,
      stopRun: false,
      message,
      status,
    });
  }

  if (status === 401) {
    return new ApiError({
      kind: "authentication_error",
      retryable: false,
      stopRun: true,
      message,
      status,
    });
  }

  if (status === 403) {
    return new ApiError({
      kind: "permission_error",
      retryable: false,
      stopRun: true,
      message,
      status,
    });
  }

  if (status === 402) {
    return new ApiError({
      kind: "permission_error",
      retryable: false,
      stopRun: true,
      message,
      status,
    });
  }

  if (status === 429) {
    return new ApiError({
      kind: "rate_limit",
      retryable: true,
      stopRun: false,
      message,
      status,
      retryAfterMs,
    });
  }

  if ([408, 409, 425].includes(status)) {
    return new ApiError({
      kind: "network_error",
      retryable: true,
      stopRun: false,
      message,
      status,
      retryAfterMs,
    });
  }

  if (status >= 500 && status <= 599) {
    return new ApiError({
      kind: "server_error",
      retryable: true,
      stopRun: false,
      message,
      status,
      retryAfterMs,
    });
  }

  if (status === 400) {
    return new ApiError({ kind: "bad_request", retryable: false, stopRun: false, message, status });
  }

  if (status === 404) {
    return new ApiError({ kind: "not_found", retryable: false, stopRun: false, message, status });
  }

  if (status === 422) {
    return new ApiError({
      kind: "unprocessable_entity",
      retryable: false,
      stopRun: false,
      message,
      status,
    });
  }

  return new ApiError({ kind: "unknown_error", retryable: false, stopRun: false, message, status });
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;

  return Math.max(0, dateMs - Date.now());
}

function extractErrorMessage(body: string): string | undefined {
  if (!body.trim()) return undefined;

  try {
    const parsed = JSON.parse(body) as unknown;
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string") {
      return parsed.error.message;
    }
  } catch {
    return body;
  }

  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
