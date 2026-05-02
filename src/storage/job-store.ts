import type { JobRecord, JobStatus } from "../shared/types.ts";
import { JOB_STATUSES } from "../shared/statuses.ts";
import type { AppDatabase } from "./db.ts";
import { mapJob } from "./row-mappers.ts";

export interface UpsertJobInput {
  id: string;
  runId: string;
  inputPath: string;
  outputPath: string;
  status?: JobStatus;
  completedAt?: string;
  now: string;
}

export interface UpdateJobStatusInput {
  id: string;
  status: JobStatus;
  now: string;
  outputPath?: string;
  attempts?: number;
  nextAttemptAt?: string;
  lastErrorType?: string;
  lastErrorMessage?: string;
  completedAt?: string;
}

export class JobStore {
  constructor(private readonly db: AppDatabase) {}

  upsert(input: UpsertJobInput): void {
    this.db.prepare(`
      INSERT INTO jobs (
        id, run_id, input_path, output_path, status, attempts, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(run_id, input_path) DO UPDATE SET
        output_path = excluded.output_path,
        status = excluded.status,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
      WHERE jobs.status NOT IN ('succeeded', 'running')
    `).run(
      input.id,
      input.runId,
      input.inputPath,
      input.outputPath,
      input.status ?? "pending",
      input.now,
      input.now,
      input.completedAt ?? null,
    );
  }

  get(id: string): JobRecord | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    return row ? mapJob(row as Record<string, unknown>) : undefined;
  }

  listByRun(runId: string): JobRecord[] {
    return this.db.prepare("SELECT * FROM jobs WHERE run_id = ? ORDER BY input_path").all(runId)
      .map((row) => mapJob(row as Record<string, unknown>));
  }

  listFailedByRun(runId: string): JobRecord[] {
    return this.db.prepare(`
      SELECT * FROM jobs
      WHERE run_id = ?
        AND status = 'failed'
      ORDER BY updated_at, input_path
    `).all(runId).map((row) => mapJob(row as Record<string, unknown>));
  }

  listRunnable(runId: string, now: string, limit: number): JobRecord[] {
    return this.db.prepare(`
      SELECT * FROM jobs
      WHERE run_id = ?
        AND (
          status = 'pending'
          OR (status = 'retryable' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
        )
      ORDER BY updated_at, input_path
      LIMIT ?
    `).all(runId, now, limit).map((row) => mapJob(row as Record<string, unknown>));
  }

  findByInputPath(runId: string, inputPath: string): JobRecord | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE run_id = ? AND input_path = ?").get(
      runId,
      inputPath,
    );
    return row ? mapJob(row as Record<string, unknown>) : undefined;
  }

  countByStatus(runId: string): Record<JobStatus, number> {
    const counts: Record<JobStatus, number> = Object.fromEntries(
      JOB_STATUSES.map((status) => [status, 0]),
    ) as Record<JobStatus, number>;

    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM jobs
      WHERE run_id = ?
      GROUP BY status
    `).all(runId) as Array<{ status: JobStatus; count: number }>;

    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  resetRunningJobs(runId: string, now: string): number {
    const changed = this.db.prepare(`
      UPDATE jobs
      SET status = 'retryable',
          next_attempt_at = ?,
          last_error_type = 'interrupted',
          last_error_message = 'Execution interrupted before completion',
          updated_at = ?
      WHERE run_id = ?
        AND status = 'running'
    `).run(now, now, runId);

    return Number(changed ?? 0);
  }

  updateStatus(input: UpdateJobStatusInput): void {
    this.db.prepare(`
      UPDATE jobs
      SET status = ?,
          attempts = COALESCE(?, attempts),
          output_path = COALESCE(?, output_path),
          next_attempt_at = ?,
          last_error_type = ?,
          last_error_message = ?,
          updated_at = ?,
          completed_at = ?
      WHERE id = ?
    `).run(
      input.status,
      input.attempts ?? null,
      input.outputPath ?? null,
      input.nextAttemptAt ?? null,
      input.lastErrorType ?? null,
      input.lastErrorMessage ?? null,
      input.now,
      input.completedAt ?? null,
      input.id,
    );
  }
}
