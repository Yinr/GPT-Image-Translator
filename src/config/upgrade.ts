import { parse, stringify } from "@std/yaml";
import { CURRENT_CONFIG_VERSION, defaultConfig } from "./defaults.ts";
import { parseConfigDocument, ProjectConfig, readConfigDocumentVersion } from "./project-config.ts";
import type { ResolvedConfig } from "../shared/types.ts";

export interface UpgradeConfigOptions {
  dryRun?: boolean;
  fullUpdate?: boolean;
  allowDropComments?: boolean;
  readTextFile?: typeof Deno.readTextFile;
  writeTextFile?: typeof Deno.writeTextFile;
}

export interface UpgradeConfigResult {
  changed: boolean;
  fromVersion: number;
  toVersion: number;
  appliedMigrations: string[];
  appendedKeys: string[];
  fullUpdate: boolean;
  text: string;
}

interface ConfigMigration {
  fromVersion: number;
  toVersion: number;
  name: string;
  apply: (state: UpgradeState) => void;
}

interface UpgradeState {
  text: string;
  parsed: Record<string, unknown>;
  appendedKeys: string[];
}

const LOGGING_BLOCK = `# 诊断日志配置。默认关闭，不影响命令行进度输出
logging:
  # 是否启用诊断日志记录。可选：true / false
  enabled: false

  # 日志等级。可选：debug / info / warn / error
  level: info

  # 日志目录。启用文件日志时会自动创建
  dir: ./logs

  # 是否把诊断日志也输出到控制台。进度提示不受此项影响
  console: false

  # 是否写入日志文件
  file: true`;

const PREPROCESS_BLOCK = `# 图片预处理配置。默认关闭，保持原图直接提交给接口
preprocess:
  aspectPad:
    # 是否启用长宽比补边预处理。可选：true / false
    enabled: false

    # 补边颜色。可选：transparent / white
    fill: transparent

    # 是否在接口返回后裁剪回原图区域。可选：true / false
    cropBackToOriginal: false

    # 保留未裁剪接口输出的中间目录，必须是 outputDir 内的相对路径
    intermediateDir: .intermediate`;

const MIGRATIONS: ConfigMigration[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    name: "add configVersion and logging defaults",
    apply: (state) => {
      if (!Object.hasOwn(state.parsed, "configVersion")) {
        state.text = prependBlock(state.text, configVersionBlock(1));
        state.parsed.configVersion = 1;
        state.appendedKeys.push("configVersion");
      } else if (state.parsed.configVersion === 0) {
        state.text = replaceTopLevelConfigVersion(state.text, 1);
        state.parsed.configVersion = 1;
        state.appendedKeys.push("configVersion");
      }

      if (!Object.hasOwn(state.parsed, "logging")) {
        state.text = appendBlocks(state.text, [LOGGING_BLOCK]);
        state.parsed.logging = structuredClone(defaultConfig.logging) as unknown as Record<
          string,
          unknown
        >;
        state.appendedKeys.push("logging");
      }
    },
  },
  {
    fromVersion: 1,
    toVersion: 2,
    name: "add preprocess aspectPad defaults",
    apply: (state) => {
      state.text = replaceTopLevelConfigVersion(state.text, 2);
      state.parsed.configVersion = 2;
      if (!state.appendedKeys.includes("configVersion")) state.appendedKeys.push("configVersion");

      if (!Object.hasOwn(state.parsed, "preprocess")) {
        state.text = appendBlocks(state.text, [PREPROCESS_BLOCK]);
        state.parsed.preprocess = structuredClone(defaultConfig.preprocess) as unknown as Record<
          string,
          unknown
        >;
        state.appendedKeys.push("preprocess");
      }
    },
  },
];

export async function upgradeConfigFile(
  configPath: string,
  options: UpgradeConfigOptions = {},
): Promise<UpgradeConfigResult> {
  const readTextFile = options.readTextFile ?? Deno.readTextFile;
  const writeTextFile = options.writeTextFile ?? Deno.writeTextFile;
  const text = await readTextFile(configPath);
  const result = upgradeConfigText(text, options);

  if (result.changed && !options.dryRun) {
    await writeTextFile(configPath, result.text);
  }

  return result;
}

export function upgradeConfigText(
  text: string,
  options: Pick<UpgradeConfigOptions, "fullUpdate" | "allowDropComments"> = {},
): UpgradeConfigResult {
  const parsed = parseConfigDocument(text);
  ProjectConfig.fromParsedDocument(parsed);

  const fromVersion = readConfigDocumentVersion(parsed);
  if (fromVersion > CURRENT_CONFIG_VERSION) {
    throw new Error(
      `Config version ${fromVersion} is newer than supported version ${CURRENT_CONFIG_VERSION}`,
    );
  }

  if (options.fullUpdate) {
    return fullUpdateConfig(text, parsed, fromVersion, Boolean(options.allowDropComments));
  }

  const state: UpgradeState = { text, parsed: { ...parsed }, appendedKeys: [] };
  const appliedMigrations: string[] = [];
  let currentVersion = fromVersion;

  for (const migration of MIGRATIONS) {
    if (migration.fromVersion !== currentVersion) continue;
    migration.apply(state);
    currentVersion = migration.toVersion;
    appliedMigrations.push(migration.name);
  }

  if (currentVersion !== CURRENT_CONFIG_VERSION) {
    throw new Error(
      `No config migration path from version ${fromVersion} to ${CURRENT_CONFIG_VERSION}`,
    );
  }

  const changed = state.text !== text;
  return {
    changed,
    fromVersion,
    toVersion: currentVersion,
    appliedMigrations,
    appendedKeys: state.appendedKeys,
    fullUpdate: false,
    text: state.text,
  };
}

export function isConfigOutdated(config: ResolvedConfig): boolean {
  return ProjectConfig.fromResolvedConfig(config).isOutdated();
}

function fullUpdateConfig(
  text: string,
  parsed: Record<string, unknown>,
  fromVersion: number,
  allowDropComments: boolean,
): UpgradeConfigResult {
  if (hasComments(text) && !allowDropComments) {
    throw new Error(
      "Full config update would drop comments; pass --allow-drop-comments to continue",
    );
  }

  const merged = toResolvedConfig(parsed);
  merged.configVersion = CURRENT_CONFIG_VERSION;
  const updatedText = stringify(ProjectConfig.serializeResolvedConfig(merged));
  return {
    changed: updatedText !== text,
    fromVersion,
    toVersion: CURRENT_CONFIG_VERSION,
    appliedMigrations: ["full update to current config shape"],
    appendedKeys: [],
    fullUpdate: true,
    text: updatedText.endsWith("\n") ? updatedText : `${updatedText}\n`,
  };
}

function toResolvedConfig(parsed: Record<string, unknown>): ResolvedConfig {
  return ProjectConfig.fromParsedDocument(parsed).resolved;
}

function prependBlock(text: string, block: string): string {
  return `${block}\n\n${text.replace(/^\s+/, "")}`;
}

function replaceTopLevelConfigVersion(text: string, version: number): string {
  const replaced = text.replace(/^(configVersion\s*:\s*)\d+\s*$/m, `$1${version}`);
  return replaced === text ? prependBlock(text, configVersionBlock(version)) : replaced;
}

function configVersionBlock(version: number): string {
  return `# 配置文件版本。用于未来安全补全旧配置文件
configVersion: ${version}`;
}

function appendBlocks(text: string, blocks: string[]): string {
  const base = text.endsWith("\n") ? text.trimEnd() : text;
  return `${base}\n\n${blocks.join("\n\n")}\n`;
}

function hasComments(text: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trimStart().startsWith("#"));
}
