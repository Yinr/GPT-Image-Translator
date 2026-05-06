import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runQueue } from "../src/queue/queue-runner.ts";
import type { ImageEditClientLike } from "../src/queue/job-runner.ts";
import { ApiError } from "../src/openai/error-classifier.ts";
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
      runHash: "hash",
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
      formatFromApi: true,
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

Deno.test("runQueue refills an available concurrency slot as soon as a job finishes", async () => {
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
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    for (const inputPath of ["a", "b", "c"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }

    const started: string[] = [];
    const deferred = new Map<string, ReturnType<typeof createDeferred<void>>>();
    const client: ImageEditClientLike = {
      editImage: async (request) => {
        const gate = deferred.get(request.imagePath)!;
        await gate.promise;
        return { bytes: new Uint8Array([1]), outputFormat: "png" };
      },
    };
    for (const inputPath of ["a", "b", "c"]) deferred.set(inputPath, createDeferred<void>());

    const summaryPromise = runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 2,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => Promise.resolve(),
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
    });

    await waitFor(() => started.length === 2);
    assertEquals(started, ["a", "b"]);

    deferred.get("a")!.resolve();
    await waitFor(() => started.length === 3);
    assertEquals(started, ["a", "b", "c"]);

    deferred.get("b")!.resolve();
    deferred.get("c")!.resolve();
    const summary = await summaryPromise;

    assertEquals(summary.processed, 3);
    assertEquals(summary.succeeded, 3);
  } finally {
    db.close();
  }
});

Deno.test("runQueue stops after current job when graceful stop is requested", async () => {
  const db = openMemoryDatabase();
  try {
    const runStore = new RunStore(db);
    const jobStore = new JobStore(db);
    const attemptStore = new AttemptStore(db);
    const outputStore = new OutputStore(db);
    const outputDir = await Deno.makeTempDir();
    const now = "2026-05-01T00:00:00.000Z";
    let stopRequested = false;

    runStore.create({
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

    const started: string[] = [];
    const client: ImageEditClientLike = {
      editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
    };
    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 1,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => Promise.resolve(),
      stopRequested: () => stopRequested,
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
      onJobFinish: () => {
        stopRequested = true;
      },
    });

    const run = runStore.get("run-1");
    const firstJob = jobStore.findByInputPath("run-1", "a");
    const secondJob = jobStore.findByInputPath("run-1", "b");

    assertEquals(started, ["a"]);
    assertEquals(summary.processed, 1);
    assertEquals(summary.succeeded, 1);
    assertEquals(summary.stopped, true);
    assertEquals(summary.stopReason, "interrupted");
    assertEquals(run?.status, "running");
    assertEquals(run?.finishedAt, undefined);
    assertEquals(firstJob?.status, "succeeded");
    assertEquals(secondJob?.status, "pending");
  } finally {
    db.close();
  }
});

Deno.test("runQueue waits for all in-flight jobs after graceful stop is requested", async () => {
  const db = openMemoryDatabase();
  try {
    const runStore = new RunStore(db);
    const jobStore = new JobStore(db);
    const attemptStore = new AttemptStore(db);
    const outputStore = new OutputStore(db);
    const outputDir = await Deno.makeTempDir();
    const now = "2026-05-01T00:00:00.000Z";
    let stopRequested = false;

    runStore.create({
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
    for (const inputPath of ["a", "b", "c"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }

    const started: string[] = [];
    const finished: string[] = [];
    const deferred = new Map<string, ReturnType<typeof createDeferred<void>>>();
    for (const inputPath of ["a", "b"]) deferred.set(inputPath, createDeferred<void>());
    const client: ImageEditClientLike = {
      editImage: async (request) => {
        await deferred.get(request.imagePath)!.promise;
        finished.push(request.imagePath);
        return { bytes: new Uint8Array([1]), outputFormat: "png" };
      },
    };

    const summaryPromise = runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 2,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => Promise.resolve(),
      stopRequested: () => stopRequested,
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
    });

    await waitFor(() => started.length === 2);
    assertEquals(started, ["a", "b"]);

    stopRequested = true;
    deferred.get("a")!.resolve();
    await waitFor(() => finished.length === 1);
    assertEquals(started, ["a", "b"]);

    deferred.get("b")!.resolve();
    const summary = await summaryPromise;
    const run = runStore.get("run-1");
    const firstJob = jobStore.findByInputPath("run-1", "a");
    const secondJob = jobStore.findByInputPath("run-1", "b");
    const thirdJob = jobStore.findByInputPath("run-1", "c");

    assertEquals(finished, ["a", "b"]);
    assertEquals(summary.processed, 2);
    assertEquals(summary.succeeded, 2);
    assertEquals(summary.stopped, true);
    assertEquals(summary.stopReason, "interrupted");
    assertEquals(run?.status, "running");
    assertEquals(firstJob?.status, "succeeded");
    assertEquals(secondJob?.status, "succeeded");
    assertEquals(thirdJob?.status, "pending");
  } finally {
    db.close();
  }
});

Deno.test("runQueue stops scheduling new jobs after reaching success limit", async () => {
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
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    for (const inputPath of ["a", "b", "c"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }

    const started: string[] = [];
    const client: ImageEditClientLike = {
      editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
    };
    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 1,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => Promise.resolve(),
      maxSuccess: 2,
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
    });

    const run = runStore.get("run-1");
    const thirdJob = jobStore.findByInputPath("run-1", "c");

    assertEquals(started, ["a", "b"]);
    assertEquals(summary.processed, 2);
    assertEquals(summary.succeeded, 2);
    assertEquals(summary.stopped, true);
    assertEquals(summary.stopReason, "success_limit");
    assertEquals(run?.status, "running");
    assertEquals(thirdJob?.status, "pending");
  } finally {
    db.close();
  }
});

Deno.test("runQueue lets in-flight jobs finish after success limit is reached", async () => {
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
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    for (const inputPath of ["a", "b", "c"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }

    const started: string[] = [];
    const finished: string[] = [];
    const deferred = new Map<string, ReturnType<typeof createDeferred<void>>>();
    for (const inputPath of ["a", "b"]) deferred.set(inputPath, createDeferred<void>());
    const client: ImageEditClientLike = {
      editImage: async (request) => {
        await deferred.get(request.imagePath)!.promise;
        finished.push(request.imagePath);
        return { bytes: new Uint8Array([1]), outputFormat: "png" };
      },
    };

    const summaryPromise = runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 2,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => Promise.resolve(),
      maxSuccess: 2,
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
    });

    await waitFor(() => started.length === 2);
    deferred.get("a")!.resolve();
    await waitFor(() => finished.length === 1);
    assertEquals(started, ["a", "b"]);
    deferred.get("b")!.resolve();

    const summary = await summaryPromise;
    const run = runStore.get("run-1");
    const thirdJob = jobStore.findByInputPath("run-1", "c");

    assertEquals(started, ["a", "b"]);
    assertEquals(finished, ["a", "b"]);
    assertEquals(summary.processed, 2);
    assertEquals(summary.succeeded, 2);
    assertEquals(summary.stopped, true);
    assertEquals(summary.stopReason, "success_limit");
    assertEquals(run?.status, "running");
    assertEquals(thirdJob?.status, "pending");
  } finally {
    db.close();
  }
});

Deno.test("runQueue does not over-launch concurrency when only one success slot remains", async () => {
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
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    for (const inputPath of ["a", "b", "c"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }

    const started: string[] = [];
    const finished: string[] = [];
    const deferred = new Map<string, ReturnType<typeof createDeferred<void>>>();
    for (const inputPath of ["a", "b"]) deferred.set(inputPath, createDeferred<void>());
    const client: ImageEditClientLike = {
      editImage: async (request) => {
        await deferred.get(request.imagePath)!.promise;
        finished.push(request.imagePath);
        return { bytes: new Uint8Array([1]), outputFormat: "png" };
      },
    };

    const summaryPromise = runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 2,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => Promise.resolve(),
      maxSuccess: 2,
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
    });

    await waitFor(() => started.length === 2);
    assertEquals(started, ["a", "b"]);

    deferred.get("a")!.resolve();
    await waitFor(() => finished.length === 1);
    assertEquals(started, ["a", "b"]);

    deferred.get("b")!.resolve();
    const summary = await summaryPromise;
    const thirdJob = jobStore.findByInputPath("run-1", "c");

    assertEquals(summary.succeeded, 2);
    assertEquals(summary.stopped, true);
    assertEquals(summary.stopReason, "success_limit");
    assertEquals(thirdJob?.status, "pending");
  } finally {
    db.close();
  }
});

Deno.test("runQueue can continue after an in-flight job fails under success limit gating", async () => {
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
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    for (const inputPath of ["a", "b", "c"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }

    const started: string[] = [];
    const deferred = new Map<string, ReturnType<typeof createDeferred<void>>>();
    for (const inputPath of ["a", "b"]) deferred.set(inputPath, createDeferred<void>());
    const client: ImageEditClientLike = {
      editImage: async (request) => {
        await deferred.get(request.imagePath)!.promise;
        if (request.imagePath === "a") {
          throw new ApiError({
            kind: "bad_request",
            retryable: false,
            stopRun: false,
            message: "bad input",
            status: 400,
          });
        }
        return { bytes: new Uint8Array([1]), outputFormat: "png" };
      },
    };

    const summaryPromise = runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 2,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => Promise.resolve(),
      maxSuccess: 2,
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
        if (job.inputPath === "c" && !deferred.has("c")) deferred.set("c", createDeferred<void>());
      },
    });

    await waitFor(() => started.length === 2);
    assertEquals(started, ["a", "b"]);

    deferred.get("a")!.resolve();
    deferred.get("b")!.resolve();
    await waitFor(() => started.length === 3);
    assertEquals(started, ["a", "b", "c"]);

    deferred.get("c")!.resolve();
    const summary = await summaryPromise;

    assertEquals(summary.processed, 3);
    assertEquals(summary.succeeded, 2);
    assertEquals(summary.failed, 1);
    assertEquals(summary.stopped, true);
    assertEquals(summary.stopReason, "success_limit");
  } finally {
    db.close();
  }
});

Deno.test("runQueue counts only new successes toward max success", async () => {
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
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    for (const inputPath of ["a", "b", "c"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }
    jobStore.updateStatus({
      id: "job-a",
      status: "succeeded",
      attempts: 1,
      now,
      completedAt: now,
    });
    runStore.updateCounts("run-1");

    const started: string[] = [];
    const client: ImageEditClientLike = {
      editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
    };

    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 1,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => Promise.resolve(),
      maxSuccess: 2,
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
    });

    const run = runStore.get("run-1");
    const secondJob = jobStore.findByInputPath("run-1", "b");
    const thirdJob = jobStore.findByInputPath("run-1", "c");

    assertEquals(started, ["b", "c"]);
    assertEquals(summary.processed, 2);
    assertEquals(summary.succeeded, 2);
    assertEquals(summary.stopped, true);
    assertEquals(summary.stopReason, "success_limit");
    assertEquals(run?.status, "running");
    assertEquals(secondJob?.status, "succeeded");
    assertEquals(thirdJob?.status, "succeeded");
  } finally {
    db.close();
  }
});

Deno.test("runQueue does not start a job when stop is requested during min delay", async () => {
  const db = openMemoryDatabase();
  try {
    const runStore = new RunStore(db);
    const jobStore = new JobStore(db);
    const attemptStore = new AttemptStore(db);
    const outputStore = new OutputStore(db);
    const outputDir = await Deno.makeTempDir();
    const now = "2026-05-01T00:00:00.000Z";
    let stopRequested = false;

    runStore.create({
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
    jobStore.upsert({
      id: "job-1",
      runId: "run-1",
      inputPath: "a",
      outputPath: join(outputDir, "a.png"),
      now,
    });

    const started: string[] = [];
    const client: ImageEditClientLike = {
      editImage: () => Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" }),
    };
    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 1,
      minDelayMs: 1,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: () => {
        stopRequested = true;
        return Promise.resolve();
      },
      stopRequested: () => stopRequested,
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
    });

    const run = runStore.get("run-1");
    const job = jobStore.findByInputPath("run-1", "a");

    assertEquals(started, []);
    assertEquals(summary.processed, 0);
    assertEquals(summary.stopped, true);
    assertEquals(summary.stopReason, "interrupted");
    assertEquals(run?.status, "running");
    assertEquals(job?.status, "pending");
  } finally {
    db.close();
  }
});

Deno.test("runQueue waits for run cooldown after retryable failure before next pending job", async () => {
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
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    for (const inputPath of ["a", "b"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }

    const started: string[] = [];
    const sleeps: number[] = [];
    let calls = 0;
    const client: ImageEditClientLike = {
      editImage: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(
            new ApiError({
              kind: "rate_limit",
              retryable: true,
              stopRun: false,
              message: "slow down",
              status: 429,
              retryAfterMs: 2000,
            }),
          );
        }
        return Promise.resolve({ bytes: new Uint8Array([1]), outputFormat: "png" });
      },
    };

    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 1,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 10_000, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      onJobStart: ({ job }) => {
        started.push(job.inputPath);
      },
    });

    assertEquals(started, ["a", "b"]);
    assertEquals(sleeps, [2000]);
    assertEquals(summary.processed, 2);
    assertEquals(summary.retryable, 1);
    assertEquals(summary.succeeded, 1);
  } finally {
    db.close();
  }
});

Deno.test("runQueue uses longest cooldown from concurrent retryable failures", async () => {
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
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: now,
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    for (const inputPath of ["a", "b"]) {
      jobStore.upsert({
        id: `job-${inputPath}`,
        runId: "run-1",
        inputPath,
        outputPath: join(outputDir, `${inputPath}.png`),
        now,
      });
    }

    const delays = [1000, 3000];
    const sleeps: number[] = [];
    const cooldowns: number[] = [];
    let calls = 0;
    const client: ImageEditClientLike = {
      editImage: () => {
        const retryAfterMs = delays[calls++];
        return Promise.reject(
          new ApiError({
            kind: "rate_limit",
            retryable: true,
            stopRun: false,
            message: "slow down",
            status: 429,
            retryAfterMs,
          }),
        );
      },
    };

    const summary = await runQueue({
      runId: "run-1",
      prompt: "translate",
      concurrency: 2,
      minDelayMs: 0,
      failFast: false,
      formatFromApi: true,
      retry: { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 10_000, backoffFactor: 2 },
      client,
      runStore,
      jobStore,
      attemptStore,
      outputStore,
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      onCooldown: ({ delayMs }) => {
        cooldowns.push(delayMs);
      },
    });

    assertEquals(summary.processed, 2);
    assertEquals(summary.retryable, 2);
    assertEquals(sleeps, [3000]);
    assertEquals(cooldowns, [3000]);
  } finally {
    db.close();
  }
});

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}
