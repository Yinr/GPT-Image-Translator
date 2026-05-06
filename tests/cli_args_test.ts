import { assertEquals } from "@std/assert";
import { parseCliArgs } from "../src/cli/args.ts";

Deno.test("parseCliArgs defaults to translate command", () => {
  const args = parseCliArgs(["--config", "config.yaml", "--dry-run"]);

  assertEquals(args.command, "translate");
  assertEquals(args.config, "config.yaml");
  assertEquals(args.dryRun, true);
  assertEquals(args.help, false);
});

Deno.test("parseCliArgs parses query subcommands", () => {
  const args = parseCliArgs([
    "inspect",
    "--config",
    "config.yaml",
    "--db",
    "./data.db",
    "--run",
    "run-1",
  ]);

  assertEquals(args.command, "inspect");
  assertEquals(args.config, "config.yaml");
  assertEquals(args.db, "./data.db");
  assertEquals(args.runId, "run-1");
});

Deno.test("parseCliArgs parses translate run restore options", () => {
  const args = parseCliArgs(["translate", "--run", "run-1", "--db", "./data.db"]);

  assertEquals(args.command, "translate");
  assertEquals(args.runId, "run-1");
  assertEquals(args.db, "./data.db");
});

Deno.test("parseCliArgs rejects empty db path", () => {
  try {
    parseCliArgs(["status", "--db", "  "]);
    throw new Error("Expected parseCliArgs to reject empty db path");
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "--db must not be empty",
    );
  }
});

Deno.test("parseCliArgs parses status limit", () => {
  const args = parseCliArgs(["status", "--config", "config.yaml", "--limit", "5"]);

  assertEquals(args.command, "status");
  assertEquals(args.limit, 5);
});

Deno.test("parseCliArgs parses max success for translate", () => {
  const args = parseCliArgs(["--config", "config.yaml", "--max-success", "3"]);

  assertEquals(args.command, "translate");
  assertEquals(args.maxSuccess, 3);
});

Deno.test("parseCliArgs rejects zero max success", () => {
  try {
    parseCliArgs(["--config", "config.yaml", "--max-success", "0"]);
    throw new Error("Expected parseCliArgs to reject zero max success");
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "--max-success must be a positive integer",
    );
  }
});

Deno.test("parseCliArgs rejects negative max success", () => {
  try {
    parseCliArgs(["--config", "config.yaml", "--max-success", "-1"]);
    throw new Error("Expected parseCliArgs to reject negative max success");
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "--max-success must be a positive integer",
    );
  }
});

Deno.test("parseCliArgs rejects non-numeric max success", () => {
  try {
    parseCliArgs(["--config", "config.yaml", "--max-success", "abc"]);
    throw new Error("Expected parseCliArgs to reject non-numeric max success");
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "--max-success must be a positive integer",
    );
  }
});

Deno.test("parseCliArgs parses help flag", () => {
  const args = parseCliArgs(["-h"]);

  assertEquals(args.command, "translate");
  assertEquals(args.help, true);
});

Deno.test("parseCliArgs parses version flag", () => {
  const args = parseCliArgs(["--version"]);

  assertEquals(args.command, "version");
  assertEquals(args.version, true);
});

Deno.test("parseCliArgs parses version command", () => {
  const args = parseCliArgs(["version"]);

  assertEquals(args.command, "version");
  assertEquals(args.version, false);
});

Deno.test("parseCliArgs parses config upgrade flags", () => {
  const args = parseCliArgs([
    "config",
    "upgrade",
    "--config",
    "config.yaml",
    "--dry-run",
    "--full-update",
    "--allow-drop-comments",
  ]);

  assertEquals(args.command, "config-upgrade");
  assertEquals(args.config, "config.yaml");
  assertEquals(args.dryRun, true);
  assertEquals(args.fullUpdate, true);
  assertEquals(args.allowDropComments, true);
});

Deno.test("parseCliArgs rejects unknown commands", () => {
  try {
    parseCliArgs(["unknown", "--config", "config.yaml"]);
    throw new Error("Expected parseCliArgs to reject unknown command");
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "Unknown command: unknown",
    );
  }
});

Deno.test("parseCliArgs rejects unknown config subcommands", () => {
  try {
    parseCliArgs(["config", "update", "--config", "config.yaml"]);
    throw new Error("Expected parseCliArgs to reject unknown config subcommand");
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "Unknown command: config update",
    );
  }
});
