import { assertEquals } from "@std/assert";
import { createLogger, logFilePath } from "../src/logging/logger.ts";
import type { LoggingConfig } from "../src/shared/types.ts";

const enabledConfig: LoggingConfig = {
  enabled: true,
  level: "info",
  dir: "./logs",
  console: false,
  file: true,
};

Deno.test("createLogger returns no-op logger when disabled", async () => {
  const writes: string[] = [];
  const mkdirs: string[] = [];
  const logger = createLogger({
    config: { ...enabledConfig, enabled: false },
    writeTextFile: (_path, data) => {
      writes.push(String(data));
      return Promise.resolve();
    },
    mkdir: (path) => {
      mkdirs.push(String(path));
      return Promise.resolve();
    },
  });

  await logger.error("hidden");

  assertEquals(writes, []);
  assertEquals(mkdirs, []);
});

Deno.test("logger filters by configured level", async () => {
  const writes: string[] = [];
  const logger = createLogger({
    config: enabledConfig,
    now: () => new Date(2026, 4, 2, 0, 0, 0),
    writeTextFile: (_path, data) => {
      writes.push(String(data));
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
  });

  await logger.debug("debug message");
  await logger.info("info message", { runId: "run-1" });

  assertEquals(writes, [
    '[2026-05-02 00:00:00] [INFO] info message {"runId":"run-1"}\n',
  ]);
});

Deno.test("logger creates directory once before file logging", async () => {
  const mkdirs: string[] = [];
  const writes: string[] = [];
  const logger = createLogger({
    config: enabledConfig,
    runId: "run-1",
    now: () => new Date(2026, 4, 2, 8, 30, 45),
    mkdir: (path) => {
      mkdirs.push(String(path));
      return Promise.resolve();
    },
    writeTextFile: (path, data) => {
      writes.push(`${path}:${String(data)}`);
      return Promise.resolve();
    },
  });

  await logger.info("first");
  await logger.warn("second");

  assertEquals(mkdirs, ["./logs"]);
  assertEquals(writes, [
    "logs\\20260502_083045_run-1.log:[2026-05-02 08:30:45] [INFO] first\n",
    "logs\\20260502_083045_run-1.log:[2026-05-02 08:30:45] [WARN] second\n",
  ]);
});

Deno.test("logger supports console sink", async () => {
  const logs: string[] = [];
  const logger = createLogger({
    config: { ...enabledConfig, file: false, console: true },
    now: () => new Date(2026, 4, 2, 0, 0, 0),
    consoleLog: (message) => logs.push(message),
  });

  await logger.info("visible");

  assertEquals(logs, ["[2026-05-02 00:00:00] [INFO] visible"]);
});

Deno.test("logFilePath sanitizes run id", () => {
  assertEquals(
    logFilePath("./logs", "run:1/2", () => new Date(2026, 4, 2, 8, 30, 45)),
    "logs\\20260502_083045_run_1_2.log",
  );
});
