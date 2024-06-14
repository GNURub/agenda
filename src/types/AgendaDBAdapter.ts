import { Job, JobWithId } from '..';
import { IJobParameters } from './JobParameters';

export type FilterQuery<T, A = any> = Record<keyof T, A>;

export interface AgendaDBAdapter {
	connect(): Promise<void>;

	getJobs<R = unknown>(
		query: Partial<IJobParameters>,
		sort?: `${string}:${1 | -1}`,
		limit?: number,
		skip?: number
	): Promise<IJobParameters<R>[]>;

	getJobById<R = unknown>(id: string): Promise<IJobParameters<R> | null>;

	removeJobs(query: FilterQuery<IJobParameters>): Promise<number>;

	removeJobsWithNotNames(names: string[]): Promise<number>;

	getQueueSize(): Promise<number>;

	unlockJob(jobId: string): Promise<void>;

	unlockJobs(jobIds: string[]): Promise<void>;

	lockJob(job: JobWithId): Promise<IJobParameters | undefined>;

	getNextJobToRun(
		jobName: string,
		nextScanAt: Date,
		lockDeadline: Date,
		now?: Date
	): Promise<IJobParameters | undefined>;

	saveJobState(job: Job<any>): Promise<void>;

	saveJob<DATA = unknown | void>(
		job: Job<DATA>,
		lastModifiedBy: string | undefined
	): Promise<{
		job: Job<DATA>;
		result: IJobParameters<DATA> | null;
	}>;
}
