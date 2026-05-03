import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import {
  runFailedCommand,
  runInspectCommand,
  runStatusCommand,
} from "../src/cli/query-commands.ts";
import type { JobDetail, RunDetail, RunSummary } from "../src/services/run-query.ts";
import { openDatabase } from "../src/storage/db.ts";
import { JobStore } from "../src/storage/job-store.ts";
import { ProcessingMetadataStore } from "../src/storage/processing-metadata-store.ts";
import { RunStore } from "../src/storage/run-store.ts";

Deno.test("query commands expose run status, inspect, and failed jobs", async () => {
  const dir = await Deno.makeTempDir();
  const sqlitePath = join(dir, "translator.db");
  const db = await openDatabase(sqlitePath);
  try {
    const runs = new RunStore(db);
    const jobs = new JobStore(db);
    const processing = new ProcessingMetadataStore(db);
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
    jobs.updateStatus({
      id: "job-1",
      status: "failed",
      now,
      lastErrorType: "bad_request",
      lastErrorMessage: "bad prompt",
      completedAt: now,
    });
    processing.create({
      id: "processing-1",
      jobId: "job-1",
      enabled: true,
      apiSize: "1536x1024",
      sourceWidth: 1000,
      sourceHeight: 800,
      canvasWidth: 1200,
      canvasHeight: 800,
      sourceRectX: 100,
      sourceRectY: 0,
      sourceRectWidth: 1000,
      sourceRectHeight: 800,
      fill: "transparent",
      cropBackToOriginal: false,
      createdAt: now,
    });
  } finally {
    db.close();
  }

  const status: RunSummary[] = await runStatusCommand(sqlitePath, 10);
  const detail: RunDetail | undefined = await runInspectCommand(sqlitePath, "run-1");
  const failed: JobDetail[] = await runFailedCommand(sqlitePath, "run-1");

  assertEquals(status.map((run) => run.id), ["run-1"]);
  assertExists(detail);
  assertEquals(detail.jobs.length, 1);
  assertEquals(detail.jobs[0].processing?.apiSize, "1536x1024");
  assertEquals(detail.jobs[0].processing?.sourceRect, { x: 100, y: 0, width: 1000, height: 800 });
  assertEquals(failed.map((job) => job.id), ["job-1"]);
});
