import type { AspectPadConfig, JobRecord, RetryConfig } from "../shared/types.ts";
import { ATTEMPT_STATUS, RUN_STATUS } from "../shared/status.ts";
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
  maxSuccess?: number;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export interface QueueRunSummary {
  processed: number;
  succeeded: number;
  retryable: number;
  failed: number;
  stopped: boolean;
  stopReason?: "error" | "interrupted" | "success_limit";
}

export async function runQueue(options: QueueRunnerOptions): Promise<QueueRunSummary> {
  const concurrency = Math.max(1, options.concurrency);
  const sleepImpl = options.sleep ?? sleep;
  const now = options.now ?? (() => new Date().toISOString());
  const summary: QueueRunSummary = {
    processed: 0,
    succeeded: 0,
    retryable: 0,
    failed: 0,
    stopped: false,
  };
  const inFlight = new Map<string, Promise<void>>();
  const completed: Array<{
    job: JobRecord;
    result: Awaited<ReturnType<typeof runOneJob>>;
  }> = [];
  let cooldownUntil: string | undefined;
  let notifiedCooldownUntil: string | undefined;

  const launchJob = (job: JobRecord) => {
    const promise = runOneJob(job, options, sleepImpl)
      .then((result) => {
        completed.push({ job, result });
      })
      .finally(() => inFlight.delete(job.id));
    inFlight.set(job.id, promise);
  };

  while (true) {
    if (completed.length > 0) {
      await Promise.resolve();
      processCompleted(completed.splice(0), summary, options, (until) => {
        cooldownUntil = latestIso(cooldownUntil, until);
      });
      continue;
    }

    if (options.stopRequested?.()) {
      summary.stopped = true;
      summary.stopReason = "interrupted";
    }

    if (!summary.stopped && reachedSuccessLimit(summary, options.maxSuccess, inFlight.size)) {
      summary.stopped = true;
      summary.stopReason = "success_limit";
    }

    if (!summary.stopped) {
      const cooldownDelayMs = cooldownDelay(cooldownUntil, now());
      if (cooldownDelayMs > 0) {
        if (notifiedCooldownUntil !== cooldownUntil) {
          notifiedCooldownUntil = cooldownUntil;
          await options.onCooldown?.({
            until: cooldownUntil!,
            delayMs: cooldownDelayMs,
            reason: "retryable_failure",
          });
        }
        const cooldownWait = sleepImpl(cooldownDelayMs).then(() => "cooldown" as const);
        if (inFlight.size === 0) {
          await cooldownWait;
          cooldownUntil = undefined;
          notifiedCooldownUntil = undefined;
        } else {
          const winner = await Promise.race([cooldownWait, Promise.race(inFlight.values())]);
          if (winner === "cooldown") {
            cooldownUntil = undefined;
            notifiedCooldownUntil = undefined;
          }
        }
        continue;
      }

      let launched = false;
      while (inFlight.size < concurrency) {
        if (!canLaunchAnotherJob(summary, options.maxSuccess, inFlight.size)) break;
        const job = nextRunnableJob(options, now(), concurrency, inFlight);
        if (!job) break;
        launchJob(job);
        launched = true;
      }

      if (!launched && inFlight.size === 0) break;
    }

    if (inFlight.size === 0) break;
    await Promise.race(inFlight.values());
  }

  options.runStore.updateCounts(options.runId);
  if (summary.stopReason === "interrupted" || summary.stopReason === "success_limit") {
    // Keep the run resumable. Completed in-flight jobs have already persisted their final state.
    options.runStore.updateStatus(options.runId, RUN_STATUS.running);
  } else if (summary.stopped) {
    options.runStore.updateStatus(
      options.runId,
      RUN_STATUS.failed,
      (options.now ?? (() => new Date().toISOString()))(),
    );
  } else {
    options.runStore.updateStatus(
      options.runId,
      summary.failed > 0 ? RUN_STATUS.failed : RUN_STATUS.completed,
      (options.now ?? (() => new Date().toISOString()))(),
    );
  }

  return summary;
}

function processCompleted(
  completions: Array<{
    job: JobRecord;
    result: Awaited<ReturnType<typeof runOneJob>>;
  }>,
  summary: QueueRunSummary,
  options: QueueRunnerOptions,
  setCooldownUntil: (until: string) => void,
): void {
  for (const { result } of completions) {
    if (!result) {
      summary.stopped = true;
      summary.stopReason = "interrupted";
      continue;
    }
    summary.processed += 1;
    summary[result.status] += 1;
    if (result.status === ATTEMPT_STATUS.retryable && result.nextAttemptAt) {
      setCooldownUntil(result.nextAttemptAt);
    }
    if (result.stopRun || (options.failFast && result.status === ATTEMPT_STATUS.failed)) {
      summary.stopped = true;
      summary.stopReason = "error";
    }
  }
}

function reachedSuccessLimit(
  summary: QueueRunSummary,
  maxSuccess: number | undefined,
  inFlightCount: number,
): boolean {
  return maxSuccess !== undefined && maxSuccess > 0 && inFlightCount === 0 &&
    summary.succeeded >= maxSuccess;
}

function canLaunchAnotherJob(
  summary: QueueRunSummary,
  maxSuccess: number | undefined,
  inFlightCount: number,
): boolean {
  return maxSuccess === undefined || maxSuccess <= 0 ||
    summary.succeeded + inFlightCount < maxSuccess;
}

function nextRunnableJob(
  options: QueueRunnerOptions,
  now: string,
  concurrency: number,
  inFlight: Map<string, Promise<void>>,
): JobRecord | undefined {
  return options.jobStore
    .listRunnable(options.runId, now, concurrency + inFlight.size + 1)
    .find((job) => !inFlight.has(job.id));
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

function latestIso(current: string | undefined, next: string): string {
  if (!current) return next;
  return Date.parse(next) > Date.parse(current) ? next : current;
}

function cooldownDelay(until: string | undefined, now: string): number {
  if (!until) return 0;
  return Math.max(0, Date.parse(until) - Date.parse(now));
}
