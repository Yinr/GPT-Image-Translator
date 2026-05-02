import type {
  AttemptRecord,
  JobRecord,
  OutputRecord,
  ProcessingMetadataRecord,
  RunRecord,
} from "../shared/types.ts";

type Row = Record<string, unknown>;

export function mapRun(row: Row): RunRecord {
  return {
    id: stringValue(row.id),
    status: stringValue(row.status) as RunRecord["status"],
    configHash: stringValue(row.config_hash),
    inputDir: stringValue(row.input_dir),
    outputDir: stringValue(row.output_dir),
    startedAt: stringValue(row.started_at),
    finishedAt: optionalString(row.finished_at),
    totalJobs: numberValue(row.total_jobs),
    succeededJobs: numberValue(row.succeeded_jobs),
    failedJobs: numberValue(row.failed_jobs),
    skippedJobs: numberValue(row.skipped_jobs),
  };
}

export function mapJob(row: Row): JobRecord {
  return {
    id: stringValue(row.id),
    runId: stringValue(row.run_id),
    inputPath: stringValue(row.input_path),
    outputPath: stringValue(row.output_path),
    status: stringValue(row.status) as JobRecord["status"],
    attempts: numberValue(row.attempts),
    nextAttemptAt: optionalString(row.next_attempt_at),
    lastErrorType: optionalString(row.last_error_type),
    lastErrorMessage: optionalString(row.last_error_message),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    completedAt: optionalString(row.completed_at),
  };
}

export function mapAttempt(row: Row): AttemptRecord {
  return {
    id: stringValue(row.id),
    jobId: stringValue(row.job_id),
    attemptNo: numberValue(row.attempt_no),
    status: stringValue(row.status) as AttemptRecord["status"],
    httpStatus: optionalNumber(row.http_status),
    errorType: optionalString(row.error_type),
    errorMessage: optionalString(row.error_message),
    retryAfterMs: optionalNumber(row.retry_after_ms),
    durationMs: optionalNumber(row.duration_ms),
    startedAt: stringValue(row.started_at),
    finishedAt: optionalString(row.finished_at),
  };
}

export function mapOutput(row: Row): OutputRecord {
  return {
    id: stringValue(row.id),
    jobId: stringValue(row.job_id),
    outputPath: stringValue(row.output_path),
    outputFormat: stringValue(row.output_format),
    width: optionalNumber(row.width),
    height: optionalNumber(row.height),
    byteCount: optionalNumber(row.byte_count),
    revisedPrompt: optionalString(row.revised_prompt),
    usageJson: optionalString(row.usage_json),
    createdAt: stringValue(row.created_at),
  };
}

export function mapProcessingMetadata(row: Row): ProcessingMetadataRecord {
  return {
    id: stringValue(row.id),
    jobId: stringValue(row.job_id),
    enabled: booleanValue(row.enabled),
    apiSize: optionalString(row.api_size) as ProcessingMetadataRecord["apiSize"],
    sourceWidth: optionalNumber(row.source_width),
    sourceHeight: optionalNumber(row.source_height),
    canvasWidth: optionalNumber(row.canvas_width),
    canvasHeight: optionalNumber(row.canvas_height),
    sourceRectX: optionalNumber(row.source_rect_x),
    sourceRectY: optionalNumber(row.source_rect_y),
    sourceRectWidth: optionalNumber(row.source_rect_width),
    sourceRectHeight: optionalNumber(row.source_rect_height),
    fill: optionalString(row.fill) as ProcessingMetadataRecord["fill"],
    cropBackToOriginal: booleanValue(row.crop_back_to_original),
    uncroppedOutputPath: optionalString(row.uncropped_output_path),
    createdAt: stringValue(row.created_at),
  };
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string database value");
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number {
  if (typeof value !== "number") throw new Error("Expected number database value");
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "number") throw new Error("Expected boolean database value");
  return value !== 0;
}
