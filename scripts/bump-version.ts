import { format, increment, parse } from "@std/semver";
import { APP_VERSION } from "../src/shared/app-meta.ts";

type BumpKind = "patch" | "minor" | "major";

const APP_META_PATH = new URL("../src/shared/app-meta.ts", import.meta.url);

if (import.meta.main) {
  await main(Deno.args);
}

async function main(args: string[]): Promise<void> {
  const kind = parseBumpKind(args[0]);
  const nextVersion = bumpVersion(APP_VERSION, kind);
  const text = await Deno.readTextFile(APP_META_PATH);
  const updated = text.replace(
    /(export const APP_VERSION = ")([^"]+)(";)/,
    `$1${nextVersion}$3`,
  );

  if (updated === text) {
    throw new Error("Failed to update APP_VERSION in src/shared/app-meta.ts");
  }

  await Deno.writeTextFile(APP_META_PATH, updated);
  console.log(`${APP_VERSION} -> ${nextVersion}`);
}

function parseBumpKind(value: string | undefined): BumpKind {
  if (value === "patch" || value === "minor" || value === "major") return value;
  throw new Error("Usage: deno run scripts/bump-version.ts <patch|minor|major>");
}

export function bumpVersion(version: string, kind: BumpKind): string {
  let parsed;
  try {
    parsed = parse(version);
  } catch {
    throw new Error(`APP_VERSION must be a semantic version in x.y.z format: ${version}`);
  }

  return format(increment(parsed, kind));
}
