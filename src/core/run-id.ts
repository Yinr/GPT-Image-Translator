import type { ResolvedConfig } from "../shared/types.ts";

export function createRunId(): string {
  return crypto.randomUUID();
}

export async function createConfigHash(config: ResolvedConfig): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(config));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
