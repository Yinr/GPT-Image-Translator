import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { execute } from "../src/cli/run.ts";
import { defaultConfig } from "../src/config/defaults.ts";
import { createConfigHash } from "../src/core/run-id.ts";
import type { ImageEditClientLike } from "../src/queue/job-runner.ts";
import { openDatabase } from "../src/storage/db.ts";
import { JobStore } from "../src/storage/job-store.ts";
import { RunStore } from "../src/storage/run-store.ts";

Deno.test("execute dry-run scans images without creating a database", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.mkdir(join(inputDir, "nested"));
  await Deno.writeFile(join(inputDir, "nested", "a.jpg"), new Uint8Array([1]));
  await Deno.writeTextFile(join(inputDir, "ignored.txt"), "ignored");

  const logs: string[] = [];
  const result = await execute({
    dryRun: true,
    log: (message) => logs.push(message),
    config: {
      ...structuredClone(defaultConfig),
      inputDir,
      outputDir,
      prompt: "translate",
      storage: { sqlitePath: join(stateDir, "translator.db") },
    },
  });

  assertEquals(result.totalImages, 1);
  assertEquals(result.plannedJobs, 1);
  assertEquals(logs[0], `Scanning images in ${inputDir}`);
  assertEquals(logs[1], "Found 1 image(s) to consider.");
});

Deno.test("execute logs planning and job progress", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));

  const logs: string[] = [];
  const client: ImageEditClientLike = {
    editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
  };
  const result = await execute({
    dryRun: false,
    log: (message) => logs.push(message),
    client,
    config: {
      ...structuredClone(defaultConfig),
      inputDir,
      outputDir,
      prompt: "translate",
      storage: { sqlitePath: join(stateDir, "translator.db") },
    },
  });

  assertEquals(result.succeeded, 1);
  assertEquals(logs.some((message) => message === `Scanning images in ${inputDir}`), true);
  assertEquals(logs.some((message) => message.startsWith("Starting run ")), true);
  assertEquals(logs.some((message) => message.includes("Planned jobs: total=1")), true);
  assertEquals(
    logs.some((message) => message.includes(`Starting job 1 for ${join(inputDir, "a.jpg")}`)),
    true,
  );
  assertEquals(
    logs.some((message) => message.includes(`Completed ${join(inputDir, "a.jpg")}`)),
    true,
  );
});

Deno.test("execute reuses resumable run when resume is enabled", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));

  const config = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    queue: { ...defaultConfig.queue, resume: true },
    storage: { sqlitePath: join(stateDir, "translator.db") },
  };

  const db = await openDatabase(config.storage.sqlitePath);
  try {
    const runs = new RunStore(db);
    runs.create({
      id: "existing-run",
      status: "running",
      configHash: await createConfigHash(config),
      inputDir,
      outputDir,
      startedAt: "2026-05-01T00:00:00.000Z",
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
  } finally {
    db.close();
  }

  const outputPath = join(outputDir, "a.png");
  await Deno.writeFile(outputPath, new Uint8Array([1]));

  const result = await execute({ dryRun: false, config });

  assertEquals(result.runId, "existing-run");
  assertEquals(result.resumed, true);
  assertEquals(result.skipped, 1);
});

Deno.test("execute resets stale running jobs when resuming", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));

  const config = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    queue: { ...defaultConfig.queue, resume: true },
    storage: { sqlitePath: join(stateDir, "translator.db") },
  };

  const db = await openDatabase(config.storage.sqlitePath);
  try {
    const runs = new RunStore(db);
    const jobs = new JobStore(db);
    const configHash = await createConfigHash(config);
    runs.create({
      id: "existing-run",
      status: "running",
      configHash,
      inputDir,
      outputDir,
      startedAt: "2026-05-01T00:00:00.000Z",
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    jobs.upsert({
      id: "job-1",
      runId: "existing-run",
      inputPath: join(inputDir, "a.jpg"),
      outputPath: join(outputDir, "a.png"),
      now: "2026-05-01T00:00:00.000Z",
    });
    jobs.updateStatus({
      id: "job-1",
      status: "running",
      attempts: 1,
      now: "2026-05-01T00:00:10.000Z",
    });
  } finally {
    db.close();
  }

  const outputPath = join(outputDir, "a.png");
  await Deno.writeFile(outputPath, new Uint8Array([1]));

  const result = await execute({ dryRun: false, config });

  assertEquals(result.runId, "existing-run");
  assertEquals(result.resumed, true);
  assertEquals(result.skipped, 1);

  const verifyDb = await openDatabase(config.storage.sqlitePath);
  try {
    const jobs = new JobStore(verifyDb);
    const resumedJob = jobs.findByInputPath("existing-run", join(inputDir, "a.jpg"));
    assertEquals(resumedJob?.lastErrorType, "interrupted");
    assertEquals(resumedJob?.status, "skipped");
  } finally {
    verifyDb.close();
  }
});

Deno.test("execute omits failed summary when skipped outputs clear runnable failures", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  const inputPath = join(inputDir, "a.jpg");
  const outputPath = join(outputDir, "a.png");
  await Deno.writeFile(inputPath, new Uint8Array([1]));
  await Deno.writeFile(outputPath, new Uint8Array([1]));

  const config = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    queue: { ...defaultConfig.queue, resume: true },
    output: { ...defaultConfig.output, skipExisting: true, overwrite: false },
    storage: { sqlitePath: join(stateDir, "translator.db") },
  };

  const db = await openDatabase(config.storage.sqlitePath);
  try {
    const runs = new RunStore(db);
    const jobs = new JobStore(db);
    const configHash = await createConfigHash(config);
    runs.create({
      id: "existing-run",
      status: "running",
      configHash,
      inputDir,
      outputDir,
      startedAt: "2026-05-01T00:00:00.000Z",
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    jobs.upsert({
      id: "job-1",
      runId: "existing-run",
      inputPath,
      outputPath,
      now: "2026-05-01T00:00:00.000Z",
      status: "failed",
      completedAt: "2026-05-01T00:00:01.000Z",
    });
    jobs.updateStatus({
      id: "job-1",
      status: "failed",
      attempts: 1,
      now: "2026-05-01T00:00:01.000Z",
      lastErrorType: "authentication_error",
      lastErrorMessage: "bad key",
      completedAt: "2026-05-01T00:00:01.000Z",
    });
  } finally {
    db.close();
  }

  const result = await execute({ dryRun: false, config });

  assertEquals(result.runId, "existing-run");
  assertEquals(result.failedJobs?.length, 0);
});

Deno.test("execute uses configured output format for skipExisting checks", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));
  await Deno.writeFile(join(outputDir, "a.webp"), new Uint8Array([1]));

  const result = await execute({
    dryRun: false,
    config: {
      ...structuredClone(defaultConfig),
      inputDir,
      outputDir,
      prompt: "translate",
      openai: {
        ...structuredClone(defaultConfig.openai),
        image: { ...structuredClone(defaultConfig.openai.image), outputFormat: "webp" },
      },
      output: {
        ...defaultConfig.output,
        skipExisting: true,
        overwrite: false,
        formatFromApi: true,
      },
      storage: { sqlitePath: join(stateDir, "translator.db") },
    },
  });

  assertEquals(result.skipped, 1);
  assertEquals(result.pending, 0);
});
