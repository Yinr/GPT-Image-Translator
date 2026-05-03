import type { AspectPadConfig, JobRecord, RetryConfig } from "../shared/types.ts";
import { sleep } from "../shared/time.ts";
import { AttemptStore } from "../storage/attempt-store.ts";
import { JobStore } from "../storage/job-store.ts";
import { OutputStore } from "../storage/output-store.ts";
import { ProcessingMetadataStore } from "../storage/processing-metadata-store.ts";
import { RunStore } from "../storage/run-store.ts";
import { type ImageEditClientLike, runJob } from "./job-runner.ts";

export interface QueueRunnerOptions {
  runId: string;
  prompt: string;
  concurrency: number;
  minDelayMs: number;
  failFast: boolean;
  formatFromApi: boolean;
  outputDir?: string;
  aspectPad?: AspectPadConfig;
  retry: RetryConfig;
  client: ImageEditClientLike;
  runStore: RunStore;
  jobStore: JobStore;
  attemptStore: AttemptStore;
  outputStore: OutputStore;
  processingMetadataStore?: ProcessingMetadataStore;
  onJobStart?: (event: { job: JobRecord; attemptNo: number }) => void | Promise<void>;
  onPreprocessPrepared?: Parameters<typeof runJob>[0]["onPreprocessPrepared"];
  onJobFinish?: (event: {
    job: JobRecord;
    result: Awaited<ReturnType<typeof runJob>>;
  }) => void | Promise<void>;
  onCooldown?: (event: { until: string; delayMs: number; reason: string }) => void | Promise<void>;
  stopRequested?: () => boolean;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export interface QueueRunSummary {
  processed: number;
  succeeded: number;
  retryable: number;
  failed: number;
  stopped: boolean;
  stopReason?: "error" | "interrupted";
}

export async function runQueue(options: QueueRunnerOptions): Promise<QueueRunSummary> {
  const concurrency = Math.max(1, options.concurrency);
  const sleepImpl = options.sleep ?? sleep;
  const summary: QueueRunSummary = {
    processed: 0,
    succeeded: 0,
    retryable: 0,
    failed: 0,
    stopped: false,
  };

  while (!summary.stopped) {
    if (options.stopRequested?.()) {
      summary.stopped = true;
      summary.stopReason = "interrupted";
      break;
    }

    const jobs = options.jobStore.listRunnable(
      options.runId,
      (options.now ?? (() => new Date().toISOString()))(),
      concurrency,
    );
    if (jobs.length === 0) break;

    const results = await Promise.all(jobs.map((job) => runOneJob(job, options, sleepImpl)));

    for (const result of results) {
      if (!result) {
        summary.stopped = true;
        summary.stopReason = "interrupted";
        continue;
      }
      summary.processed += 1;
      summary[result.status] += 1;
      if (result.stopRun || (options.failFast && result.status === "failed")) {
        summary.stopped = true;
        summary.stopReason = "error";
      }
    }

    if (!summary.stopped && options.stopRequested?.()) {
      summary.stopped = true;
      summary.stopReason = "interrupted";
    }

    if (!summary.stopped) {
      await waitForRunCooldown(results, options, sleepImpl);
    }
  }

  options.runStore.updateCounts(options.runId);
  if (summary.stopReason === "interrupted") {
    // Keep the run resumable. Completed in-flight jobs have already persisted their final state.
    options.runStore.updateStatus(options.runId, "running");
  } else if (summary.stopped) {
    options.runStore.updateStatus(
      options.runId,
      "failed",
      (options.now ?? (() => new Date().toISOString()))(),
    );
  } else {
    options.runStore.updateStatus(
      options.runId,
      summary.failed > 0 ? "failed" : "completed",
      (options.now ?? (() => new Date().toISOString()))(),
    );
  }

  return summary;
}

async function runOneJob(
  job: JobRecord,
  options: QueueRunnerOptions,
  sleepImpl: (ms: number) => Promise<void>,
) {
  if (options.minDelayMs > 0) await sleepImpl(options.minDelayMs);
  if (options.stopRequested?.()) return undefined;

  await options.onJobStart?.({ job, attemptNo: job.attempts + 1 });
  const result = await runJob({
    job,
    prompt: options.prompt,
    formatFromApi: options.formatFromApi,
    outputDir: options.outputDir,
    aspectPad: options.aspectPad,
    retry: options.retry,
    client: options.client,
    jobStore: options.jobStore,
    attemptStore: options.attemptStore,
    outputStore: options.outputStore,
    processingMetadataStore: options.processingMetadataStore,
    onPreprocessPrepared: options.onPreprocessPrepared,
    now: options.now,
  });

  await options.onJobFinish?.({ job, result });
  return result;
}

async function waitForRunCooldown(
  results: Array<Awaited<ReturnType<typeof runOneJob>>>,
  options: QueueRunnerOptions,
  sleepImpl: (ms: number) => Promise<void>,
): Promise<void> {
  const now = options.now ?? (() => new Date().toISOString());
  const cooldownUntil = results
    .filter((result) => result?.status === "retryable" && result.nextAttemptAt)
    .map((result) => result!.nextAttemptAt!)
    .sort()
    .at(-1);
  if (!cooldownUntil) return;

  const delayMs = Date.parse(cooldownUntil) - Date.parse(now());
  if (delayMs <= 0) return;

  await options.onCooldown?.({ until: cooldownUntil, delayMs, reason: "retryable_failure" });
  await sleepImpl(delayMs);
}
