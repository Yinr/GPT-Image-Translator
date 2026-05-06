import { assertEquals, assertExists } from "@std/assert";
import { Database } from "@db/sqlite";
import { openDatabase, openMemoryDatabase } from "../src/storage/db.ts";
import { RunStore } from "../src/storage/run-store.ts";
import { RunConfigStore } from "../src/storage/run-config-store.ts";
import { JobStore } from "../src/storage/job-store.ts";
import { AttemptStore } from "../src/storage/attempt-store.ts";
import { OutputStore } from "../src/storage/output-store.ts";
import { ProcessingMetadataStore } from "../src/storage/processing-metadata-store.ts";

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
      runHash: "hash",
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

Deno.test("RunStore finds resumable running run by run hash", () => {
  const db = openMemoryDatabase();
  try {
    const runs = new RunStore(db);
    runs.create({
      id: "run-1",
      status: "running",
      runHash: "hash",
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

Deno.test("RunConfigStore creates, reads, and cascades run config snapshots", () => {
  const db = openMemoryDatabase();
  try {
    const runs = new RunStore(db);
    const runConfigs = new RunConfigStore(db);
    const now = "2026-05-01T00:00:00.000Z";

    runs.create({
      id: "run-1",
      status: "running",
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    runConfigs.create({
      runId: "run-1",
      configVersion: 2,
      configJson: '{"prompt":"translate"}',
      createdAt: now,
    });

    assertEquals(runConfigs.get("run-1"), {
      runId: "run-1",
      configVersion: 2,
      configJson: '{"prompt":"translate"}',
      createdAt: now,
    });

    db.prepare("DELETE FROM runs WHERE id = ?").run("run-1");
    assertEquals(runConfigs.get("run-1"), undefined);
  } finally {
    db.close();
  }
});

Deno.test("openDatabase migrates legacy config_hash column and creates run_configs", async () => {
  const dir = await Deno.makeTempDir();
  const sqlitePath = `${dir}/translator.db`;
  const legacyDb = new Database(sqlitePath);
  try {
    legacyDb.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (1, '2026-05-01T00:00:00.000Z'), (2, '2026-05-01T00:00:00.000Z');

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        input_dir TEXT NOT NULL,
        output_dir TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        total_jobs INTEGER NOT NULL DEFAULT 0,
        succeeded_jobs INTEGER NOT NULL DEFAULT 0,
        failed_jobs INTEGER NOT NULL DEFAULT 0,
        skipped_jobs INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO runs (
        id, status, config_hash, input_dir, output_dir, started_at,
        total_jobs, succeeded_jobs, failed_jobs, skipped_jobs
      ) VALUES (
        'run-1', 'running', 'legacy-hash', '/input', '/output', '2026-05-01T00:00:00.000Z',
        0, 0, 0, 0
      );
    `);
  } finally {
    legacyDb.close();
  }

  const db = await openDatabase(sqlitePath);
  try {
    const columns = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    const runConfigColumns = db.prepare("PRAGMA table_info(run_configs)").all() as Array<
      { name: string }
    >;
    const runs = new RunStore(db);
    const runConfigs = new RunConfigStore(db);

    assertEquals(columns.some((column) => column.name === "run_hash"), true);
    assertEquals(columns.some((column) => column.name === "config_hash"), false);
    assertEquals(runConfigColumns.map((column) => column.name), [
      "run_id",
      "config_version",
      "config_json",
      "created_at",
    ]);
    assertEquals(runs.get("run-1")?.runHash, "legacy-hash");
    assertEquals(runs.findResumable("legacy-hash")?.id, "run-1");
    assertEquals(runConfigs.get("run-1"), undefined);
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
      runHash: "hash",
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
      runHash: "hash",
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

Deno.test("ProcessingMetadataStore creates and reads preprocessing metadata", () => {
  const db = openMemoryDatabase();
  try {
    const runs = new RunStore(db);
    const jobs = new JobStore(db);
    const processing = new ProcessingMetadataStore(db);
    const now = "2026-05-01T00:00:00.000Z";

    runs.create({
      id: "run-1",
      status: "running",
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    jobs.upsert({ id: "job-1", runId: "run-1", inputPath: "a", outputPath: "a", now });

    processing.create({
      id: "processing-1",
      jobId: "job-1",
      enabled: true,
      apiSize: "1024x1536",
      sourceWidth: 800,
      sourceHeight: 1000,
      canvasWidth: 800,
      canvasHeight: 1200,
      sourceRectX: 0,
      sourceRectY: 100,
      sourceRectWidth: 800,
      sourceRectHeight: 1000,
      fill: "white",
      cropBackToOriginal: true,
      uncroppedOutputPath: "/output/.intermediate/a.png",
      createdAt: now,
    });

    const metadata = processing.getByJob("job-1");

    assertExists(metadata);
    assertEquals(metadata.enabled, true);
    assertEquals(metadata.apiSize, "1024x1536");
    assertEquals(metadata.sourceWidth, 800);
    assertEquals(metadata.canvasHeight, 1200);
    assertEquals(metadata.sourceRectY, 100);
    assertEquals(metadata.fill, "white");
    assertEquals(metadata.cropBackToOriginal, true);
    assertEquals(metadata.uncroppedOutputPath, "/output/.intermediate/a.png");
  } finally {
    db.close();
  }
});
