import type { AppConfig } from "../shared/types.ts";

type PlainObject = Record<string, unknown>;

export function normalizeProxyConfig(value: unknown): AppConfig["openai"]["proxy"] {
  if (value === null || value === undefined) return { url: "" };
  if (typeof value === "string") return { url: normalizeProxyUrl(value) };
  if (isPlainObject(value)) return { url: normalizeProxyUrl(value.url) };
  return { url: String(value) };
}

export function isValidProxyUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "socks5:";
  } catch {
    return false;
  }
}

export function redactProxyUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "<invalid proxy url>";
  }
}

function normalizeProxyUrl(value: unknown): string {
  if (value === null || value === undefined) return "";
  const trimmed = String(value).trim();
  return trimmed.toLowerCase() === "none" ? "" : trimmed;
}

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
