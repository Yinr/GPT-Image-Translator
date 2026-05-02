import type { JobRecord, RetryConfig } from "../shared/types.ts";
import { sleep } from "../shared/time.ts";
import { AttemptStore } from "../storage/attempt-store.ts";
import { JobStore } from "../storage/job-store.ts";
import { OutputStore } from "../storage/output-store.ts";
import { RunStore } from "../storage/run-store.ts";
import { type ImageEditClientLike, runJob } from "./job-runner.ts";

export interface QueueRunnerOptions {
  runId: string;
  prompt: string;
  concurrency: number;
  minDelayMs: number;
  failFast: boolean;
  formatFromApi: boolean;
  retry: RetryConfig;
  client: ImageEditClientLike;
  runStore: RunStore;
  jobStore: JobStore;
  attemptStore: AttemptStore;
  outputStore: OutputStore;
  onJobStart?: (event: { job: JobRecord; attemptNo: number }) => void | Promise<void>;
  onJobFinish?: (event: {
    job: JobRecord;
    result: Awaited<ReturnType<typeof runJob>>;
  }) => void | Promise<void>;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export interface QueueRunSummary {
  processed: number;
  succeeded: number;
  retryable: number;
  failed: number;
  stopped: boolean;
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
    const jobs = options.jobStore.listRunnable(
      options.runId,
      (options.now ?? (() => new Date().toISOString()))(),
      concurrency,
    );
    if (jobs.length === 0) break;

    const results = await Promise.all(jobs.map((job) => runOneJob(job, options, sleepImpl)));

    for (const result of results) {
      summary.processed += 1;
      summary[result.status] += 1;
      if (result.stopRun || (options.failFast && result.status === "failed")) {
        summary.stopped = true;
      }
    }
  }

  options.runStore.updateCounts(options.runId);
  if (summary.stopped) {
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

  await options.onJobStart?.({ job, attemptNo: job.attempts + 1 });
  const result = await runJob({
    job,
    prompt: options.prompt,
    formatFromApi: options.formatFromApi,
    retry: options.retry,
    client: options.client,
    jobStore: options.jobStore,
    attemptStore: options.attemptStore,
    outputStore: options.outputStore,
    now: options.now,
  });

  await options.onJobFinish?.({ job, result });
  return result;
}
