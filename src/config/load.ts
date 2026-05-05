import { ProjectConfig } from "./project-config.ts";
import type { ResolvedConfig } from "../shared/types.ts";

export async function loadConfig(configPath: string): Promise<ResolvedConfig> {
  return (await ProjectConfig.load(configPath)).resolved;
}
