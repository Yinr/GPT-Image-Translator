import type { ImageEditRequest, ImageEditResult, JobRecord, RetryConfig } from "../shared/types.ts";
import { withOutputFormat } from "../fs/output-path.ts";
import { writeImageOutput } from "../fs/writer.ts";
import { ApiError } from "../openai/error-classifier.ts";
import { getRetryDecision } from "../openai/retry-policy.ts";
import { AttemptStore } from "../storage/attempt-store.ts";
import { JobStore } from "../storage/job-store.ts";
import { OutputStore } from "../storage/output-store.ts";

export interface ImageEditClientLike {
  editImage(request: ImageEditRequest): Promise<ImageEditResult>;
}

export interface RunJobOptions {
  job: JobRecord;
  prompt: string;
  formatFromApi: boolean;
  retry: RetryConfig;
  client: ImageEditClientLike;
  jobStore: JobStore;
  attemptStore: AttemptStore;
  outputStore: OutputStore;
  now?: () => string;
}

export interface RunJobResult {
  status: "succeeded" | "retryable" | "failed";
  stopRun: boolean;
  nextAttemptAt?: string;
}

export async function runJob(options: RunJobOptions): Promise<RunJobResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const attemptNo = options.job.attempts + 1;

  options.jobStore.updateStatus({
    id: options.job.id,
    status: "running",
    attempts: attemptNo,
    now: startedAt,
  });

  try {
    const result = await options.client.editImage({
      imagePath: options.job.inputPath,
      prompt: options.prompt,
    });
    const outputPath = options.formatFromApi
      ? withOutputFormat(options.job.outputPath, result.outputFormat)
      : options.job.outputPath;
    await writeImageOutput(outputPath, result.bytes);

    const finishedAt = now();
    options.outputStore.create({
      id: crypto.randomUUID(),
      jobId: options.job.id,
      outputPath,
      outputFormat: result.outputFormat,
      width: result.width,
      height: result.height,
      byteCount: result.byteCount ?? result.bytes.byteLength,
      revisedPrompt: result.revisedPrompt,
      usageJson: result.usage === undefined ? undefined : JSON.stringify(result.usage),
      createdAt: finishedAt,
    });
    options.attemptStore.create({
      id: crypto.randomUUID(),
      jobId: options.job.id,
      attemptNo,
      status: "succeeded",
      durationMs: durationMs(startedAt, finishedAt),
      startedAt,
      finishedAt,
    });
    options.jobStore.updateStatus({
      id: options.job.id,
      status: "succeeded",
      attempts: attemptNo,
      outputPath,
      now: finishedAt,
      completedAt: finishedAt,
    });

    return { status: "succeeded", stopRun: false };
  } catch (error) {
    const finishedAt = now();
    const apiError = normalizeError(error);
    const retryDecision = getRetryDecision(apiError.info, attemptNo, options.retry);
    const status = retryDecision.shouldRetry ? "retryable" : "failed";
    const nextAttemptAt = retryDecision.shouldRetry
      ? new Date(Date.parse(finishedAt) + retryDecision.delayMs).toISOString()
      : undefined;

    options.attemptStore.create({
      id: crypto.randomUUID(),
      jobId: options.job.id,
      attemptNo,
      status,
      httpStatus: apiError.info.status,
      errorType: apiError.info.kind,
      errorMessage: apiError.info.message,
      retryAfterMs: retryDecision.delayMs || undefined,
      durationMs: durationMs(startedAt, finishedAt),
      startedAt,
      finishedAt,
    });
    options.jobStore.updateStatus({
      id: options.job.id,
      status,
      attempts: attemptNo,
      now: finishedAt,
      nextAttemptAt,
      lastErrorType: apiError.info.kind,
      lastErrorMessage: apiError.info.message,
      completedAt: status === "failed" ? finishedAt : undefined,
    });

    return { status, stopRun: apiError.info.stopRun, nextAttemptAt };
  }
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError({
    kind: "unknown_error",
    retryable: false,
    stopRun: false,
    message,
  });
}

function durationMs(startedAt: string, finishedAt: string): number {
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}
