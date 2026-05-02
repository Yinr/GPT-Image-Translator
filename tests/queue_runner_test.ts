import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runQueue } from "../src/queue/queue-runner.ts";
import type { ImageEditClientLike } from "../src/queue/job-runner.ts";
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
