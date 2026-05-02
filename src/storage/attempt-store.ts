import type { AttemptRecord } from "../shared/types.ts";
import type { AppDatabase } from "./db.ts";
import { mapAttempt } from "./row-mappers.ts";

export class AttemptStore {
  constructor(private readonly db: AppDatabase) {}

  create(record: AttemptRecord): void {
    this.db.prepare(`
      INSERT INTO attempts (
        id, job_id, attempt_no, status, http_status, error_type, error_message,
        retry_after_ms, duration_ms, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.jobId,
      record.attemptNo,
      record.status,
      record.httpStatus ?? null,
      record.errorType ?? null,
      record.errorMessage ?? null,
      record.retryAfterMs ?? null,
      record.durationMs ?? null,
      record.startedAt,
      record.finishedAt ?? null,
    );
  }

  listByJob(jobId: string): AttemptRecord[] {
    return this.db.prepare("SELECT * FROM attempts WHERE job_id = ? ORDER BY attempt_no").all(jobId)
      .map((row) => mapAttempt(row as Record<string, unknown>));
  }
}
