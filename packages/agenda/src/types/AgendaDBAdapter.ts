import { Job, JobWithId } from '../Job';
import { IJobParameters } from './JobParameters';

type SimpleOrArrayWrapper<T> = {
	[P in keyof T]: T[P] | T[P][];
};

export type FilterQuery = Partial<SimpleOrArrayWrapper<IJobParameters>>;

export interface AgendaDBAdapter {
	connect(): Promise<void>;

	getJobs<R = unknown>(
		query: FilterQuery,
		sort?: `${string}:${1 | -1}`,
		limit?: number,
		skip?: number
	): Promise<IJobParameters<R>[]>;

	getJobById<R = unknown>(id: string): Promise<IJobParameters<R> | null>;

	removeJobs(query?: FilterQuery): Promise<number>;

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
		lastModifiedBy?: string
	): Promise<{
		job: Job<DATA>;
		result: IJobParameters<DATA> | null;
	}>;
}
