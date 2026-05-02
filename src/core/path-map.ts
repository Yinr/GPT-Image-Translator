import { dirname, extname, isAbsolute, normalize, relative, resolve } from "@std/path";
import { normalizeOutputFormat } from "../fs/output-path.ts";
import type { ImageFile, OutputPath } from "../shared/types.ts";

export function mapOutputPath(
  input: ImageFile,
  outputDir: string,
  outputFormat: string,
): OutputPath {
  if (isUnsafeRelativePath(input.relativePath)) {
    throw new Error(`Output path escapes output directory: ${input.relativePath}`);
  }

  const safeFormat = normalizeOutputFormat(outputFormat);
  const relativeWithoutExtension = stripExtension(input.relativePath);
  const relativePath = `${toPortablePath(relativeWithoutExtension)}.${safeFormat}`;
  const absolutePath = resolve(outputDir, normalize(relativePath));
  const outputRoot = resolve(outputDir);

  if (!isWithinDirectory(absolutePath, outputRoot)) {
    throw new Error(`Output path escapes output directory: ${input.relativePath}`);
  }

  return { absolutePath, relativePath };
}

export async function ensureOutputDirectory(outputPath: string): Promise<void> {
  await Deno.mkdir(dirname(outputPath), { recursive: true });
}

function stripExtension(path: string): string {
  const normalized = toPortablePath(path);
  const extension = extname(normalized);
  return extension ? normalized.slice(0, -extension.length) : normalized;
}

function isWithinDirectory(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isUnsafeRelativePath(path: string): boolean {
  return isAbsolute(path) || path.split(/[\\/]+/).includes("..");
}

function toPortablePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}
