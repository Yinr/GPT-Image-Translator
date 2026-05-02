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

export interface RunDetail extends RunRecord {
  jobs: JobDetail[];
}

export interface JobDetail extends Omit<JobRecord, "attempts"> {
  attempts: AttemptRecord[];
  output?: OutputRecord;
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

    return { ...run, jobs };
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

  listRecentRuns(limit = 20): RunRecord[] {
    return this.runs.listRecent(limit);
  }

  private toJobDetail(job: JobRecord): JobDetail {
    return {
      ...job,
      attempts: this.attempts.listByJob(job.id),
      output: this.outputs.getLatestByJob(job.id),
    };
  }
}
