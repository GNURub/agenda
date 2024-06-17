import {
	AgendaDBAdapter,
	FilterQuery,
	IJobParameters,
	Job,
	JobParameters,
	JobWithId
} from '@agenda/agenda';

export class AgendaMemoryAdapter implements AgendaDBAdapter {
	private jobs: JobParameters<any>[] = [];

	async connect(): Promise<void> {}

	async getJobs<R = unknown>(
		query: FilterQuery,
		sort?: `${string}:${1 | -1}`,
		limit?: number,
		skip?: number
	): Promise<JobParameters<R>[]> {
		let jobs = this.jobs.filter(job => {
			return Object.entries(query).every(([key, value]) => {
				if (Array.isArray(value)) {
					return value.includes(job[key as keyof IJobParameters]);
				}

				return job[key as keyof IJobParameters] === value;
			});
		});

		if (sort !== undefined) {
			const [field, order] = sort.split(':');
			jobs = jobs.sort((jobA, jobB) => {
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

		if (limit === undefined) {
			limit = jobs.length;
		}

		if (skip === undefined) {
			skip = 0;
		}

		return jobs.slice(skip, skip + limit) as JobParameters<R>[];
	}

	async getJobById<R = unknown>(id: string): Promise<IJobParameters<R> | null> {
		return (this.jobs.find(job => job.id === id) as JobParameters<R>) || null;
	}

	async removeJobs(query?: FilterQuery): Promise<number> {
		const initialCount = this.jobs.length;

		if (!query || !Object.keys(query).length) {
			this.jobs = [];
			return initialCount;
		}

		const jobs = await this.getJobs(query).then(jobs => jobs.map(job => job.id!));

		this.jobs = this.jobs.filter(job => !jobs.includes(job.id!));

		return initialCount - this.jobs.length;
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
		const existingJobIndex = this.jobs.findIndex(
			j => j.id === job.attrs.id || j.name === job.attrs.name
		);

		if (existingJobIndex !== -1) {
			this.jobs[existingJobIndex].lockedAt = new Date();
			return this.jobs[existingJobIndex];
		}
		return undefined;
	}

	async getNextJobToRun<T = any>(
		jobName: string,
		nextScanAt: Date,
		lockDeadline: Date,
		now: Date = new Date()
	): Promise<JobParameters<T> | undefined> {
		const jobIndex = this.jobs.findIndex(
			job =>
				job.name === jobName &&
				!job.disabled &&
				((!job.lockedAt && job.nextRunAt && job.nextRunAt <= nextScanAt) ||
					(job.lockedAt && job.lockedAt <= lockDeadline))
		);

		if (jobIndex !== -1) {
			this.jobs[jobIndex].lockedAt = now;
			return this.jobs[jobIndex];
		}

		return undefined;
	}

	async saveJobState(job: Job<any>): Promise<void> {
		const existingJobIndex = this.jobs.findIndex(
			j => j.id === job.attrs.id || j.name === job.attrs.name
		);

		if (existingJobIndex !== -1) {
			this.jobs[existingJobIndex] = JobParameters.fromObject({
				...this.jobs[existingJobIndex].toObject(),
				...job.attrs
			});
		}
	}

	async saveJob<DATA = unknown>(
		job: Job<DATA>,
		lastModifiedBy?: string
	): Promise<{ job: Job<DATA>; result: JobParameters<DATA> | null }> {
		let existingJobIndex = job.attrs.id ? this.jobs.findIndex(j => j.id === job.attrs.id) : -1;

		if (existingJobIndex === -1) {
			existingJobIndex = this.jobs.findIndex(j => {
				if (!job.attrs.id && j.name === job.attrs.name) {
					return j.uniqueHash || job.attrs.uniqueHash
						? job.attrs.uniqueHash === j.uniqueHash
						: false;
				}

				return false;
			});
		}

		if (existingJobIndex !== -1) {
			if (!job.attrs.uniqueOpts?.insertOnly) {
				this.jobs[existingJobIndex] = JobParameters.fromObject({
					...this.jobs[existingJobIndex].toObject(),
					...job.attrs,
					lastModifiedBy
				});
			}

			return { job, result: this.jobs[existingJobIndex] };
		}

		const newJob = JobParameters.fromObject({
			...job.attrs,
			id: crypto.randomUUID(),
			lastModifiedBy
		});

		this.jobs.push(newJob);

		return { job, result: newJob };
	}
}
