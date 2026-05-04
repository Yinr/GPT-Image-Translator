import type { RunRecord, RunStatus } from "../shared/types.ts";
import { JOB_STATUS, RUN_STATUS } from "../shared/status.ts";
import type { AppDatabase } from "./db.ts";
import { mapRun } from "./row-mappers.ts";

export class RunStore {
  constructor(private readonly db: AppDatabase) {}

  create(record: RunRecord): void {
    this.db.prepare(`
      INSERT INTO runs (
        id, status, config_hash, input_dir, output_dir, started_at, finished_at,
        total_jobs, succeeded_jobs, failed_jobs, skipped_jobs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.status,
      record.configHash,
      record.inputDir,
      record.outputDir,
      record.startedAt,
      record.finishedAt ?? null,
      record.totalJobs,
      record.succeededJobs,
      record.failedJobs,
      record.skippedJobs,
    );
  }

  get(id: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
    return row ? mapRun(row as Record<string, unknown>) : undefined;
  }

  findResumable(configHash: string): RunRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM runs
      WHERE config_hash = ?
        AND status = ?
      ORDER BY started_at DESC
      LIMIT 1
    `).get(configHash, RUN_STATUS.running);
    return row ? mapRun(row as Record<string, unknown>) : undefined;
  }

  listRecent(limit: number): RunRecord[] {
    return this.db.prepare(`
      SELECT * FROM runs
      ORDER BY started_at DESC
      LIMIT ?
    `).all(limit).map((row) => mapRun(row as Record<string, unknown>));
  }

  updateStatus(id: string, status: RunStatus, finishedAt?: string): void {
    this.db.prepare("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?").run(
      status,
      finishedAt ?? null,
      id,
    );
  }

  updateCounts(id: string): void {
    const counts = this.db.prepare(`
      SELECT
        COUNT(*) AS total_jobs,
        SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS succeeded_jobs,
        SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS failed_jobs,
        SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS skipped_jobs
      FROM jobs
      WHERE run_id = ?
    `).get(JOB_STATUS.succeeded, JOB_STATUS.failed, JOB_STATUS.skipped, id) as Record<
      string,
      number
    >;

    this.db.prepare(`
      UPDATE runs
      SET total_jobs = ?, succeeded_jobs = ?, failed_jobs = ?, skipped_jobs = ?
      WHERE id = ?
    `).run(
      counts.total_jobs ?? 0,
      counts.succeeded_jobs ?? 0,
      counts.failed_jobs ?? 0,
      counts.skipped_jobs ?? 0,
      id,
    );
  }
}
