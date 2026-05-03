import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { type ImageEditClientLike, runJob } from "../src/queue/job-runner.ts";
import { loadImageScript } from "../src/core/imagescript.ts";
import { ApiError } from "../src/openai/error-classifier.ts";
import type { JobRecord, RetryConfig } from "../src/shared/types.ts";
import { openMemoryDatabase } from "../src/storage/db.ts";
import { RunStore } from "../src/storage/run-store.ts";
import { JobStore } from "../src/storage/job-store.ts";
import { AttemptStore } from "../src/storage/attempt-store.ts";
import { OutputStore } from "../src/storage/output-store.ts";
import { ProcessingMetadataStore } from "../src/storage/processing-metadata-store.ts";

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
      processingMetadataStore: context.processingMetadata,
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
      processingMetadataStore: context.processingMetadata,
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
      processingMetadataStore: context.processingMetadata,
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

Deno.test("runJob sends padded image and selected size when aspectPad is enabled", async () => {
  const context = createContext();
  try {
    const { Image } = await loadImageScript();
    const dir = await Deno.makeTempDir();
    const inputPath = join(dir, "input.png");
    const outputPath = join(dir, "output.png");
    await writeSolidImage(inputPath, 800, 1000, 0x43a047ff);
    let requestPath = "";
    let requestSize = "";
    const preparedEvents: Array<{ apiSize: string; preparedImagePath: string }> = [];
    const client: ImageEditClientLike = {
      editImage: async (request) => {
        requestPath = request.imagePath;
        requestSize = request.size ?? "";
        const image = await Image.decode(await Deno.readFile(request.imagePath));
        assertEquals(image.width, 800);
        assertEquals(image.height, 1200);
        assertEquals(image.getPixelAt(1, 1), 0x00000000);
        assertEquals(image.getPixelAt(1, 101), 0x43a047ff);
        return { bytes: new Uint8Array([5]), outputFormat: "png" };
      },
    };
    const job = createJob(context, { inputPath, outputPath });

    await runJob({
      job,
      prompt: "translate",
      formatFromApi: true,
      aspectPad: {
        enabled: true,
        fill: "transparent",
        cropBackToOriginal: false,
        intermediateDir: ".intermediate",
      },
      outputDir: dir,
      retry,
      client,
      jobStore: context.jobs,
      attemptStore: context.attempts,
      outputStore: context.outputs,
      processingMetadataStore: context.processingMetadata,
      onPreprocessPrepared: ({ metadata, preparedImagePath }) => {
        preparedEvents.push({ apiSize: metadata.apiSize, preparedImagePath });
      },
      now: fixedClock(),
    });

    assertEquals(requestSize, "1024x1536");
    assertEquals(requestPath.endsWith(".preprocess.png"), true);
    assertEquals(preparedEvents.length, 1);
    assertEquals(preparedEvents[0].apiSize, "1024x1536");
    assertEquals(preparedEvents[0].preparedImagePath, requestPath);
    await assertNotFound(requestPath);
    assertEquals([...await Deno.readFile(outputPath)], [5]);
  } finally {
    context.db.close();
  }
});

Deno.test("runJob crops final output and preserves uncropped output when crop-back is enabled", async () => {
  const context = createContext();
  try {
    const { Image } = await loadImageScript();
    const dir = await Deno.makeTempDir();
    const inputPath = join(dir, "input.png");
    const outputPath = join(dir, "nested", "output.png");
    const intermediatePath = join(dir, ".intermediate", "nested", "output.png");
    await writeSolidImage(inputPath, 800, 1000, 0x43a047ff);
    const apiOutput = new Image(800, 1200);
    apiOutput.fill(0xffffffff);
    const sourceRegion = new Image(800, 1000);
    sourceRegion.fill(0x0000ffff);
    apiOutput.composite(sourceRegion, 0, 100);
    const job = createJob(context, { inputPath, outputPath });
    const client: ImageEditClientLike = {
      editImage: async () => ({ bytes: await apiOutput.encode(), outputFormat: "png" }),
    };

    await runJob({
      job,
      prompt: "translate",
      formatFromApi: true,
      aspectPad: {
        enabled: true,
        fill: "white",
        cropBackToOriginal: true,
        intermediateDir: ".intermediate",
      },
      outputDir: dir,
      retry,
      client,
      jobStore: context.jobs,
      attemptStore: context.attempts,
      outputStore: context.outputs,
      processingMetadataStore: context.processingMetadata,
      now: fixedClock(),
    });

    const final = await Image.decode(await Deno.readFile(outputPath));
    const uncropped = await Image.decode(await Deno.readFile(intermediatePath));
    const outputs = context.outputs.listByJob(job.id);
    const processing = context.processingMetadata.getByJob(job.id);

    assertEquals(final.width, 800);
    assertEquals(final.height, 1000);
    assertEquals(final.getPixelAt(1, 1), 0x0000ffff);
    assertEquals(uncropped.width, 800);
    assertEquals(uncropped.height, 1200);
    assertEquals(outputs.length, 1);
    assertEquals(outputs[0].outputPath, outputPath);
    assertExists(processing);
    assertEquals(processing.enabled, true);
    assertEquals(processing.apiSize, "1024x1536");
    assertEquals(processing.sourceWidth, 800);
    assertEquals(processing.sourceHeight, 1000);
    assertEquals(processing.canvasWidth, 800);
    assertEquals(processing.canvasHeight, 1200);
    assertEquals(processing.sourceRectY, 100);
    assertEquals(processing.fill, "white");
    assertEquals(processing.cropBackToOriginal, true);
    assertEquals(processing.uncroppedOutputPath, intermediatePath);
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
  const processingMetadata = new ProcessingMetadataStore(db);
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
  return { db, runs, jobs, attempts, outputs, processingMetadata };
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

async function assertNotFound(path: string): Promise<void> {
  try {
    await Deno.stat(path);
    throw new Error(`Expected ${path} to be removed`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}
