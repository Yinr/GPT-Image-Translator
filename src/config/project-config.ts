import { parse } from "@std/yaml";
import type { ResolvedConfig } from "../shared/types.ts";
import { CURRENT_CONFIG_VERSION, defaultConfig } from "./defaults.ts";
import { normalizeProxyConfig } from "./proxy.ts";
import { validateConfig } from "./schema.ts";
import { resolveUserAgent } from "./user-agent.ts";

export type ConfigDocument = Record<string, unknown>;

export class ProjectConfig {
  private constructor(private readonly config: ResolvedConfig) {}

  static async load(
    configPath: string,
    readTextFile: typeof Deno.readTextFile = Deno.readTextFile,
  ): Promise<ProjectConfig> {
    return ProjectConfig.fromText(await readTextFile(configPath));
  }

  static fromText(text: string): ProjectConfig {
    return ProjectConfig.fromParsedDocument(parseConfigDocument(text));
  }

  static fromParsedDocument(parsed: ConfigDocument): ProjectConfig {
    const merged = mergeConfigDocument(defaultConfig, parsed);
    if (!Object.hasOwn(parsed, "configVersion")) merged.configVersion = 0;
    normalizeResolvedConfig(merged);
    validateConfig(merged);
    return new ProjectConfig(merged);
  }

  static fromResolvedConfig(config: ResolvedConfig): ProjectConfig {
    const clone = structuredClone(config);
    normalizeResolvedConfig(clone);
    validateConfig(clone);
    return new ProjectConfig(clone);
  }

  static serializeResolvedConfig(config: ResolvedConfig): ConfigDocument {
    return ProjectConfig.fromResolvedConfig(config).toSerializableConfig();
  }

  get resolved(): ResolvedConfig {
    return structuredClone(this.config);
  }

  toSerializableConfig(): ConfigDocument {
    return stripUndefined(this.resolved);
  }

  isOutdated(): boolean {
    return this.config.configVersion < CURRENT_CONFIG_VERSION;
  }
}

export function parseConfigDocument(text: string): ConfigDocument {
  const parsed = parse(text) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error("Config file must contain a YAML object");
  }
  return parsed;
}

export function readConfigDocumentVersion(parsed: ConfigDocument): number {
  if (!Object.hasOwn(parsed, "configVersion")) return 0;
  const version = parsed.configVersion;
  if (!Number.isInteger(version) || typeof version !== "number" || version < 0) {
    throw new Error("configVersion must be a non-negative integer");
  }
  return version;
}

function mergeConfigDocument(base: ResolvedConfig, override: ConfigDocument): ResolvedConfig {
  return deepMerge(structuredClone(base), override) as ResolvedConfig;
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = base[key];
    base[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }

  return base;
}

function normalizeResolvedConfig(config: ResolvedConfig): void {
  config.scan.extensions = config.scan.extensions.map((extension) => {
    const lower = extension.toLowerCase();
    return lower.startsWith(".") ? lower : `.${lower}`;
  });

  config.openai.baseUrl = config.openai.baseUrl.replace(/\/+$/, "");
  config.openai.apiKey = config.openai.apiKey?.trim() || undefined;
  config.openai.apiKeyEnv = config.openai.apiKeyEnv?.trim() || undefined;
  config.openai.userAgent = resolveUserAgent(config.openai.userAgent);
  config.openai.proxy = normalizeProxyConfig((config.openai as unknown as ConfigDocument).proxy);
  config.openai.adapter = config.openai.adapter.toLowerCase() as ResolvedConfig["openai"]["adapter"];
  config.openai.image.size = config.openai.image.size
    .toLowerCase() as ResolvedConfig["openai"]["image"]["size"];
  config.openai.image.quality = config.openai.image.quality
    .toLowerCase() as ResolvedConfig["openai"]["image"]["quality"];
  config.openai.image.background = config.openai.image.background
    .toLowerCase() as ResolvedConfig["openai"]["image"]["background"];
  config.openai.image.outputFormat = config.openai.image.outputFormat
    .toLowerCase() as ResolvedConfig["openai"]["image"]["outputFormat"];
  config.preprocess.aspectPad.fill = config.preprocess.aspectPad.fill
    .toLowerCase() as ResolvedConfig["preprocess"]["aspectPad"]["fill"];
  config.preprocess.aspectPad.intermediateDir = config.preprocess.aspectPad.intermediateDir.trim();
  config.logging.level = config.logging.level.toLowerCase() as ResolvedConfig["logging"]["level"];
  config.logging.dir = config.logging.dir.trim();
}

function stripUndefined<T>(value: T): ConfigDocument {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as ConfigDocument;
  }
  if (!isPlainObject(value)) return value as unknown as ConfigDocument;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = stripUndefined(item);
  }
  return result;
}

function isPlainObject(value: unknown): value is ConfigDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
