import { upgradeConfigFile } from "./config/upgrade.ts";
import { CURRENT_CONFIG_VERSION } from "./config/defaults.ts";
import { ProjectConfig } from "./config/project-config.ts";
import { HELP_TEXT, parseCliArgs } from "./cli/args.ts";
import { APP_NAME, APP_VERSION } from "./shared/app-meta.ts";
import { execute, type ExecuteResult } from "./cli/run.ts";
import {
  formatFailedJobs,
  formatInterruptMessage,
  formatSummary,
  formatTranslateLog,
} from "./cli/terminal-format.ts";
import { runFailedCommand, runInspectCommand, runStatusCommand } from "./cli/query-commands.ts";
import type { JobDetail, RunDetail } from "./services/run-query.ts";
import type { RunRecord } from "./shared/types.ts";

if (import.meta.main) {
  await main(Deno.args);
}

export async function main(args: string[]): Promise<void> {
  let cli;
  try {
    cli = parseCliArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    return;
  }
  if (cli.help) {
    printHelp();
    return;
  }

  if (cli.command === "version") {
    console.log(APP_VERSION);
    return;
  }

  const configPath = cli.config;
  if (!configPath) {
    printHelp();
    return;
  }

  if (cli.command === "config-upgrade") {
    const result = await upgradeConfigFile(configPath, {
      dryRun: cli.dryRun,
      fullUpdate: cli.fullUpdate,
      allowDropComments: cli.allowDropComments,
    });
    if (!result.changed) {
      console.log(`Config is already up to date: ${configPath}`);
      return;
    }

    if (cli.dryRun) {
      console.log(`Config upgrade preview: ${configPath}`);
      console.log(`Version: ${result.fromVersion} -> ${result.toVersion}`);
      console.log(`Mode: ${result.fullUpdate ? "full update" : "safe append"}`);
      console.log(`Would update: ${result.appendedKeys.join(", ") || "full config"}`);
      console.log(result.text);
      return;
    }

    console.log(`Config upgraded: ${configPath}`);
    console.log(`Version: ${result.fromVersion} -> ${result.toVersion}`);
    console.log(`Updated: ${result.appendedKeys.join(", ") || "full config"}`);
    return;
  }

  const projectConfig = await ProjectConfig.load(configPath);
  const config = projectConfig.resolved;
  if (projectConfig.isOutdated()) {
    console.warn(
      `Config version ${config.configVersion} is older than current version ${CURRENT_CONFIG_VERSION}. Run "${APP_NAME} config upgrade --config ${configPath}" to update it.`,
    );
  }
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

  console.log(`Loaded config: ${configPath}`);
  const interrupt = cli.dryRun ? undefined : createInterruptController();
  const result = await execute({
    config,
    dryRun: cli.dryRun,
    maxSuccess: cli.maxSuccess,
    log: (message) => console.log(formatTranslateLog(message)),
    stopRequested: interrupt?.stopRequested,
  }).finally(() => interrupt?.dispose());
  printSummary(result, cli.dryRun);
}

function printHelp(): void {
  console.log(HELP_TEXT);
}

function printSummary(result: ExecuteResult, dryRun: boolean): void {
  console.log(formatSummary(result, dryRun));
  for (const line of formatFailedJobs(result)) console.log(line);
}

interface InterruptController {
  stopRequested: () => boolean;
  dispose: () => void;
}

function createInterruptController(): InterruptController | undefined {
  let requested = false;
  let forced = false;
  const handler = () => {
    if (!requested) {
      requested = true;
      console.warn(formatInterruptMessage("graceful"));
      return;
    }

    if (!forced) {
      forced = true;
      console.error(formatInterruptMessage("force"));
      Deno.exit(130);
    }
  };

  Deno.addSignalListener("SIGINT", handler);
  return {
    stopRequested: () => requested,
    dispose: () => Deno.removeSignalListener("SIGINT", handler),
  };
}
