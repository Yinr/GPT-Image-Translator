export interface Migration {
  version: number;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        input_dir TEXT NOT NULL,
        output_dir TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        total_jobs INTEGER NOT NULL DEFAULT 0,
        succeeded_jobs INTEGER NOT NULL DEFAULT 0,
        failed_jobs INTEGER NOT NULL DEFAULT 0,
        skipped_jobs INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        input_path TEXT NOT NULL,
        output_path TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error_type TEXT,
        last_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(run_id, input_path),
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_jobs_run_status_next_attempt
        ON jobs(run_id, status, next_attempt_at);

      CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        attempt_no INTEGER NOT NULL,
        status TEXT NOT NULL,
        http_status INTEGER,
        error_type TEXT,
        error_message TEXT,
        retry_after_ms INTEGER,
        duration_ms INTEGER,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_attempts_job_attempt_no ON attempts(job_id, attempt_no);

      CREATE TABLE outputs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        output_path TEXT NOT NULL,
        output_format TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        byte_count INTEGER,
        revised_prompt TEXT,
        usage_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_outputs_job_id ON outputs(job_id);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE processing_metadata (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL,
        api_size TEXT,
        source_width INTEGER,
        source_height INTEGER,
        canvas_width INTEGER,
        canvas_height INTEGER,
        source_rect_x INTEGER,
        source_rect_y INTEGER,
        source_rect_width INTEGER,
        source_rect_height INTEGER,
        fill TEXT,
        crop_back_to_original INTEGER NOT NULL,
        uncropped_output_path TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_processing_metadata_job_id ON processing_metadata(job_id);
    `,
  },
];
