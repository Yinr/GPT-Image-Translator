import { loadConfig } from "./config/load.ts";
import { parseCliArgs } from "./cli/args.ts";
import { execute, type ExecuteResult } from "./cli/run.ts";
import { runFailedCommand, runInspectCommand, runStatusCommand } from "./cli/query-commands.ts";
import type { JobDetail, RunDetail } from "./services/run-query.ts";
import type { RunRecord } from "./shared/types.ts";

if (import.meta.main) {
  await main(Deno.args);
}

export async function main(args: string[]): Promise<void> {
  const cli = parseCliArgs(args);
  const configPath = cli.config;
  if (!configPath) {
    printHelp();
    return;
  }

  const config = await loadConfig(configPath);
  if (cli.command === "status") {
    const runs = await runStatusCommand(config.storage.sqlitePath, cli.limit);
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  if (cli.command === "inspect") {
    if (!cli.runId) throw new Error("inspect requires --run <runId>");
    const detail = await runInspectCommand(config.storage.sqlitePath, cli.runId);
    console.log(JSON.stringify(detail, null, 2));
    return;
  }

  if (cli.command === "failed") {
    if (!cli.runId) throw new Error("failed requires --run <runId>");
    const jobs = await runFailedCommand(config.storage.sqlitePath, cli.runId);
    console.log(JSON.stringify(jobs, null, 2));
    return;
  }

  const result = await execute({ config, dryRun: cli.dryRun });
  console.log(`Loaded config: ${configPath}`);
  printSummary(result, cli.dryRun);
  console.log(JSON.stringify(result, null, 2));
}

function printHelp(): void {
  console.log(`Usage:
  deno task translate --config ./config.example.yaml [--dry-run]
  deno task translate status --config ./config.example.yaml [--limit 20]
  deno task translate inspect --config ./config.example.yaml --run <runId>
  deno task translate failed --config ./config.example.yaml --run <runId>`);
}

function printSummary(result: ExecuteResult, dryRun: boolean): void {
  if (dryRun) {
    console.log(`Dry run: ${result.totalImages} image(s), ${result.plannedJobs} planned job(s).`);
    return;
  }

  console.log(
    [
      `Run: ${result.runId ?? "n/a"}`,
      `resumed=${result.resumed ? "yes" : "no"}`,
      `processed=${result.processed ?? 0}`,
      `succeeded=${result.succeeded ?? 0}`,
      `retryable=${result.retryable ?? 0}`,
      `failed=${result.failed ?? 0}`,
      `skipped=${result.skipped ?? 0}`,
      `pending=${result.pending ?? 0}`,
      `stopped=${result.stopped ? "yes" : "no"}`,
    ].join(" | "),
  );

  if (result.failedJobs && result.failedJobs.length > 0) {
    console.log("Failed jobs:");
    for (const failedJob of result.failedJobs) {
      console.log(
        `- ${failedJob.inputPath} -> ${failedJob.outputPath} [${
          failedJob.errorType ?? "unknown"
        }] ${failedJob.errorMessage ?? ""}`
          .trim(),
      );
    }
  }
}
