import { mapOutputPath } from "../core/path-map.ts";
import { createConfigHash, createRunId } from "../core/run-id.ts";
import { scanImages } from "../core/scanner.ts";
import { createOpenAIImageClient } from "../openai/client.ts";
import { planJobs } from "../queue/job-planner.ts";
import { runQueue } from "../queue/queue-runner.ts";
import { createLogger } from "../logging/logger.ts";
import { nowIso } from "../shared/time.ts";
import type { AppConfig } from "../shared/types.ts";
import { openDatabase } from "../storage/db.ts";
import { AttemptStore } from "../storage/attempt-store.ts";
import { JobStore } from "../storage/job-store.ts";
import { OutputStore } from "../storage/output-store.ts";
import { RunStore } from "../storage/run-store.ts";
import type { ImageEditClientLike } from "../queue/job-runner.ts";

export interface ExecuteOptions {
  config: AppConfig;
  dryRun: boolean;
  log?: (message: string) => void;
  client?: ImageEditClientLike;
}

export interface ExecuteResult {
  runId?: string;
  resumed?: boolean;
  totalImages: number;
  plannedJobs: number;
  processed?: number;
  succeeded?: number;
  retryable?: number;
  failed?: number;
  skipped?: number;
  pending?: number;
  stopped?: boolean;
  failedJobs?: Array<{
    inputPath: string;
    outputPath: string;
    errorType?: string;
    errorMessage?: string;
  }>;
}

export async function execute(options: ExecuteOptions): Promise<ExecuteResult> {
  const log = options.log ?? (() => {});
  log(`Scanning images in ${options.config.inputDir}`);
  const images = await scanImages(options.config.inputDir, options.config.scan);
  log(`Found ${images.length} image(s) to consider.`);

  if (options.dryRun) {
    log(`Dry run enabled. Planned ${images.length} job(s) without sending API requests.`);
    return { totalImages: images.length, plannedJobs: images.length };
  }

  const db = await openDatabase(options.config.storage.sqlitePath);
  try {
    const startedAt = nowIso();
    const runStore = new RunStore(db);
    const jobStore = new JobStore(db);
    const attemptStore = new AttemptStore(db);
    const outputStore = new OutputStore(db);

    const configHash = await createConfigHash(options.config);
    const resumable = options.config.queue.resume ? runStore.findResumable(configHash) : undefined;
    const runId = resumable?.id ?? createRunId();
    const resumed = Boolean(resumable);
    const logger = createLogger({ config: options.config.logging, runId });
    log(
      resumed
        ? `Resuming run ${runId}. concurrency=${options.config.queue.concurrency}, minDelayMs=${options.config.queue.minDelayMs}, formatFromApi=${options.config.output.formatFromApi}`
        : `Starting run ${runId}. concurrency=${options.config.queue.concurrency}, minDelayMs=${options.config.queue.minDelayMs}, formatFromApi=${options.config.output.formatFromApi}`,
    );
    await logger.info(resumed ? "Run resumed" : "Run started", {
      runId,
      inputDir: options.config.inputDir,
      outputDir: options.config.outputDir,
      concurrency: options.config.queue.concurrency,
      minDelayMs: options.config.queue.minDelayMs,
      formatFromApi: options.config.output.formatFromApi,
    });

    if (!resumable) {
      runStore.create({
        id: runId,
        status: "running",
        configHash,
        inputDir: options.config.inputDir,
        outputDir: options.config.outputDir,
        startedAt,
        totalJobs: 0,
        succeededJobs: 0,
        failedJobs: 0,
        skippedJobs: 0,
      });
    } else {
      jobStore.resetRunningJobs(runId, startedAt);
    }

    planJobs(jobStore, {
      runId,
      images,
      outputFor: (image) => {
        const outputPath = mapOutputPath(
          image,
          options.config.outputDir,
          options.config.openai.image.outputFormat,
        ).absolutePath;
        return {
          path: outputPath,
          skip: shouldSkipExisting(outputPath, options.config.output),
        };
      },
      now: startedAt,
    });
    runStore.updateCounts(runId);
    const countsBeforeRun = jobStore.countByStatus(runId);
    const runnableJobs = countsBeforeRun.pending + countsBeforeRun.retryable;
    log(
      `Planned jobs: total=${images.length}, pending=${countsBeforeRun.pending}, retryable=${countsBeforeRun.retryable}, skipped=${countsBeforeRun.skipped}, succeeded=${countsBeforeRun.succeeded}, failed=${countsBeforeRun.failed}`,
    );
    await logger.info("Jobs planned", {
      runId,
      total: images.length,
      pending: countsBeforeRun.pending,
      retryable: countsBeforeRun.retryable,
      skipped: countsBeforeRun.skipped,
      succeeded: countsBeforeRun.succeeded,
      failed: countsBeforeRun.failed,
    });
    if (runnableJobs === 0) {
      log(`No runnable jobs remain for run ${runId}. Marking run as completed.`);
      runStore.updateStatus(runId, "completed", nowIso());
      await logger.info("Run completed with no runnable jobs", { runId });
      return {
        runId,
        resumed,
        totalImages: images.length,
        plannedJobs: images.length,
        processed: 0,
        succeeded: countsBeforeRun.succeeded,
        retryable: countsBeforeRun.retryable,
        failed: countsBeforeRun.failed,
        skipped: countsBeforeRun.skipped,
        pending: countsBeforeRun.pending,
        stopped: false,
        failedJobs: [],
      };
    }

    let startedJobs = 0;
    let finishedJobs = 0;

    const summary = await runQueue({
      runId,
      prompt: options.config.prompt,
      concurrency: options.config.queue.concurrency,
      minDelayMs: options.config.queue.minDelayMs,
      failFast: options.config.queue.failFast,
      formatFromApi: options.config.output.formatFromApi,
      outputDir: options.config.outputDir,
      aspectPad: options.config.preprocess.aspectPad,
      retry: options.config.retry,
      client: options.client ?? createOpenAIImageClient(options.config.openai),
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      onJobStart: async ({ job, attemptNo }) => {
        startedJobs += 1;
        log(`Starting [${startedJobs}/${runnableJobs}] attempt ${attemptNo} for ${job.inputPath}`);
        await logger.info("Job started", {
          runId,
          jobId: job.id,
          attemptNo,
          progress: `${startedJobs}/${runnableJobs}`,
          inputPath: job.inputPath,
          outputPath: job.outputPath,
        });
      },
      onJobFinish: async ({ job, result }) => {
        finishedJobs += 1;
        const duration = formatDuration(result.durationMs);
        if (result.status === "succeeded") {
          log(
            `Completed [${finishedJobs}/${runnableJobs}] ${job.inputPath} -> ${
              result.outputPath ?? job.outputPath
            } in ${duration}`,
          );
          await logger.info("Job completed", {
            runId,
            jobId: job.id,
            progress: `${finishedJobs}/${runnableJobs}`,
            inputPath: job.inputPath,
            outputPath: result.outputPath ?? job.outputPath,
            durationMs: result.durationMs,
          });
          return;
        }

        if (result.status === "retryable") {
          log(
            `Will retry [${finishedJobs}/${runnableJobs}] ${job.inputPath} after ${duration} [${
              result.errorType ?? "unknown"
            }] ${result.errorMessage ?? ""}`.trim(),
          );
          await logger.warn("Job scheduled for retry", {
            runId,
            jobId: job.id,
            progress: `${finishedJobs}/${runnableJobs}`,
            inputPath: job.inputPath,
            durationMs: result.durationMs,
            errorType: result.errorType,
            errorMessage: result.errorMessage,
            nextAttemptAt: result.nextAttemptAt,
          });
          return;
        }

        log(
          `Failed [${finishedJobs}/${runnableJobs}] ${job.inputPath} after ${duration} [${
            result.errorType ?? "unknown"
          }] ${result.errorMessage ?? ""}`.trim(),
        );
        await logger.error("Job failed", {
          runId,
          jobId: job.id,
          progress: `${finishedJobs}/${runnableJobs}`,
          inputPath: job.inputPath,
          durationMs: result.durationMs,
          errorType: result.errorType,
          errorMessage: result.errorMessage,
        });
      },
    });
    const counts = jobStore.countByStatus(runId);
    const failedJobs = jobStore.listFailedByRun(runId).map((job) => ({
      inputPath: job.inputPath,
      outputPath: job.outputPath,
      errorType: job.lastErrorType,
      errorMessage: job.lastErrorMessage,
    }));
    await logger.info(summary.stopped ? "Run stopped" : "Run finished", {
      runId,
      processed: summary.processed,
      succeeded: summary.succeeded,
      retryable: summary.retryable,
      failed: summary.failed,
      skipped: counts.skipped,
      pending: counts.pending,
      stopped: summary.stopped,
    });

    return {
      runId,
      resumed,
      totalImages: images.length,
      plannedJobs: images.length,
      processed: summary.processed,
      succeeded: summary.succeeded,
      retryable: summary.retryable,
      failed: summary.failed,
      skipped: counts.skipped,
      pending: counts.pending,
      stopped: summary.stopped,
      failedJobs,
    };
  } finally {
    db.close();
  }
}

function formatDuration(durationMs: number | undefined): string {
  if (!durationMs || durationMs < 1000) return `${durationMs ?? 0}ms`;

  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

function shouldSkipExisting(outputPath: string, output: AppConfig["output"]): boolean {
  if (output.overwrite) return false;
  if (!output.skipExisting) return false;

  try {
    return Deno.statSync(outputPath).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
