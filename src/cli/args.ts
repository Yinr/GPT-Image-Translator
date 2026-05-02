import { parseArgs } from "@std/cli/parse-args";

export interface CliArgs {
  command: "translate" | "status" | "inspect" | "failed";
  config?: string;
  dryRun: boolean;
  runId?: string;
  limit: number;
}

export function parseCliArgs(args: string[]): CliArgs {
  const command = readCommand(args);
  const rest = isCommand(args[0]) ? args.slice(1) : args;
  const parsed = parseArgs(rest, {
    boolean: ["dry-run"],
    string: ["config", "run"],
    alias: { config: "c", run: "r" },
    default: { "dry-run": false, limit: 20 },
  });

  return {
    command,
    config: parsed.config,
    dryRun: parsed["dry-run"],
    runId: parsed.run,
    limit: Number(parsed.limit ?? 20),
  };
}

function readCommand(args: string[]): CliArgs["command"] {
  return isCommand(args[0]) ? args[0] : "translate";
}

function isCommand(value: string | undefined): value is CliArgs["command"] {
  return value === "translate" || value === "status" || value === "inspect" || value === "failed";
}
