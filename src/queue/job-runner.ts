import { join, relative } from "@std/path";
import type {
  AspectPadConfig,
  ImageEditRequest,
  ImageEditResult,
  JobRecord,
  RetryConfig,
} from "../shared/types.ts";
import { cropApiOutputToOriginal, prepareAspectPaddedImage } from "../core/image-preprocessor.ts";
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
  aspectPad?: AspectPadConfig;
  outputDir?: string;
  now?: () => string;
}

export interface RunJobResult {
  status: "succeeded" | "retryable" | "failed";
  stopRun: boolean;
  durationMs: number;
  nextAttemptAt?: string;
  outputPath?: string;
  errorType?: string;
  errorMessage?: string;
}

interface PreparedAttempt {
  imagePath: string;
  size?: ImageEditRequest["size"];
  cropBack?: (bytes: Uint8Array) => Promise<Uint8Array>;
  uncroppedOutputPath?: string;
  cleanup: () => Promise<void>;
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
    const prepared = await prepareAttempt(options);
    let result: ImageEditResult;
    try {
      result = await options.client.editImage({
        imagePath: prepared.imagePath,
        prompt: options.prompt,
        size: prepared.size,
      });
    } finally {
      await prepared.cleanup();
    }
    const outputPath = options.formatFromApi
      ? withOutputFormat(options.job.outputPath, result.outputFormat)
      : options.job.outputPath;
    const outputBytes = prepared.cropBack ? await prepared.cropBack(result.bytes) : result.bytes;
    if (prepared.uncroppedOutputPath) {
      await writeImageOutput(prepared.uncroppedOutputPath, result.bytes);
    }
    await writeImageOutput(outputPath, outputBytes);

    const finishedAt = now();
    options.outputStore.create({
      id: crypto.randomUUID(),
      jobId: options.job.id,
      outputPath,
      outputFormat: result.outputFormat,
      width: result.width,
      height: result.height,
      byteCount: outputBytes.byteLength,
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

    return {
      status: "succeeded",
      stopRun: false,
      durationMs: durationMs(startedAt, finishedAt),
      outputPath,
    };
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

    return {
      status,
      stopRun: apiError.info.stopRun,
      durationMs: durationMs(startedAt, finishedAt),
      nextAttemptAt,
      errorType: apiError.info.kind,
      errorMessage: apiError.info.message,
    };
  }
}

async function prepareAttempt(options: RunJobOptions): Promise<PreparedAttempt> {
  if (!options.aspectPad?.enabled) {
    return {
      imagePath: options.job.inputPath,
      cleanup: () => Promise.resolve(),
    };
  }

  if (options.aspectPad.cropBackToOriginal && !options.outputDir) {
    throw new Error("outputDir is required when aspectPad.cropBackToOriginal is enabled");
  }

  const prepared = await prepareAspectPaddedImage({
    inputPath: options.job.inputPath,
    outputPath: options.job.outputPath,
    fill: options.aspectPad.fill,
  });

  return {
    imagePath: prepared.imagePath,
    size: prepared.plan.apiSize,
    cropBack: options.aspectPad.cropBackToOriginal
      ? (bytes) => cropApiOutputToOriginal({ apiOutputBytes: bytes, plan: prepared.plan })
      : undefined,
    uncroppedOutputPath: options.aspectPad.cropBackToOriginal
      ? intermediateOutputPath(
        options.outputDir!,
        options.aspectPad.intermediateDir,
        options.job.outputPath,
      )
      : undefined,
    cleanup: prepared.cleanup,
  };
}

function intermediateOutputPath(
  outputDir: string,
  intermediateDir: string,
  outputPath: string,
): string {
  return join(outputDir, intermediateDir, relative(outputDir, outputPath));
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
