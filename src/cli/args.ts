import { parseArgs } from "@std/cli/parse-args";

export interface CliArgs {
  command: "translate" | "status" | "inspect" | "failed";
  config?: string;
  dryRun: boolean;
  help: boolean;
  runId?: string;
  limit: number;
}

export const APP_NAME = "gpt-image-translator";

export const HELP_TEXT = `GPT Image Translator

批量翻译目录中的图片，保持原目录结构输出，并将运行状态保存在 SQLite 中。

Usage:
  ${APP_NAME} --config <path> [--dry-run]
  ${APP_NAME} status --config <path> [--limit <n>]
  ${APP_NAME} inspect --config <path> --run <runId>
  ${APP_NAME} failed --config <path> --run <runId>

Commands:
  translate  执行图片翻译任务，默认命令
  status     查看最近 runs 列表
  inspect    查看指定 run 的详细信息
  failed     查看指定 run 的失败 jobs

Options:
  -c, --config <path>  配置文件路径
      --dry-run        只扫描和规划，不实际请求 API
  -r, --run <runId>    inspect / failed 使用的 run id
      --limit <n>      status 返回的最近 runs 数量，默认 20
  -h, --help           显示帮助

Examples:
  ${APP_NAME} --config ./config.yaml
  ${APP_NAME} --config ./config.yaml --dry-run
  ${APP_NAME} status --config ./config.yaml --limit 10
  ${APP_NAME} inspect --config ./config.yaml --run run_123`;

export function parseCliArgs(args: string[]): CliArgs {
  const command = readCommand(args);
  const rest = isCommand(args[0]) ? args.slice(1) : args;
  const parsed = parseArgs(rest, {
    boolean: ["dry-run", "help"],
    string: ["config", "run"],
    alias: { config: "c", run: "r", help: "h" },
    default: { "dry-run": false, help: false, limit: 20 },
  });

  return {
    command,
    config: parsed.config,
    dryRun: parsed["dry-run"],
    help: parsed.help,
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
