import { assertEquals } from "@std/assert";
import { planJobs } from "../src/queue/job-planner.ts";
import { listRunnableJobs } from "../src/queue/scheduler.ts";
import { openMemoryDatabase } from "../src/storage/db.ts";
import { JobStore } from "../src/storage/job-store.ts";
import { RunStore } from "../src/storage/run-store.ts";

Deno.test("planner upserts jobs and scheduler returns pending jobs", () => {
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

    planJobs(jobs, {
      runId: "run-1",
      images: [
        { absolutePath: "/input/b.jpg", relativePath: "b.jpg" },
        { absolutePath: "/input/a.jpg", relativePath: "a.jpg" },
      ],
      outputFor: (image) => ({
        path: `/output/${image.relativePath.replace(/\.jpg$/, ".png")}`,
        skip: false,
      }),
      now,
    });

    const runnable = listRunnableJobs(jobs, "run-1", now, 10);

    assertEquals(runnable.map((job) => job.inputPath), ["/input/a.jpg", "/input/b.jpg"]);
  } finally {
    db.close();
  }
});

Deno.test("planner can mark existing outputs as skipped", () => {
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

    planJobs(jobs, {
      runId: "run-1",
      images: [{ absolutePath: "/input/a.jpg", relativePath: "a.jpg" }],
      outputFor: () => ({ path: "/output/a.png", skip: true }),
      now,
    });

    const planned = jobs.listByRun("run-1");
    const runnable = listRunnableJobs(jobs, "run-1", now, 10);

    assertEquals(planned[0].status, "skipped");
    assertEquals(planned[0].completedAt, now);
    assertEquals(runnable.length, 0);
  } finally {
    db.close();
  }
});

Deno.test("scheduler returns due retryable jobs only", () => {
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

    jobs.upsert({ id: "due", runId: "run-1", inputPath: "due", outputPath: "due", now });
    jobs.upsert({ id: "future", runId: "run-1", inputPath: "future", outputPath: "future", now });
    jobs.updateStatus({
      id: "due",
      status: "retryable",
      now,
      nextAttemptAt: "2026-05-01T00:00:00.000Z",
    });
    jobs.updateStatus({
      id: "future",
      status: "retryable",
      now,
      nextAttemptAt: "2026-05-02T00:00:00.000Z",
    });

    const runnable = listRunnableJobs(jobs, "run-1", now, 10);

    assertEquals(runnable.map((job) => job.id), ["due"]);
  } finally {
    db.close();
  }
});
