import { upgradeConfigFile } from "./config/upgrade.ts";
import { CURRENT_CONFIG_VERSION, defaultConfig } from "./config/defaults.ts";
import { ProjectConfig } from "./config/project-config.ts";
import { HELP_TEXT, parseCliArgs } from "./cli/args.ts";
import { APP_NAME, APP_VERSION } from "./shared/app-meta.ts";
import { execute, type ExecuteResult } from "./cli/run.ts";
import { createRunHash } from "./core/run-id.ts";
import {
  formatFailedJobs,
  formatInterruptMessage,
  formatSummary,
  formatTranslateLog,
} from "./cli/terminal-format.ts";
import { runFailedCommand, runInspectCommand, runStatusCommand } from "./cli/query-commands.ts";
import { RUN_STATUS } from "./shared/status.ts";
import type { ResolvedConfig } from "./shared/types.ts";
import { openDatabase } from "./storage/db.ts";
import { RunConfigStore } from "./storage/run-config-store.ts";
import { RunStore } from "./storage/run-store.ts";

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

  if (cli.command === "config-upgrade") {
    if (!configPath) {
      printHelp();
      return;
    }
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

  const restoringRun = cli.command === "translate" && cli.runId !== undefined;
  if (restoringRun && configPath) {
    throw new Error("translate --run does not support --config overrides yet");
  }
  const projectConfig = configPath && !restoringRun
    ? await ProjectConfig.load(configPath)
    : undefined;
  let config = projectConfig?.resolved;
  if (restoringRun) config = await restoreRunConfig(dbPathFor(cli.db, config), cli.runId!);
  if (config && cli.db) config.storage.sqlitePath = cli.db;
  const dbPath = cli.db ?? config?.storage.sqlitePath ?? defaultConfig.storage.sqlitePath;
  if (projectConfig?.isOutdated() && config) {
    console.warn(
      `Config version ${config.configVersion} is older than current version ${CURRENT_CONFIG_VERSION}. Run "${APP_NAME} config upgrade --config ${configPath}" to update it.`,
    );
  }
  if (cli.command === "status") {
    const runs = await runStatusCommand(dbPath, cli.limit);
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  if (cli.command === "inspect") {
    if (!cli.runId) throw new Error("inspect requires --run <runId>");
    const detail = await runInspectCommand(dbPath, cli.runId);
    console.log(JSON.stringify(detail, null, 2));
    return;
  }

  if (cli.command === "failed") {
    if (!cli.runId) throw new Error("failed requires --run <runId>");
    const jobs = await runFailedCommand(dbPath, cli.runId);
    console.log(JSON.stringify(jobs, null, 2));
    return;
  }

  if ((!configPath && !restoringRun) || !config) {
    printHelp();
    return;
  }

  console.log(
    restoringRun ? `Restored config from run: ${cli.runId}` : `Loaded config: ${configPath}`,
  );
  const interrupt = cli.dryRun ? undefined : createInterruptController();
  const result = await execute({
    config,
    dryRun: cli.dryRun,
    maxSuccess: cli.maxSuccess,
    resumeRunId: restoringRun ? cli.runId : undefined,
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

function dbPathFor(cliDb: string | undefined, config: ResolvedConfig | undefined): string {
  return cliDb ?? config?.storage.sqlitePath ?? defaultConfig.storage.sqlitePath;
}

async function restoreRunConfig(dbPath: string, runId: string): Promise<ResolvedConfig> {
  const db = await openDatabase(dbPath);
  try {
    const runs = new RunStore(db);
    const runConfigs = new RunConfigStore(db);
    const run = runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.status !== RUN_STATUS.running) {
      throw new Error(`Run ${runId} is not resumable: status=${run.status}`);
    }

    const snapshot = runConfigs.get(runId);
    if (!snapshot) throw new Error(`Run config snapshot not found: ${runId}`);

    const config = parseRunConfigSnapshot(snapshot.configJson);
    config.storage.sqlitePath = dbPath;
    const runHash = await createRunHash(config);
    if (runHash !== run.runHash) {
      throw new Error(`Run ${runId} does not match stored config snapshot identity`);
    }
    return config;
  } finally {
    db.close();
  }
}

function parseRunConfigSnapshot(configJson: string): ResolvedConfig {
  const parsed = JSON.parse(configJson) as unknown;
  if (!isPlainObject(parsed)) throw new Error("Run config snapshot must be a JSON object");
  return ProjectConfig.fromResolvedConfig(parsed as unknown as ResolvedConfig).resolved;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
