import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { type ImageEditClientLike, runJob } from "../src/queue/job-runner.ts";
import { ApiError } from "../src/openai/error-classifier.ts";
import type { JobRecord, RetryConfig } from "../src/shared/types.ts";
import { openMemoryDatabase } from "../src/storage/db.ts";
import { RunStore } from "../src/storage/run-store.ts";
import { JobStore } from "../src/storage/job-store.ts";
import { AttemptStore } from "../src/storage/attempt-store.ts";
import { OutputStore } from "../src/storage/output-store.ts";

const retry: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10_000,
  backoffFactor: 2,
};

Deno.test("runJob writes output and marks job succeeded", async () => {
  const context = createContext();
  try {
    const outputPath = join(await Deno.makeTempDir(), "nested", "out.png");
    const job = createJob(context, { outputPath });
    const client: ImageEditClientLike = {
      editImage: () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), outputFormat: "png" }),
    };

    const result = await runJob({
      job,
      prompt: "translate",
      formatFromApi: true,
      retry,
      client,
      jobStore: context.jobs,
      attemptStore: context.attempts,
      outputStore: context.outputs,
      now: fixedClock(),
    });

    const updated = context.jobs.get(job.id);
    const attempts = context.attempts.listByJob(job.id);
    const outputs = context.outputs.listByJob(job.id);
    const bytes = await Deno.readFile(outputPath);

    assertEquals(result.status, "succeeded");
    assertEquals(result.stopRun, false);
    assertExists(updated);
    assertEquals(updated.status, "succeeded");
    assertEquals(updated.attempts, 1);
    assertEquals(attempts[0].status, "succeeded");
    assertEquals(outputs[0].outputPath, outputPath);
    assertEquals([...bytes], [1, 2, 3]);
  } finally {
    context.db.close();
  }
});

Deno.test("runJob writes using API output format and updates job output path", async () => {
  const context = createContext();
  try {
    const outputDir = await Deno.makeTempDir();
    const plannedOutputPath = join(outputDir, "out.png");
    const actualOutputPath = join(outputDir, "out.webp");
    const job = createJob(context, { outputPath: plannedOutputPath });
    const client: ImageEditClientLike = {
      editImage: () => Promise.resolve({ bytes: new Uint8Array([7]), outputFormat: "webp" }),
    };

    await runJob({
      job,
      prompt: "translate",
      formatFromApi: true,
      retry,
      client,
      jobStore: context.jobs,
      attemptStore: context.attempts,
      outputStore: context.outputs,
      now: fixedClock(),
    });

    const updated = context.jobs.get(job.id);
    const outputs = context.outputs.listByJob(job.id);
    const bytes = await Deno.readFile(actualOutputPath);

    assertEquals([...bytes], [7]);
    assertEquals(updated?.outputPath, actualOutputPath);
    assertEquals(outputs[0].outputFormat, "webp");
  } finally {
    context.db.close();
  }
});

Deno.test("runJob preserves planned output path when formatFromApi is false", async () => {
  const context = createContext();
  try {
    const outputDir = await Deno.makeTempDir();
    const plannedOutputPath = join(outputDir, "out.webp");
    const job = createJob(context, { outputPath: plannedOutputPath });
    const client: ImageEditClientLike = {
      editImage: () => Promise.resolve({ bytes: new Uint8Array([9]), outputFormat: "png" }),
    };

    await runJob({
      job,
      prompt: "translate",
      formatFromApi: false,
      retry,
      client,
      jobStore: context.jobs,
      attemptStore: context.attempts,
      outputStore: context.outputs,
      now: fixedClock(),
    });

    const updated = context.jobs.get(job.id);
    const outputs = context.outputs.listByJob(job.id);
    const bytes = await Deno.readFile(plannedOutputPath);

    assertEquals([...bytes], [9]);
    assertEquals(updated?.outputPath, plannedOutputPath);
    assertEquals(outputs[0].outputPath, plannedOutputPath);
    assertEquals(outputs[0].outputFormat, "png");
  } finally {
    context.db.close();
  }
});

Deno.test("runJob marks retryable API errors with next attempt", async () => {
  const context = createContext();
  try {
    const job = createJob(context);
    const client: ImageEditClientLike = {
      editImage: () =>
        Promise.reject(
          new ApiError({
            kind: "rate_limit",
            retryable: true,
            stopRun: false,
            message: "slow down",
            status: 429,
            retryAfterMs: 2000,
          }),
        ),
    };

    const result = await runJob({
      job,
      prompt: "translate",
      formatFromApi: true,
      retry,
      client,
      jobStore: context.jobs,
      attemptStore: context.attempts,
      outputStore: context.outputs,
      now: fixedClock(),
    });

    const updated = context.jobs.get(job.id);
    const attempts = context.attempts.listByJob(job.id);

    assertEquals(result.status, "retryable");
    assertEquals(result.stopRun, false);
    assertEquals(result.nextAttemptAt, "2026-05-01T00:00:03.000Z");
    assertExists(updated);
    assertEquals(updated.status, "retryable");
    assertEquals(updated.nextAttemptAt, "2026-05-01T00:00:03.000Z");
    assertEquals(updated.lastErrorType, "rate_limit");
    assertEquals(attempts[0].status, "retryable");
    assertEquals(attempts[0].retryAfterMs, 2000);
  } finally {
    context.db.close();
  }
});

Deno.test("runJob marks auth errors failed and stops run", async () => {
  const context = createContext();
  try {
    const job = createJob(context);
    const client: ImageEditClientLike = {
      editImage: () =>
        Promise.reject(
          new ApiError({
            kind: "authentication_error",
            retryable: false,
            stopRun: true,
            message: "bad key",
            status: 401,
          }),
        ),
    };

    const result = await runJob({
      job,
      prompt: "translate",
      formatFromApi: true,
      retry,
      client,
      jobStore: context.jobs,
      attemptStore: context.attempts,
      outputStore: context.outputs,
      now: fixedClock(),
    });

    const updated = context.jobs.get(job.id);
    const attempts = context.attempts.listByJob(job.id);

    assertEquals(result.status, "failed");
    assertEquals(result.stopRun, true);
    assertExists(updated);
    assertEquals(updated.status, "failed");
    assertEquals(updated.lastErrorType, "authentication_error");
    assertEquals(attempts[0].status, "failed");
  } finally {
    context.db.close();
  }
});

function createContext() {
  const db = openMemoryDatabase();
  const runs = new RunStore(db);
  const jobs = new JobStore(db);
  const attempts = new AttemptStore(db);
  const outputs = new OutputStore(db);
  runs.create({
    id: "run-1",
    status: "running",
    configHash: "hash",
    inputDir: "/input",
    outputDir: "/output",
    startedAt: "2026-05-01T00:00:00.000Z",
    totalJobs: 0,
    succeededJobs: 0,
    failedJobs: 0,
    skippedJobs: 0,
  });
  return { db, runs, jobs, attempts, outputs };
}

function createJob(
  context: ReturnType<typeof createContext>,
  overrides: Partial<JobRecord> = {},
): JobRecord {
  const now = "2026-05-01T00:00:00.000Z";
  context.jobs.upsert({
    id: overrides.id ?? "job-1",
    runId: "run-1",
    inputPath: overrides.inputPath ?? "/input/a.jpg",
    outputPath: overrides.outputPath ?? "/output/a.png",
    now,
  });

  const job = context.jobs.get(overrides.id ?? "job-1");
  if (!job) throw new Error("Expected test job to exist");
  return job;
}

function fixedClock(): () => string {
  let call = 0;
  return () => {
    const value = new Date(Date.UTC(2026, 4, 1, 0, 0, call)).toISOString();
    call += 1;
    return value;
  };
}
