import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { execute } from "../src/cli/run.ts";
import { defaultConfig } from "../src/config/defaults.ts";
import { loadImageScript } from "../src/core/imagescript.ts";
import { createRunHash } from "../src/core/run-id.ts";
import type { ImageEditClientLike } from "../src/queue/job-runner.ts";
import { openDatabase } from "../src/storage/db.ts";
import { JobStore } from "../src/storage/job-store.ts";
import { RunConfigStore } from "../src/storage/run-config-store.ts";
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
  assertEquals(
    logs.some((message) =>
      message.includes("starting new run; no matching running run for current run identity")
    ),
    true,
  );
  assertEquals(logs.some((message) => message.includes("Planned jobs: total=1")), true);
  assertEquals(
    logs.some((message) => message.includes(`Attempt 1: ${join(inputDir, "a.jpg")}`)),
    true,
  );
  assertEquals(
    logs.some((message) =>
      message.includes(
        `Completed [work=1/1, left=0] ${join(inputDir, "a.jpg")}`,
      )
    ),
    true,
  );
});

Deno.test("execute stops after max success and keeps run resumable", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));
  await Deno.writeFile(join(inputDir, "b.jpg"), new Uint8Array([1]));

  const logs: string[] = [];
  const client: ImageEditClientLike = {
    editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
  };
  const config = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    queue: { ...defaultConfig.queue, concurrency: 1 },
    storage: { sqlitePath: join(stateDir, "translator.db") },
  };

  const result = await execute({
    dryRun: false,
    log: (message) => logs.push(message),
    client,
    config,
    maxSuccess: 1,
  });

  assertEquals(result.succeeded, 1);
  assertEquals(result.pending, 1);
  assertEquals(result.stopped, true);
  assertEquals(result.stopReason, "success_limit");
  assertEquals(result.maxSuccess, 1);
  assertEquals(logs.some((message) => message.includes("maxSuccess=1")), true);

  const db = await openDatabase(config.storage.sqlitePath);
  try {
    const runs = new RunStore(db);
    assertEquals(runs.get(result.runId!)?.status, "running");
  } finally {
    db.close();
  }
});

Deno.test("execute keeps run resumable when graceful stop is requested", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));
  await Deno.writeFile(join(inputDir, "b.jpg"), new Uint8Array([1]));

  let stopRequested = false;
  const client: ImageEditClientLike = {
    editImage: () => {
      stopRequested = true;
      return Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" });
    },
  };
  const config = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    queue: { ...defaultConfig.queue, concurrency: 1 },
    storage: { sqlitePath: join(stateDir, "translator.db") },
  };

  const result = await execute({
    dryRun: false,
    client,
    config,
    stopRequested: () => stopRequested,
  });

  assertEquals(result.succeeded, 1);
  assertEquals(result.pending, 1);
  assertEquals(result.stopped, true);
  assertEquals(result.stopReason, "interrupted");

  const db = await openDatabase(config.storage.sqlitePath);
  try {
    const runs = new RunStore(db);
    assertEquals(runs.get(result.runId!)?.status, "running");
  } finally {
    db.close();
  }
});

Deno.test("execute writes diagnostic log file when logging is enabled", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  const logDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));

  const client: ImageEditClientLike = {
    editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
  };
  const result = await execute({
    dryRun: false,
    client,
    config: {
      ...structuredClone(defaultConfig),
      inputDir,
      outputDir,
      prompt: "translate",
      storage: { sqlitePath: join(stateDir, "translator.db") },
      logging: {
        ...defaultConfig.logging,
        enabled: true,
        dir: logDir,
        level: "info",
        file: true,
        console: false,
      },
    },
  });

  const text = await Deno.readTextFile(result.logFile!);

  assertEquals(text.includes("[INFO] Run started"), true);
  assertEquals(text.includes("[INFO] Job completed"), true);
  assertEquals(text.includes("[INFO] Run finished"), true);
});

Deno.test("execute logs preprocessing progress and diagnostics when aspect padding is enabled", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  const logDir = await Deno.makeTempDir();
  const inputPath = join(inputDir, "a.png");
  await writeSolidImage(inputPath, 800, 1000, 0x43a047ff);

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
      preprocess: {
        aspectPad: {
          enabled: true,
          fill: "transparent",
          cropBackToOriginal: false,
          intermediateDir: ".intermediate",
        },
      },
      logging: {
        ...defaultConfig.logging,
        enabled: true,
        dir: logDir,
        level: "debug",
        file: true,
        console: false,
      },
    },
  });

  const text = await Deno.readTextFile(result.logFile!);

  assertEquals(
    logs.some((message) =>
      message === "Preprocess aspectPad enabled fill=transparent cropBack=false"
    ),
    true,
  );
  assertEquals(
    logs.some((message) =>
      message.includes(`Prepared ${inputPath} -> 1024x1536 padded=800x1200 cropBack=no`)
    ),
    true,
  );
  assertEquals(text.includes("[INFO] Preprocessing enabled"), true);
  assertEquals(text.includes("[INFO] Image preprocessed"), true);
  assertEquals(text.includes('"apiSize":"1024x1536"'), true);
  assertEquals(text.includes('"canvasHeight":1200'), true);
  assertEquals(text.includes("[DEBUG] Image preprocessing details"), true);
  assertEquals(text.includes('"sourceRectY":100'), true);
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
      runHash: await createRunHash(config),
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

Deno.test("execute explicit resume run does not select latest matching run", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));
  await Deno.writeFile(join(outputDir, "a.png"), new Uint8Array([1]));

  const config = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    queue: { ...defaultConfig.queue, resume: true },
    storage: { sqlitePath: join(stateDir, "translator.db") },
  };
  const runHash = await createRunHash(config);

  const db = await openDatabase(config.storage.sqlitePath);
  try {
    const runs = new RunStore(db);
    runs.create({
      id: "older-run",
      status: "running",
      runHash,
      inputDir,
      outputDir,
      startedAt: "2026-05-01T00:00:00.000Z",
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    runs.create({
      id: "newer-run",
      status: "running",
      runHash,
      inputDir,
      outputDir,
      startedAt: "2026-05-02T00:00:00.000Z",
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
  } finally {
    db.close();
  }

  const result = await execute({ dryRun: false, config, resumeRunId: "older-run" });

  assertEquals(result.runId, "older-run");
  assertEquals(result.resumed, true);
  assertEquals(result.skipped, 1);
});

Deno.test("execute explicit resume run ignores disabled automatic resume", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));
  await Deno.writeFile(join(outputDir, "a.png"), new Uint8Array([1]));

  const config = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    queue: { ...defaultConfig.queue, resume: false },
    storage: { sqlitePath: join(stateDir, "translator.db") },
  };

  const db = await openDatabase(config.storage.sqlitePath);
  try {
    new RunStore(db).create({
      id: "existing-run",
      status: "running",
      runHash: await createRunHash(config),
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

  const result = await execute({ dryRun: false, config, resumeRunId: "existing-run" });

  assertEquals(result.runId, "existing-run");
  assertEquals(result.resumed, true);
  assertEquals(result.skipped, 1);
});

Deno.test("execute stores sanitized run config snapshot for new runs", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));

  const client: ImageEditClientLike = {
    editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
  };
  const config = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    openai: {
      ...structuredClone(defaultConfig.openai),
      apiKey: "secret-key",
      apiKeyEnv: "OPENAI_API_KEY",
    },
    storage: { sqlitePath: join(stateDir, "translator.db") },
  };

  const result = await execute({ dryRun: false, config, client });
  const db = await openDatabase(config.storage.sqlitePath);
  try {
    const runConfigs = new RunConfigStore(db);
    const snapshot = runConfigs.get(result.runId!);
    const parsed = JSON.parse(snapshot!.configJson);

    assertEquals(snapshot?.configVersion, config.configVersion);
    assertEquals(parsed.openai.apiKey, undefined);
    assertEquals(parsed.openai.apiKeyEnv, "OPENAI_API_KEY");
    assertEquals(parsed.prompt, "translate");
  } finally {
    db.close();
  }
});

Deno.test("execute reuses resumable run when non-identity config changes", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));
  await Deno.writeFile(join(outputDir, "a.png"), new Uint8Array([1]));

  const originalConfig = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    queue: { ...defaultConfig.queue, resume: true, concurrency: 1 },
    retry: { ...defaultConfig.retry, maxAttempts: 5 },
    storage: { sqlitePath: join(stateDir, "translator.db") },
  };
  const changedConfig = {
    ...structuredClone(originalConfig),
    openai: {
      ...structuredClone(originalConfig.openai),
      apiKey: "changed-key",
      apiKeyEnv: undefined,
      proxy: { url: "http://127.0.0.1:8080" },
    },
    queue: { ...originalConfig.queue, concurrency: 3, minDelayMs: 0 },
    retry: { ...originalConfig.retry, maxAttempts: 2 },
    logging: { ...originalConfig.logging, enabled: true, console: false, file: false },
  };

  const db = await openDatabase(originalConfig.storage.sqlitePath);
  try {
    const runs = new RunStore(db);
    runs.create({
      id: "existing-run",
      status: "running",
      runHash: await createRunHash(originalConfig),
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

  const result = await execute({ dryRun: false, config: changedConfig });

  assertEquals(result.runId, "existing-run");
  assertEquals(result.resumed, true);
  assertEquals(result.skipped, 1);
});

Deno.test("execute starts new run when run identity config changes", async () => {
  const inputDir = await Deno.makeTempDir();
  const outputDir = await Deno.makeTempDir();
  const stateDir = await Deno.makeTempDir();
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));
  await Deno.writeFile(join(outputDir, "a.png"), new Uint8Array([1]));

  const originalConfig = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    queue: { ...defaultConfig.queue, resume: true },
    storage: { sqlitePath: join(stateDir, "translator.db") },
  };
  const changedConfig = {
    ...structuredClone(originalConfig),
    prompt: "translate differently",
  };

  const db = await openDatabase(originalConfig.storage.sqlitePath);
  try {
    const runs = new RunStore(db);
    runs.create({
      id: "existing-run",
      status: "running",
      runHash: await createRunHash(originalConfig),
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

  const result = await execute({ dryRun: false, config: changedConfig });

  assertEquals(result.runId === "existing-run", false);
  assertEquals(result.resumed, false);
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
    const runHash = await createRunHash(config);
    runs.create({
      id: "existing-run",
      status: "running",
      runHash,
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

  const logs: string[] = [];
  const result = await execute({ dryRun: false, config, log: (message) => logs.push(message) });

  assertEquals(result.runId, "existing-run");
  assertEquals(result.resumed, true);
  assertEquals(result.skipped, 1);
  assertEquals(logs.some((message) => message === "Resume reset stale running jobs: 1"), true);

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
    const runHash = await createRunHash(config);
    runs.create({
      id: "existing-run",
      status: "running",
      runHash,
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

async function writeSolidImage(
  path: string,
  width: number,
  height: number,
  color: number,
): Promise<void> {
  const { Image } = await loadImageScript();
  const image = new Image(width, height);
  image.fill(color);
  await Deno.writeFile(path, await image.encode());
}
