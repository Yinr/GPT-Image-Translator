import type { ResolvedConfig } from "../shared/types.ts";

export function createRunConfigSnapshot(config: ResolvedConfig): ResolvedConfig {
  const snapshot = structuredClone(config);
  snapshot.openai.apiKey = undefined;
  return snapshot;
}
