import { assertEquals, assertExists } from "@std/assert";
import { openMemoryDatabase } from "../src/storage/db.ts";
import { RunStore } from "../src/storage/run-store.ts";
import { JobStore } from "../src/storage/job-store.ts";
import { AttemptStore } from "../src/storage/attempt-store.ts";
import { OutputStore } from "../src/storage/output-store.ts";

Deno.test("stores create runs, jobs, and attempts", () => {
  const db = openMemoryDatabase();
  try {
    const runs = new RunStore(db);
    const jobs = new JobStore(db);
    const attempts = new AttemptStore(db);
    const outputs = new OutputStore(db);
    const now = "2026-05-01T00:00:00.000Z";

    runs.create({
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

    jobs.upsert({
      id: "job-1",
      runId: "run-1",
      inputPath: "/input/a.jpg",
      outputPath: "/output/a.png",
      now,
    });

    jobs.updateStatus({
      id: "job-1",
      status: "succeeded",
      now,
      attempts: 1,
      completedAt: now,
    });

    attempts.create({
      id: "attempt-1",
      jobId: "job-1",
      attemptNo: 1,
      status: "succeeded",
      durationMs: 100,
      startedAt: now,
      finishedAt: now,
    });
    outputs.create({
      id: "output-1",
      jobId: "job-1",
      outputPath: "/output/a.png",
      outputFormat: "png",
      width: 1,
      height: 2,
      byteCount: 3,
      revisedPrompt: "x",
      usageJson: '{"total_tokens":1}',
      createdAt: now,
    });

    runs.updateCounts("run-1");

    const run = runs.get("run-1");
    const job = jobs.get("job-1");
    const jobAttempts = attempts.listByJob("job-1");
    const jobOutputs = outputs.listByJob("job-1");

    assertExists(run);
    assertExists(job);
    assertEquals(run.totalJobs, 1);
    assertEquals(run.succeededJobs, 1);
    assertEquals(job.status, "succeeded");
    assertEquals(job.attempts, 1);
    assertEquals(jobAttempts.length, 1);
    assertEquals(jobAttempts[0].durationMs, 100);
    assertEquals(jobOutputs.length, 1);
    assertEquals(jobOutputs[0].outputFormat, "png");
  } finally {
    db.close();
  }
});

Deno.test("RunStore finds resumable running run by config hash", () => {
  const db = openMemoryDatabase();
  try {
    const runs = new RunStore(db);
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

    assertEquals(runs.findResumable("hash")?.id, "run-1");

    runs.updateStatus("run-1", "completed", "2026-05-01T00:01:00.000Z");
    assertEquals(runs.findResumable("hash"), undefined);
  } finally {
    db.close();
  }
});

Deno.test("JobStore resetRunningJobs converts running jobs to retryable", () => {
  const db = openMemoryDatabase();
  try {
    const runs = new RunStore(db);
    const jobs = new JobStore(db);
    const now = "2026-05-01T00:00:00.000Z";

    runs.create({
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
    jobs.upsert({ id: "job-1", runId: "run-1", inputPath: "a", outputPath: "a", now });
    jobs.updateStatus({ id: "job-1", status: "running", now, attempts: 1 });

    const changed = jobs.resetRunningJobs("run-1", "2026-05-01T00:01:00.000Z");
    const job = jobs.get("job-1");

    assertEquals(changed, 1);
    assertEquals(job?.status, "retryable");
    assertEquals(job?.lastErrorType, "interrupted");
    assertEquals(job?.nextAttemptAt, "2026-05-01T00:01:00.000Z");
  } finally {
    db.close();
  }
});

Deno.test("JobStore listFailedByRun returns failed jobs only", () => {
  const db = openMemoryDatabase();
  try {
    const runs = new RunStore(db);
    const jobs = new JobStore(db);
    const now = "2026-05-01T00:00:00.000Z";

    runs.create({
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
    jobs.upsert({ id: "job-1", runId: "run-1", inputPath: "a", outputPath: "a", now });
    jobs.upsert({ id: "job-2", runId: "run-1", inputPath: "b", outputPath: "b", now });
    jobs.updateStatus({
      id: "job-1",
      status: "failed",
      now,
      lastErrorType: "authentication_error",
      lastErrorMessage: "bad key",
      completedAt: now,
    });
    jobs.updateStatus({ id: "job-2", status: "succeeded", now, completedAt: now });

    const failed = jobs.listFailedByRun("run-1");

    assertEquals(failed.length, 1);
    assertEquals(failed[0].id, "job-1");
    assertEquals(failed[0].lastErrorType, "authentication_error");
  } finally {
    db.close();
  }
});
