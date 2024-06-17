import { AgendaDBAdapter, FilterQuery, IJobParameters, Job, JobWithId } from '@agenda/agenda';
import debug from 'debug';
import fs from 'node:fs/promises';

const log = debug('agenda:db:fs');

export interface IDatabaseOptions {
	jsonFilePath: string;
}

export interface IDbConfig {
	sort?: {
		[key: string]: 1 | -1;
	};
}

export class AgendaFSAdapter implements AgendaDBAdapter {
	private filePath: string;
	private jobs: IJobParameters[] = [];
	private sortOptions: { [key: string]: 1 | -1 };

	constructor(options: IDatabaseOptions & IDbConfig) {
		this.filePath = options.jsonFilePath;
		this.sortOptions = options.sort || { nextRunAt: 1, priority: -1 };
	}

	private async loadData(): Promise<void> {
		try {
			const fileData = await fs.readFile(this.filePath, 'utf8');
			this.jobs = JSON.parse(fileData);
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				this.jobs = [];
				await this.saveData();
			} else {
				throw error;
			}
		}
	}

	private async saveData(): Promise<void> {
		await fs.writeFile(this.filePath, JSON.stringify(this.jobs, null, 2));
	}

	async connect(): Promise<void> {
		await this.loadData();
		log('successful connection to JSON file');
	}

	private sortJobs(jobs: IJobParameters[]): IJobParameters[] {
		return jobs.sort((a, b) => {
			for (const [field, order] of Object.entries(this.sortOptions)) {
				// @ts-ignore
				if (a[field] < b[field]) return -1 * order;
				// @ts-ignore
				if (a[field] > b[field]) return 1 * order;
			}
			return 0;
		});
	}

	async getJobs<R = unknown>(
		query: FilterQuery,
		sort?: `${string}:${1 | -1}`,
		limit?: number,
		skip?: number
	): Promise<IJobParameters<R>[]> {
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
			jobs = this.sortJobs(jobs).sort((jobA, jobB) => {
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

		return jobs.slice(skip, skip + limit) as IJobParameters<R>[];
	}

	async getJobById<R = unknown>(id: string): Promise<IJobParameters<R> | null> {
		return (this.jobs.find(job => job.id === id) as IJobParameters<R>) || null;
	}

	async removeJobs(query: FilterQuery): Promise<number> {
		const initialCount = this.jobs.length;
		this.jobs = this.jobs.filter(
			job =>
				!Object.entries(query).every(([key, value]) => {
					if (Array.isArray(value)) {
						return !value.includes(job[key as keyof IJobParameters]);
					}

					return job[key as keyof IJobParameters] !== value;
				})
		);
		await this.saveData();
		return initialCount - this.jobs.length;
	}

	async getQueueSize(): Promise<number> {
		const count = this.jobs.filter(
			job => job.nextRunAt && new Date(job.nextRunAt) < new Date()
		).length;
		return count;
	}

	private findJobIndex(job: Job<any>): number {
		return this.jobs.findIndex(j => j.id === job.attrs.id || j.name === job.attrs.name);
	}

	async unlockJob(jobId: string): Promise<void> {
		const indexJob = this.jobs.findIndex(job => job.id === jobId && job.nextRunAt !== null);
		if (indexJob !== -1) {
			delete this.jobs[indexJob].lockedAt;
			await this.saveData();
		}
	}

	async unlockJobs(jobIds: string[]): Promise<void> {
		let updated = false;

		this.jobs = this.jobs.map(job => {
			if (jobIds.includes(job.id!) && job.nextRunAt !== null) {
				delete job.lockedAt;
				updated = true;
			}

			return job;
		});

		if (updated) await this.saveData();
	}

	async lockJob(job: JobWithId): Promise<IJobParameters | undefined> {
		const criteria = {
			id: job.attrs.id,
			name: job.attrs.name,
			lockedAt: null,
			nextRunAt: job.attrs.nextRunAt,
			disabled: { $ne: true }
		};

		const indexJobToLock = this.jobs.findIndex(j =>
			Object.entries(criteria).every(([key, value]) => j[key as keyof IJobParameters] === value)
		);

		if (indexJobToLock !== -1) {
			this.jobs[indexJobToLock].lockedAt = new Date();
			await this.saveData();
			return this.jobs[indexJobToLock];
		}
		return undefined;
	}

	async getNextJobToRun(
		jobName: string,
		nextScanAt: Date,
		lockDeadline: Date,
		now?: Date
	): Promise<IJobParameters | undefined> {
		const indexJobToRun = this.jobs.findIndex(job => {
			return (
				job.name === jobName &&
				job.disabled !== true &&
				((job.lockedAt === null && new Date(job.nextRunAt!) <= nextScanAt) ||
					new Date(job.lockedAt!) <= lockDeadline)
			);
		});

		if (indexJobToRun !== -1) {
			this.jobs[indexJobToRun].lockedAt = now || new Date();
			await this.saveData();
			return this.jobs[indexJobToRun];
		}

		return undefined;
	}

	async saveJobState(job: Job<any>): Promise<void> {
		const indexJob = this.jobs.findIndex(j => j.id === job.attrs.id && j.name === job.attrs.name);
		if (indexJob !== -1) {
			this.jobs[indexJob] = {
				...this.jobs[indexJob],
				...job.attrs
			};

			await this.saveData();
		} else {
			throw new Error(
				`job ${job.attrs.id} (name: ${job.attrs.name}) cannot be updated in the database, maybe it does not exist anymore?`
			);
		}
	}

	async saveJob<DATA = unknown | void>(
		job: Job<DATA>,
		lastModifiedBy: string | undefined
	): Promise<{
		job: Job<DATA>;
		result: IJobParameters<DATA> | null;
	}> {
		let indexJob = this.findJobIndex(job);

		if (indexJob !== -1) {
			this.jobs[indexJob] = {
				...this.jobs[indexJob],
				...job.attrs,
				lastModifiedBy
			};
		} else {
			job.attrs.id = crypto.randomUUID();
			this.jobs.push({ ...job.attrs, lastModifiedBy });

			indexJob = this.findJobIndex(job);
		}

		await this.saveData();

		return { job, result: (this.jobs[indexJob] as IJobParameters<DATA>) || job.attrs };
	}
}
