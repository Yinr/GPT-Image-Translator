import type { RunConfigRecord } from "../shared/types.ts";
import type { AppDatabase } from "./db.ts";
import { mapRunConfig } from "./row-mappers.ts";

export class RunConfigStore {
  constructor(private readonly db: AppDatabase) {}

  create(record: RunConfigRecord): void {
    this.db.prepare(`
      INSERT INTO run_configs (run_id, config_version, config_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(record.runId, record.configVersion, record.configJson, record.createdAt);
  }

  get(runId: string): RunConfigRecord | undefined {
    const row = this.db.prepare("SELECT * FROM run_configs WHERE run_id = ?").get(runId);
    return row ? mapRunConfig(row as Record<string, unknown>) : undefined;
  }
}
