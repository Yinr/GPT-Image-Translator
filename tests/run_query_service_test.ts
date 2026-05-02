import { assertEquals, assertExists } from "@std/assert";
import { openMemoryDatabase } from "../src/storage/db.ts";
import { RunStore } from "../src/storage/run-store.ts";
import { JobStore } from "../src/storage/job-store.ts";
import { AttemptStore } from "../src/storage/attempt-store.ts";
import { OutputStore } from "../src/storage/output-store.ts";
import { RunQueryService } from "../src/services/run-query.ts";

Deno.test("RunQueryService returns run details with jobs, attempts, and outputs", () => {
  const db = openMemoryDatabase();
  try {
    const runs = new RunStore(db);
    const jobs = new JobStore(db);
    const attempts = new AttemptStore(db);
    const outputs = new OutputStore(db);
    const service = new RunQueryService(runs, jobs, attempts, outputs);
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
      durationMs: 50,
      startedAt: now,
      finishedAt: now,
    });
    outputs.create({
      id: "output-1",
      jobId: "job-1",
      outputPath: "/output/a.png",
      outputFormat: "png",
      byteCount: 1,
      createdAt: now,
    });

    const detail = service.getRunDetail("run-1");

    assertExists(detail);
    assertEquals(detail.jobs.length, 1);
    assertEquals(detail.jobs[0].attempts.length, 1);
    assertEquals(detail.jobs[0].output?.outputFormat, "png");
  } finally {
    db.close();
  }
});

Deno.test("RunQueryService returns job details and filtered job lists", () => {
  const db = openMemoryDatabase();
  try {
    const runs = new RunStore(db);
    const jobs = new JobStore(db);
    const attempts = new AttemptStore(db);
    const outputs = new OutputStore(db);
    const service = new RunQueryService(runs, jobs, attempts, outputs);
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
    jobs.upsert({ id: "job-ok", runId: "run-1", inputPath: "a", outputPath: "a", now });
    jobs.upsert({ id: "job-fail", runId: "run-1", inputPath: "b", outputPath: "b", now });
    jobs.updateStatus({ id: "job-ok", status: "succeeded", now, completedAt: now });
    jobs.updateStatus({
      id: "job-fail",
      status: "failed",
      now,
      lastErrorType: "bad_request",
      lastErrorMessage: "bad prompt",
      completedAt: now,
    });

    const failedJobs = service.listFailedJobs("run-1");
    const succeededJobs = service.listJobs("run-1", { status: "succeeded" });
    const failedDetail = service.getJobDetail("job-fail");

    assertEquals(failedJobs.map((job) => job.id), ["job-fail"]);
    assertEquals(succeededJobs.map((job) => job.id), ["job-ok"]);
    assertEquals(failedDetail?.lastErrorType, "bad_request");
  } finally {
    db.close();
  }
});

Deno.test("RunQueryService lists recent runs", () => {
  const db = openMemoryDatabase();
  try {
    const runs = new RunStore(db);
    const service = new RunQueryService(
      runs,
      new JobStore(db),
      new AttemptStore(db),
      new OutputStore(db),
    );

    runs.create({
      id: "run-1",
      status: "completed",
      configHash: "hash-1",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: "2026-05-01T00:00:00.000Z",
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    runs.create({
      id: "run-2",
      status: "running",
      configHash: "hash-2",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: "2026-05-02T00:00:00.000Z",
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });

    const recent = service.listRecentRuns(2);

    assertEquals(recent.map((run) => run.id), ["run-2", "run-1"]);
  } finally {
    db.close();
  }
});
