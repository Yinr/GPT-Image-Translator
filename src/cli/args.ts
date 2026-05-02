import { parseArgs } from "@std/cli/parse-args";

export interface CliArgs {
  command: "translate" | "status" | "inspect" | "failed" | "config-upgrade";
  config?: string;
  dryRun: boolean;
  help: boolean;
  fullUpdate: boolean;
  allowDropComments: boolean;
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
  ${APP_NAME} config upgrade --config <path> [--dry-run] [--full-update]

Commands:
  translate  执行图片翻译任务，默认命令
  status     查看最近 runs 列表
  inspect    查看指定 run 的详细信息
  failed     查看指定 run 的失败 jobs
  config upgrade  补全旧配置文件缺失的顶层配置块

Options:
  -c, --config <path>  配置文件路径
      --dry-run        只扫描和规划，不实际请求 API
  -r, --run <runId>    inspect / failed 使用的 run id
      --limit <n>      status 返回的最近 runs 数量，默认 20
      --full-update    完整重写配置为最新结构，会丢弃原格式和注释
      --allow-drop-comments  允许 full-update 重写包含注释的配置文件
  -h, --help           显示帮助

Examples:
  ${APP_NAME} --config ./config.yaml
  ${APP_NAME} --config ./config.yaml --dry-run
  ${APP_NAME} status --config ./config.yaml --limit 10
  ${APP_NAME} inspect --config ./config.yaml --run run_123
  ${APP_NAME} config upgrade --config ./config.yaml --dry-run
  ${APP_NAME} config upgrade --config ./config.yaml --full-update --allow-drop-comments`;

export function parseCliArgs(args: string[]): CliArgs {
  const command = readCommand(args);
  const rest = command === "config-upgrade"
    ? args.slice(2)
    : isCommand(args[0])
    ? args.slice(1)
    : args;
  const parsed = parseArgs(rest, {
    boolean: ["dry-run", "help", "full-update", "allow-drop-comments"],
    string: ["config", "run"],
    alias: { config: "c", run: "r", help: "h" },
    default: {
      "dry-run": false,
      help: false,
      "full-update": false,
      "allow-drop-comments": false,
      limit: 20,
    },
  });

  return {
    command,
    config: parsed.config,
    dryRun: parsed["dry-run"],
    help: parsed.help,
    fullUpdate: parsed["full-update"],
    allowDropComments: parsed["allow-drop-comments"],
    runId: parsed.run,
    limit: Number(parsed.limit ?? 20),
  };
}

function readCommand(args: string[]): CliArgs["command"] {
  if (args[0] === "config") {
    if (args[1] === "upgrade") return "config-upgrade";
    throw new Error(`Unknown command: ${[args[0], args[1]].filter(Boolean).join(" ")}`);
  }
  if (isCommand(args[0])) return args[0];
  if (args[0] && !args[0].startsWith("-")) {
    throw new Error(`Unknown command: ${args[0]}`);
  }
  return "translate";
}

function isCommand(value: string | undefined): value is CliArgs["command"] {
  return value === "translate" || value === "status" || value === "inspect" || value === "failed";
}
