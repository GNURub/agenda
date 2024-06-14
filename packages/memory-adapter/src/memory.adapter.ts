import { AgendaDBAdapter, FilterQuery, IJobParameters, Job, JobWithId } from '@agenda/agenda';

export class AgendaMemoryAdapter implements AgendaDBAdapter {
	private jobs: IJobParameters[] = [];

	async connect(): Promise<void> {}

	async getJobs<R = unknown>(
		query: Partial<IJobParameters>,
		sort?: `${string}:${1 | -1}`,
		limit?: number,
		skip?: number
	): Promise<IJobParameters<R>[]> {
		let filteredJobs = this.jobs.filter(job => this.matches(query, job));

		if (sort) {
			const [field, order] = sort.split(':');
			filteredJobs.sort((jobA, jobB) => {
				if (field && field in jobA) {
					if (
						typeof jobA[field as keyof IJobParameters] === 'number' &&
						typeof jobB[field as keyof IJobParameters] === 'number'
					) {
						// @ts-ignore
						const sort = jobA[field] - jobB[field];

						return order === '1' ? sort : -sort;
					} else if (
						typeof jobA[field as keyof IJobParameters] === 'string' &&
						typeof jobB[field as keyof IJobParameters] === 'string'
					) {
						// @ts-ignore
						const sort = jobA[field].localeCompare(jobB[field]);

						return order === '1' ? sort : -sort;
					}
				}
				return 0;
			});
		}

		if (skip !== undefined) {
			filteredJobs = filteredJobs.slice(skip);
		}

		if (limit !== undefined) {
			filteredJobs = filteredJobs.slice(0, limit);
		}

		return filteredJobs as IJobParameters<R>[];
	}

	async getJobById<R = unknown>(id: string): Promise<IJobParameters<R> | null> {
		return (this.jobs.find(job => job.id === id) as IJobParameters<R>) || null;
	}

	async removeJobsWithNotNames(names: string[]): Promise<number> {
		const initialLength = this.jobs.length;
		this.jobs = this.jobs.filter(job => names.includes(job.name));
		return initialLength - this.jobs.length;
	}

	async removeJobs(query: FilterQuery<IJobParameters>): Promise<number> {
		const initialLength = this.jobs.length;
		this.jobs = this.jobs.filter(job => !this.matches(query, job));
		return initialLength - this.jobs.length;
	}

	async getQueueSize(): Promise<number> {
		return this.jobs.filter(job => job.nextRunAt && job.nextRunAt < new Date()).length;
	}

	async unlockJob(jobId: string): Promise<void> {
		const job = this.jobs.find(job => job.id === jobId);
		if (job) {
			job.lockedAt = undefined;
		}
	}

	async unlockJobs(jobIds: string[]): Promise<void> {
		this.jobs.forEach(job => {
			if (jobIds.includes(job.id!)) {
				job.lockedAt = undefined;
			}
		});
	}

	async lockJob(job: JobWithId): Promise<IJobParameters | undefined> {
		const jobToLock = this.jobs.find(j => j.id === job.attrs.id && !j.lockedAt);
		if (jobToLock) {
			jobToLock.lockedAt = new Date();
			return jobToLock;
		}
		return undefined;
	}

	async getNextJobToRun(
		jobName: string,
		nextScanAt: Date,
		lockDeadline: Date,
		now: Date = new Date()
	): Promise<IJobParameters | undefined> {
		const jobToRun = this.jobs.find(
			job =>
				job.name === jobName &&
				!job.disabled &&
				((!job.lockedAt && job.nextRunAt && job.nextRunAt <= nextScanAt) ||
					(job.lockedAt && job.lockedAt <= lockDeadline))
		);

		if (jobToRun) {
			jobToRun.lockedAt = now;
			return jobToRun;
		}
		return undefined;
	}

	async saveJobState(job: Job<any>): Promise<void> {
		const jobIndex = this.jobs.findIndex(j => j.id === job.attrs.id);
		if (jobIndex !== -1) {
			this.jobs[jobIndex] = { ...this.jobs[jobIndex], ...job.attrs };
		}
	}

	async saveJob<DATA = unknown>(
		job: Job<DATA>,
		lastModifiedBy?: string
	): Promise<{ job: Job<DATA>; result: IJobParameters<DATA> | null }> {
		const existingJobIndex = this.jobs.findIndex(j => j.id === job.attrs.id);

		if (existingJobIndex !== -1) {
			this.jobs[existingJobIndex] = {
				...this.jobs[existingJobIndex],
				...job.attrs,
				lastModifiedBy
			};
			return { job, result: this.jobs[existingJobIndex] as IJobParameters<DATA> };
		}

		const newJob = {
			...job.attrs,
			id: crypto.randomUUID(),
			lastModifiedBy
		} as IJobParameters<DATA>;
		this.jobs.push(newJob);
		return { job, result: newJob };
	}

	private matches(query: Partial<IJobParameters>, job: IJobParameters): boolean {
		for (const key in query) {
			// @ts-ignore
			if (query[key] !== job[key]) {
				return false;
			}
		}
		return true;
	}
}
