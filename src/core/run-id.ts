import type { ResolvedConfig } from "../shared/types.ts";

export function createRunId(): string {
  return crypto.randomUUID();
}

export async function createRunHash(config: ResolvedConfig): Promise<string> {
  return hashJson({
    inputDir: config.inputDir,
    outputDir: config.outputDir,
    prompt: config.prompt,
    scan: config.scan,
  });
}

async function hashJson(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
