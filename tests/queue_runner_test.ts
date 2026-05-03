import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runQueue } from "../src/queue/queue-runner.ts";
import type { ImageEditClientLike } from "../src/queue/job-runner.ts";
import { ApiError } from "../src/openai/error-classifier.ts";
import { openMemoryDatabase } from "../src/storage/db.ts";
import { RunStore } from "../src/storage/run-store.ts";
import { JobStore } from "../src/storage/job-store.ts";
import { AttemptStore } from "../src/storage/attempt-store.ts";
import { OutputStore } from "../src/storage/output-store.ts";

Deno.test("runQueue processes runnable jobs and updates run status", async () => {
  const db = openMemoryDatabase();
  try {
    const runStore = new RunStore(db);
    const jobStore = new JobStore(db);
    const attemptStore = new AttemptStore(db);
    const outputStore = new OutputStore(db);
    const outputDir = await Deno.makeTempDir();
    const now = "2026-05-01T00:00:00.000Z";

    runStore.create({
      id: "run-1",
      status: "running",
      configHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    jobStore.upsert({
      id: "job-1",
      runId: "run-1",
      inputPath: "a",
      outputPath: join(outputDir, "a.png"),
      now,
    });
    jobStore.upsert({
      id: "job-2",
      runId: "run-1",
      inputPath: "b",
      outputPath: join(outputDir, "b.png"),
      now,
    });

    const client: ImageEditClientLike = {
      editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
    };
    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 2,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => Promise.resolve(),
    });

    const run = runStore.get("run-1");

    assertEquals(summary.processed, 2);
    assertEquals(summary.succeeded, 2);
    assertEquals(run?.status, "completed");
    assertEquals(run?.succeededJobs, 2);
  } finally {
    db.close();
  }
});

Deno.test("runQueue stops after current job when graceful stop is requested", async () => {
  const db = openMemoryDatabase();
  try {
    const runStore = new RunStore(db);
    const jobStore = new JobStore(db);
    const attemptStore = new AttemptStore(db);
    const outputStore = new OutputStore(db);
    const outputDir = await Deno.makeTempDir();
    const now = "2026-05-01T00:00:00.000Z";
    let stopRequested = false;

    runStore.create({
      id: "run-1",
      status: "running",
      configHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    jobStore.upsert({
      id: "job-1",
      runId: "run-1",
      inputPath: "a",
      outputPath: join(outputDir, "a.png"),
      now,
    });
    jobStore.upsert({
      id: "job-2",
      runId: "run-1",
      inputPath: "b",
      outputPath: join(outputDir, "b.png"),
      now,
    });

    const started: string[] = [];
    const client: ImageEditClientLike = {
      editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
    };
    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 1,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => Promise.resolve(),
      stopRequested: () => stopRequested,
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
      onJobFinish: () => {
        stopRequested = true;
      },
    });

    const run = runStore.get("run-1");
    const firstJob = jobStore.findByInputPath("run-1", "a");
    const secondJob = jobStore.findByInputPath("run-1", "b");

    assertEquals(started, ["a"]);
    assertEquals(summary.processed, 1);
    assertEquals(summary.succeeded, 1);
    assertEquals(summary.stopped, true);
    assertEquals(summary.stopReason, "interrupted");
    assertEquals(run?.status, "running");
    assertEquals(run?.finishedAt, undefined);
    assertEquals(firstJob?.status, "succeeded");
    assertEquals(secondJob?.status, "pending");
  } finally {
    db.close();
  }
});

Deno.test("runQueue does not start a job when stop is requested during min delay", async () => {
  const db = openMemoryDatabase();
  try {
    const runStore = new RunStore(db);
    const jobStore = new JobStore(db);
    const attemptStore = new AttemptStore(db);
    const outputStore = new OutputStore(db);
    const outputDir = await Deno.makeTempDir();
    const now = "2026-05-01T00:00:00.000Z";
    let stopRequested = false;

    runStore.create({
      id: "run-1",
      status: "running",
      configHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    jobStore.upsert({
      id: "job-1",
      runId: "run-1",
      inputPath: "a",
      outputPath: join(outputDir, "a.png"),
      now,
    });

    const started: string[] = [];
    const client: ImageEditClientLike = {
      editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
    };
    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 1,
      minDelayMs: 1,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => {
        stopRequested = true;
        return Promise.resolve();
      },
      stopRequested: () => stopRequested,
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
    });

    const run = runStore.get("run-1");
    const job = jobStore.findByInputPath("run-1", "a");

    assertEquals(started, []);
    assertEquals(summary.processed, 0);
    assertEquals(summary.stopped, true);
    assertEquals(summary.stopReason, "interrupted");
    assertEquals(run?.status, "running");
    assertEquals(job?.status, "pending");
  } finally {
    db.close();
  }
});

Deno.test("runQueue waits for run cooldown after retryable failure before next pending job", async () => {
  const db = openMemoryDatabase();
  try {
    const runStore = new RunStore(db);
    const jobStore = new JobStore(db);
    const attemptStore = new AttemptStore(db);
    const outputStore = new OutputStore(db);
    const outputDir = await Deno.makeTempDir();
    const now = "2026-05-01T00:00:00.000Z";

    runStore.create({
      id: "run-1",
      status: "running",
      configHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    for (const inputPath of ["a", "b"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }

    const started: string[] = [];
    const sleeps: number[] = [];
    let calls = 0;
    const client: ImageEditClientLike = {
      editImage: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(
            new ApiError({
              kind: "rate_limit",
              retryable: true,
              stopRun: false,
              message: "slow down",
              status: 429,
              retryAfterMs: 2000,
            }),
          );
        }
        return Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" });
      },
    };

    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 1,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 10_000, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
    });

    assertEquals(started, ["a", "b"]);
    assertEquals(sleeps, [2000]);
    assertEquals(summary.processed, 2);
    assertEquals(summary.retryable, 1);
    assertEquals(summary.succeeded, 1);
  } finally {
    db.close();
  }
});

Deno.test("runQueue uses longest cooldown from concurrent retryable failures", async () => {
  const db = openMemoryDatabase();
  try {
    const runStore = new RunStore(db);
    const jobStore = new JobStore(db);
    const attemptStore = new AttemptStore(db);
    const outputStore = new OutputStore(db);
    const outputDir = await Deno.makeTempDir();
    const now = "2026-05-01T00:00:00.000Z";

    runStore.create({
      id: "run-1",
      status: "running",
      configHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    for (const inputPath of ["a", "b"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }

    const delays = [1000, 3000];
    const sleeps: number[] = [];
    const cooldowns: number[] = [];
    let calls = 0;
    const client: ImageEditClientLike = {
      editImage: () => {
        const retryAfterMs = delays[calls++];
        return Promise.reject(
          new ApiError({
            kind: "rate_limit",
            retryable: true,
            stopRun: false,
            message: "slow down",
            status: 429,
            retryAfterMs,
          }),
        );
      },
    };

    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 2,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 10_000, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      onCooldown: ({ delayMs }) => {
        cooldowns.push(delayMs);
      },
    });

    assertEquals(summary.processed, 2);
    assertEquals(summary.retryable, 2);
    assertEquals(sleeps, [3000]);
    assertEquals(cooldowns, [3000]);
  } finally {
    db.close();
  }
});
