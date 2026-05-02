import type {
  AttemptRecord,
  JobRecord,
  JobStatus,
  OutputRecord,
  RunRecord,
} from "../shared/types.ts";
import { AttemptStore } from "../storage/attempt-store.ts";
import { JobStore } from "../storage/job-store.ts";
import { OutputStore } from "../storage/output-store.ts";
import { RunStore } from "../storage/run-store.ts";

export interface RunSummary {
  id: string;
  status: RunRecord["status"];
  configHash: string;
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

export interface RunDetail extends RunSummary {
  jobs: JobDetail[];
}

export interface JobDetail {
  id: string;
  runId: string;
  inputPath: string;
  outputPath: string;
  status: JobRecord["status"];
  attempts: AttemptRecord[];
  nextAttemptAt?: string;
  lastErrorType?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  output?: OutputDetail;
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
      attempts: this.attempts.listByJob(job.id),
      nextAttemptAt: job.nextAttemptAt,
      lastErrorType: job.lastErrorType,
      lastErrorMessage: job.lastErrorMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      output: toOutputDetail(this.outputs.getLatestByJob(job.id)),
    };
  }
}

function toRunSummary(run: RunRecord): RunSummary {
  return {
    id: run.id,
    status: run.status,
    configHash: run.configHash,
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
