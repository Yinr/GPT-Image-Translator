import type {
  AttemptRecord,
  AttemptStatus,
  JobRecord,
  JobStatus,
  OutputRecord,
  ProcessingMetadataRecord,
  RunRecord,
  RunStatus,
} from "../shared/types.ts";
import { AttemptStore } from "../storage/attempt-store.ts";
import { JobStore } from "../storage/job-store.ts";
import { OutputStore } from "../storage/output-store.ts";
import { ProcessingMetadataStore } from "../storage/processing-metadata-store.ts";
import { RunStore } from "../storage/run-store.ts";

export interface RunSummary {
  id: string;
  status: RunStatus;
  runHash: string;
  inputDir: string;
  outputDir: string;
  startedAt: string;
  finishedAt?: string;
  totalJobs: number;
  succeededJobs: number;
  failedJobs: number;
  skippedJobs: number;
}

export interface OutputDetail {
  id: string;
  jobId: string;
  outputPath: string;
  outputFormat: string;
  width?: number;
  height?: number;
  byteCount?: number;
  revisedPrompt?: string;
  usageJson?: string;
  createdAt: string;
}

export interface ProcessingMetadataDetail {
  enabled: boolean;
  apiSize?: string;
  source?: { width: number; height: number };
  canvas?: { width: number; height: number };
  sourceRect?: { x: number; y: number; width: number; height: number };
  fill?: string;
  cropBackToOriginal: boolean;
  uncroppedOutputPath?: string;
  createdAt: string;
}

export interface RunDetail extends RunSummary {
  jobs: JobDetail[];
}

export interface JobDetail {
  id: string;
  runId: string;
  inputPath: string;
  outputPath: string;
  status: JobStatus;
  attempts: AttemptDetail[];
  nextAttemptAt?: string;
  lastErrorType?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  output?: OutputDetail;
  processing?: ProcessingMetadataDetail;
}

export interface AttemptDetail {
  id: string;
  jobId: string;
  attemptNo: number;
  status: AttemptStatus;
  httpStatus?: number;
  errorType?: string;
  errorMessage?: string;
  retryAfterMs?: number;
  durationMs?: number;
  startedAt: string;
  finishedAt?: string;
}

export interface JobListFilter {
  status?: JobStatus;
  failedOnly?: boolean;
}

export class RunQueryService {
  constructor(
    private readonly runs: RunStore,
    private readonly jobs: JobStore,
    private readonly attempts: AttemptStore,
    private readonly outputs: OutputStore,
    private readonly processingMetadata?: ProcessingMetadataStore,
  ) {}

  getRunDetail(runId: string): RunDetail | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;

    const jobs = this.listJobs(runId);

    return { ...toRunSummary(run), jobs };
  }

  getJobDetail(jobId: string): JobDetail | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    return this.toJobDetail(job);
  }

  listJobs(runId: string, filter: JobListFilter = {}): JobDetail[] {
    const jobs = filter.failedOnly ? this.jobs.listFailedByRun(runId) : this.jobs.listByRun(runId);
    return jobs
      .filter((job) => !filter.status || job.status === filter.status)
      .map((job) => this.toJobDetail(job));
  }

  listFailedJobs(runId: string): JobDetail[] {
    return this.listJobs(runId, { failedOnly: true });
  }

  listRecentRuns(limit = 20): RunSummary[] {
    return this.runs.listRecent(limit).map(toRunSummary);
  }

  private toJobDetail(job: JobRecord): JobDetail {
    return {
      id: job.id,
      runId: job.runId,
      inputPath: job.inputPath,
      outputPath: job.outputPath,
      status: job.status,
      attempts: this.attempts.listByJob(job.id).map(toAttemptDetail),
      nextAttemptAt: job.nextAttemptAt,
      lastErrorType: job.lastErrorType,
      lastErrorMessage: job.lastErrorMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      output: toOutputDetail(this.outputs.getLatestByJob(job.id)),
      processing: toProcessingMetadataDetail(this.processingMetadata?.getByJob(job.id)),
    };
  }
}

function toAttemptDetail(attempt: AttemptRecord): AttemptDetail {
  return {
    id: attempt.id,
    jobId: attempt.jobId,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    httpStatus: attempt.httpStatus,
    errorType: attempt.errorType,
    errorMessage: attempt.errorMessage,
    retryAfterMs: attempt.retryAfterMs,
    durationMs: attempt.durationMs,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
  };
}

function toRunSummary(run: RunRecord): RunSummary {
  return {
    id: run.id,
    status: run.status,
    runHash: run.runHash,
    inputDir: run.inputDir,
    outputDir: run.outputDir,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    totalJobs: run.totalJobs,
    succeededJobs: run.succeededJobs,
    failedJobs: run.failedJobs,
    skippedJobs: run.skippedJobs,
  };
}

function toOutputDetail(output: OutputRecord | undefined): OutputDetail | undefined {
  if (!output) return undefined;

  return {
    id: output.id,
    jobId: output.jobId,
    outputPath: output.outputPath,
    outputFormat: output.outputFormat,
    width: output.width,
    height: output.height,
    byteCount: output.byteCount,
    revisedPrompt: output.revisedPrompt,
    usageJson: output.usageJson,
    createdAt: output.createdAt,
  };
}

function toProcessingMetadataDetail(
  metadata: ProcessingMetadataRecord | undefined,
): ProcessingMetadataDetail | undefined {
  if (!metadata) return undefined;

  return {
    enabled: metadata.enabled,
    apiSize: metadata.apiSize,
    source: sizeDetail(metadata.sourceWidth, metadata.sourceHeight),
    canvas: sizeDetail(metadata.canvasWidth, metadata.canvasHeight),
    sourceRect: rectDetail(
      metadata.sourceRectX,
      metadata.sourceRectY,
      metadata.sourceRectWidth,
      metadata.sourceRectHeight,
    ),
    fill: metadata.fill,
    cropBackToOriginal: metadata.cropBackToOriginal,
    uncroppedOutputPath: metadata.uncroppedOutputPath,
    createdAt: metadata.createdAt,
  };
}

function sizeDetail(width: number | undefined, height: number | undefined) {
  return width === undefined || height === undefined ? undefined : { width, height };
}

function rectDetail(
  x: number | undefined,
  y: number | undefined,
  width: number | undefined,
  height: number | undefined,
) {
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
}
