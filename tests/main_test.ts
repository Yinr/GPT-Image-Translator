import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { main } from "../src/main.ts";
import { defaultConfig } from "../src/config/defaults.ts";
import { createRunConfigSnapshot } from "../src/config/snapshot.ts";
import { createRunHash } from "../src/core/run-id.ts";
import { openDatabase } from "../src/storage/db.ts";
import { RunConfigStore } from "../src/storage/run-config-store.ts";
import { RunStore } from "../src/storage/run-store.ts";

Deno.test("main status uses db path without config", async () => {
  const dir = await Deno.makeTempDir();
  const sqlitePath = join(dir, "data.db");
  const db = await openDatabase(sqlitePath);
  try {
    new RunStore(db).create({
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
  } finally {
    db.close();
  }

  const logs: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (message?: unknown) => logs.push(String(message));
    await main(["status", "--db", sqlitePath, "--limit", "1"]);
  } finally {
    console.log = originalLog;
  }

  const runs = JSON.parse(logs[0]);
  assertEquals(runs[0].id, "run-1");
  assertEquals(runs[0].runHash, "hash");
});

Deno.test("main db option overrides config sqlite path", async () => {
  const dir = await Deno.makeTempDir();
  const configDbPath = join(dir, "config.db");
  const overrideDbPath = join(dir, "override.db");
  const configPath = join(dir, "config.yaml");
  await Deno.writeTextFile(
    configPath,
    `configVersion: 2
inputDir: ./input
outputDir: ./output
prompt: translate
storage:
  sqlitePath: ${configDbPath.replaceAll("\\", "\\\\")}
`,
  );

  const db = await openDatabase(overrideDbPath);
  try {
    new RunStore(db).create({
      id: "override-run",
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
  } finally {
    db.close();
  }

  const logs: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (message?: unknown) => logs.push(String(message));
    await main(["status", "--config", configPath, "--db", overrideDbPath, "--limit", "1"]);
  } finally {
    console.log = originalLog;
  }

  const runs = JSON.parse(logs[0]);
  assertEquals(runs[0].id, "override-run");
});

Deno.test("main restores translate run from snapshot without config", async () => {
  const dir = await Deno.makeTempDir();
  const inputDir = join(dir, "input");
  const outputDir = join(dir, "output");
  const sqlitePath = join(dir, "data.db");
  await Deno.mkdir(inputDir);
  await Deno.mkdir(outputDir);
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));
  await Deno.writeFile(join(outputDir, "a.png"), new Uint8Array([1]));

  const config = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    storage: { sqlitePath },
  };
  const snapshot = createRunConfigSnapshot(config);
  const db = await openDatabase(sqlitePath);
  try {
    new RunStore(db).create({
      id: "run-1",
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
    new RunConfigStore(db).create({
      runId: "run-1",
      configVersion: snapshot.configVersion,
      configJson: JSON.stringify(snapshot),
      createdAt: "2026-05-01T00:00:00.000Z",
    });
  } finally {
    db.close();
  }

  const logs: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (message?: unknown) => logs.push(String(message));
    await main(["translate", "--run", "run-1", "--db", sqlitePath]);
  } finally {
    console.log = originalLog;
  }

  assertEquals(logs[0], "Restored config from run: run-1");
  assertEquals(logs.some((message) => message.includes("run=run-1")), true);
  assertEquals(logs.some((message) => message.includes("resumed=yes")), true);
  assertEquals(logs.some((message) => message.includes("skipped=1")), true);

  const verifyDb = await openDatabase(sqlitePath);
  try {
    const run = new RunStore(verifyDb).get("run-1");
    assertEquals(run?.status, "completed");
    assertEquals(run?.succeededJobs, 0);
    assertEquals(run?.skippedJobs, 1);
  } finally {
    verifyDb.close();
  }
});

Deno.test("main rejects missing translate run", async () => {
  const dir = await Deno.makeTempDir();

  await assertRejects(
    () => main(["translate", "--run", "missing", "--db", join(dir, "data.db")]),
    Error,
    "Run not found: missing",
  );
});

Deno.test("main rejects non-running translate run restore", async () => {
  const dir = await Deno.makeTempDir();
  const sqlitePath = join(dir, "data.db");
  const db = await openDatabase(sqlitePath);
  try {
    new RunStore(db).create({
      id: "run-1",
      status: "completed",
      runHash: "hash",
      inputDir: "/input",
      outputDir: "/output",
      startedAt: "2026-05-01T00:00:00.000Z",
      finishedAt: "2026-05-01T00:00:01.000Z",
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
  } finally {
    db.close();
  }

  await assertRejects(
    () => main(["translate", "--run", "run-1", "--db", sqlitePath]),
    Error,
    "Run run-1 is not resumable: status=completed",
  );
});

Deno.test("main rejects translate run restore without snapshot", async () => {
  const dir = await Deno.makeTempDir();
  const sqlitePath = join(dir, "data.db");
  const db = await openDatabase(sqlitePath);
  try {
    new RunStore(db).create({
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
  } finally {
    db.close();
  }

  await assertRejects(
    () => main(["translate", "--run", "run-1", "--db", sqlitePath]),
    Error,
    "Run config snapshot not found: run-1",
  );
});

Deno.test("main rejects translate run restore when snapshot identity mismatches run", async () => {
  const dir = await Deno.makeTempDir();
  const inputDir = join(dir, "input");
  const outputDir = join(dir, "output");
  const sqlitePath = join(dir, "data.db");
  await Deno.mkdir(inputDir);
  await Deno.mkdir(outputDir);
  await Deno.writeFile(join(inputDir, "a.jpg"), new Uint8Array([1]));

  const config = {
    ...structuredClone(defaultConfig),
    inputDir,
    outputDir,
    prompt: "translate",
    storage: { sqlitePath },
  };
  const snapshot = createRunConfigSnapshot(config);
  const db = await openDatabase(sqlitePath);
  try {
    new RunStore(db).create({
      id: "run-1",
      status: "running",
      runHash: "different-run-hash",
      inputDir,
      outputDir,
      startedAt: "2026-05-01T00:00:00.000Z",
      totalJobs: 0,
      succeededJobs: 0,
      failedJobs: 0,
      skippedJobs: 0,
    });
    new RunConfigStore(db).create({
      runId: "run-1",
      configVersion: snapshot.configVersion,
      configJson: JSON.stringify(snapshot),
      createdAt: "2026-05-01T00:00:00.000Z",
    });
  } finally {
    db.close();
  }

  await assertRejects(
    () => main(["translate", "--run", "run-1", "--db", sqlitePath]),
    Error,
    "Run run-1 does not match stored config snapshot identity",
  );
});

Deno.test("main rejects config overrides for translate run restore", async () => {
  const dir = await Deno.makeTempDir();

  await assertRejects(
    () =>
      main([
        "translate",
        "--run",
        "run-1",
        "--config",
        join(dir, "config.yaml"),
        "--db",
        join(dir, "data.db"),
      ]),
    Error,
    "translate --run does not support --config overrides yet",
  );
});
