import { mapOutputPath } from "../core/path-map.ts";
import { createConfigHash, createRunId } from "../core/run-id.ts";
import { scanImages } from "../core/scanner.ts";
import { createOpenAIImageClient } from "../openai/client.ts";
import { planJobs } from "../queue/job-planner.ts";
import { runQueue } from "../queue/queue-runner.ts";
import { nowIso } from "../shared/time.ts";
import type { AppConfig } from "../shared/types.ts";
import { openDatabase } from "../storage/db.ts";
import { AttemptStore } from "../storage/attempt-store.ts";
import { JobStore } from "../storage/job-store.ts";
import { OutputStore } from "../storage/output-store.ts";
import { RunStore } from "../storage/run-store.ts";

export interface ExecuteOptions {
  config: AppConfig;
  dryRun: boolean;
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
  const images = await scanImages(options.config.inputDir, options.config.scan);

  if (options.dryRun) {
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
    if (countsBeforeRun.pending + countsBeforeRun.retryable === 0) {
      runStore.updateStatus(runId, "completed", nowIso());
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

    const summary = await runQueue({
      runId,
      prompt: options.config.prompt,
      concurrency: options.config.queue.concurrency,
      minDelayMs: options.config.queue.minDelayMs,
      failFast: options.config.queue.failFast,
      formatFromApi: options.config.output.formatFromApi,
      retry: options.config.retry,
      client: createOpenAIImageClient(options.config.openai),
      runStore,
      jobStore,
      attemptStore,
      outputStore,
    });
    const counts = jobStore.countByStatus(runId);
    const failedJobs = jobStore.listFailedByRun(runId).map((job) => ({
      inputPath: job.inputPath,
      outputPath: job.outputPath,
      errorType: job.lastErrorType,
      errorMessage: job.lastErrorMessage,
    }));

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
