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
  const args = parseCliArgs(["inspect", "--config", "config.yaml", "--run", "run-1"]);

  assertEquals(args.command, "inspect");
  assertEquals(args.config, "config.yaml");
  assertEquals(args.runId, "run-1");
});

Deno.test("parseCliArgs parses status limit", () => {
  const args = parseCliArgs(["status", "--config", "config.yaml", "--limit", "5"]);

  assertEquals(args.command, "status");
  assertEquals(args.limit, 5);
});

Deno.test("parseCliArgs parses help flag", () => {
  const args = parseCliArgs(["-h"]);

  assertEquals(args.command, "translate");
  assertEquals(args.help, true);
});
