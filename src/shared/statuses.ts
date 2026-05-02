import type { AttemptStatus, JobStatus, RunStatus } from "./types.ts";

export const RUN_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly RunStatus[];

export const JOB_STATUSES = [
  "pending",
  "running",
  "retryable",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
] as const satisfies readonly JobStatus[];

export const ATTEMPT_STATUSES = [
  "succeeded",
  "retryable",
  "failed",
] as const satisfies readonly AttemptStatus[];
