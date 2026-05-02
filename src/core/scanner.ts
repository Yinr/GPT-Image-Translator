import { walk } from "@std/fs/walk";
import { extname, relative, resolve } from "@std/path";
import type { ImageFile, ScanConfig } from "../shared/types.ts";

export async function scanImages(inputDir: string, config: ScanConfig): Promise<ImageFile[]> {
  const root = resolve(inputDir);
  const extensions = new Set(config.extensions.map((extension) => extension.toLowerCase()));
  const files: ImageFile[] = [];

  for await (
    const entry of walk(root, {
      includeDirs: false,
      includeFiles: true,
      maxDepth: config.recursive ? Infinity : 1,
    })
  ) {
    if (!extensions.has(extname(entry.name).toLowerCase())) continue;

    files.push({
      absolutePath: entry.path,
      relativePath: toPortablePath(relative(root, entry.path)),
    });
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function toPortablePath(path: string): string {
  return path.replaceAll("\\", "/");
}
