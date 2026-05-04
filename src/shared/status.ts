export const RUN_STATUS = {
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type RunStatus = typeof RUN_STATUS[keyof typeof RUN_STATUS];

export const RUN_STATUSES = [
  RUN_STATUS.running,
  RUN_STATUS.completed,
  RUN_STATUS.failed,
  RUN_STATUS.cancelled,
] as const satisfies readonly RunStatus[];

export const JOB_STATUS = {
  pending: "pending",
  running: "running",
  retryable: "retryable",
  succeeded: "succeeded",
  failed: "failed",
  skipped: "skipped",
  cancelled: "cancelled",
} as const;

export type JobStatus = typeof JOB_STATUS[keyof typeof JOB_STATUS];

export const JOB_STATUSES = [
  JOB_STATUS.pending,
  JOB_STATUS.running,
  JOB_STATUS.retryable,
  JOB_STATUS.succeeded,
  JOB_STATUS.failed,
  JOB_STATUS.skipped,
  JOB_STATUS.cancelled,
] as const satisfies readonly JobStatus[];

export const ATTEMPT_STATUS = {
  succeeded: "succeeded",
  retryable: "retryable",
  failed: "failed",
} as const;

export type AttemptStatus = typeof ATTEMPT_STATUS[keyof typeof ATTEMPT_STATUS];

export const ATTEMPT_STATUSES = [
  ATTEMPT_STATUS.succeeded,
  ATTEMPT_STATUS.retryable,
  ATTEMPT_STATUS.failed,
] as const satisfies readonly AttemptStatus[];
