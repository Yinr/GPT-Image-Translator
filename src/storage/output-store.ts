import type { OutputRecord } from "../shared/types.ts";
import type { AppDatabase } from "./db.ts";
import { mapOutput } from "./row-mappers.ts";

export class OutputStore {
  constructor(private readonly db: AppDatabase) {}

  create(record: OutputRecord): void {
    this.db.prepare(`
      INSERT INTO outputs (
        id, job_id, output_path, output_format, width, height,
        byte_count, revised_prompt, usage_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.jobId,
      record.outputPath,
      record.outputFormat,
      record.width ?? null,
      record.height ?? null,
      record.byteCount ?? null,
      record.revisedPrompt ?? null,
      record.usageJson ?? null,
      record.createdAt,
    );
  }

  listByJob(jobId: string): OutputRecord[] {
    return this.db.prepare("SELECT * FROM outputs WHERE job_id = ? ORDER BY created_at").all(jobId)
      .map((row) => mapOutput(row as Record<string, unknown>));
  }

  getLatestByJob(jobId: string): OutputRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM outputs
      WHERE job_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(jobId);
    return row ? mapOutput(row as Record<string, unknown>) : undefined;
  }
}
