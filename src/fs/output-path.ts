import { extname } from "@std/path";

export function withOutputFormat(path: string, outputFormat: string): string {
  const extension = extname(path);
  const normalizedFormat = normalizeOutputFormat(outputFormat);
  const base = extension ? path.slice(0, -extension.length) : path;
  return `${base}.${normalizedFormat}`;
}

export function normalizeOutputFormat(format: string): string {
  const normalized = format.trim().toLowerCase().replace(/^\.+/, "");
  return normalized || "png";
}
