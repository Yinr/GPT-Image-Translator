import rawUserAgents from "../data/user-agents.json" with { type: "json" };
import { APP_VERSION } from "../shared/app-meta.ts";

type UserAgentMap = Record<string, string>;

const BUILTIN_USER_AGENTS = rawUserAgents as UserAgentMap;

export function resolveUserAgent(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const builtin = BUILTIN_USER_AGENTS[normalized.toLowerCase()];
  if (!builtin) return normalized;

  return builtin.replaceAll("{version}", APP_VERSION);
}

export function listBuiltinUserAgentKeywords(): string[] {
  return Object.keys(BUILTIN_USER_AGENTS).sort();
}
