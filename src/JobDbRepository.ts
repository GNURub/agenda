import debug from 'debug';
import type { Agenda } from './index';
import type { Job, JobWithId } from './Job';
import { AgendaDBAdapter, FilterQuery } from './types/AgendaDBAdapter';
import type { IJobParameters } from './types/JobParameters';

const log = debug('agenda:db');

/**
 * @class
 */
export class JobDbRepository {
	constructor(
		private readonly agenda: Agenda,
		private readonly adapter: AgendaDBAdapter
	) {}

	getJobById(id: string) {
		return this.adapter.getJobById(id);
	}

	getJobs(
		query: Partial<IJobParameters>,
		sort?: `${string}:${1 | -1}`,
		limit: number = 0,
		skip: number = 0
	): Promise<IJobParameters[]> {
		return this.adapter.getJobs(query, sort, limit, skip);
	}

	removeJobs(query: FilterQuery<IJobParameters>): Promise<number> {
		return this.adapter.removeJobs(query);
	}

	removeJobsWithNotNames(names: string[]): Promise<number> {
		return this.adapter.removeJobsWithNotNames(names);
	}

	getQueueSize(): Promise<number> {
		return this.adapter.getQueueSize();
	}

	unlockJob(job: Job): Promise<void> {
		return this.adapter.unlockJob(job.attrs.id!);
	}

	/**
	 * Internal method to unlock jobs so that they can be re-run
	 */
	unlockJobs(jobIds: string[]): Promise<void> {
		return this.adapter.unlockJobs(jobIds);
	}

	lockJob(job: JobWithId): Promise<IJobParameters | undefined> {
		return this.adapter.lockJob(job);
	}

	async getNextJobToRun(
		jobName: string,
		nextScanAt: Date,
		lockDeadline: Date,
		now: Date = new Date()
	): Promise<IJobParameters | undefined> {
		return this.adapter.getNextJobToRun(jobName, nextScanAt, lockDeadline, now);
	}

	async connect(): Promise<void> {
		await this.adapter.connect();
		this.agenda.emit('ready');
	}

	saveJobState(job: Job<any>): Promise<void> {
		return this.adapter.saveJobState(job);
	}

	/**
	 * Save the properties on a job to MongoDB
	 * @name Agenda#saveJob
	 * @function
	 * @param {Job} job job to save into MongoDB
	 * @returns {Promise} resolves when job is saved or errors
	 */
	async saveJob<DATA = unknown | void>(job: Job<DATA>): Promise<Job<DATA>> {
		const { job: savedJob, result } = await this.adapter.saveJob(job, this.agenda.attrs.name);
		return this.processDbResult(savedJob, result);
	}

	private processDbResult<DATA = unknown | void>(
		job: Job<DATA>,
		res: IJobParameters<DATA> | null
	): Job<DATA> {
		log(
			'processDbResult() called with success, checking whether to process job immediately or not'
		);

		// We have a result from the above calls
		if (res) {
			// Grab ID and nextRunAt from MongoDB and store it as an attribute on Job
			job.attrs.id = res.id;
			job.attrs.nextRunAt = res.nextRunAt;

			// check if we should process the job immediately
			this.agenda.emit('processJob', job);
		}

		// Return the Job instance
		return job;
	}
}
