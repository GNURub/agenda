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
	private data: IJobParameters[] = [];
	private sortOptions: { [key: string]: 1 | -1 };

	constructor(options: IDatabaseOptions & IDbConfig) {
		this.filePath = options.jsonFilePath;
		this.sortOptions = options.sort || { nextRunAt: 1, priority: -1 };
	}

	private async loadData(): Promise<void> {
		try {
			const fileData = await fs.readFile(this.filePath, 'utf8');
			this.data = JSON.parse(fileData);
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				this.data = [];
				await this.saveData();
			} else {
				throw error;
			}
		}
	}

	private async saveData(): Promise<void> {
		await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
	}

	async connect(): Promise<void> {
		await this.loadData();
		log('successful connection to JSON file');
	}

	close(): Promise<void> {
		return Promise.resolve();
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
		query: Partial<IJobParameters>,
		sort?: `${string}:${1 | -1}`,
		limit?: number,
		skip?: number
	): Promise<IJobParameters<R>[]> {
		let jobs = this.data.filter(job => {
			return Object.entries(query).every(
				([key, value]) => job[key as keyof IJobParameters] === value
			);
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
		return (this.data.find(job => job.id === id) as IJobParameters<R>) || null;
	}

	async removeJobsWithNotNames(names: string[]): Promise<number> {
		const initialCount = this.data.length;
		this.data = this.data.filter(job => names.includes(job.name));
		await this.saveData();
		return initialCount - this.data.length;
	}

	async removeJobs(query: FilterQuery<IJobParameters>): Promise<number> {
		const initialCount = this.data.length;
		this.data = this.data.filter(
			job =>
				!Object.entries(query).every(([key, value]) => job[key as keyof IJobParameters] === value)
		);
		await this.saveData();
		return initialCount - this.data.length;
	}

	async getQueueSize(): Promise<number> {
		const count = this.data.filter(
			job => job.nextRunAt && new Date(job.nextRunAt) < new Date()
		).length;
		return count;
	}

	async unlockJob(jobId: string): Promise<void> {
		const indexJob = this.data.findIndex(job => job.id === jobId && job.nextRunAt !== null);
		if (indexJob !== -1) {
			delete this.data[indexJob].lockedAt;
			await this.saveData();
		}
	}

	async unlockJobs(jobIds: string[]): Promise<void> {
		let updated = false;

		this.data = this.data.map(job => {
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

		const indexJobToLock = this.data.findIndex(j =>
			Object.entries(criteria).every(([key, value]) => j[key as keyof IJobParameters] === value)
		);

		if (indexJobToLock !== -1) {
			this.data[indexJobToLock].lockedAt = new Date();
			await this.saveData();
			return this.data[indexJobToLock];
		}
		return undefined;
	}

	async getNextJobToRun(
		jobName: string,
		nextScanAt: Date,
		lockDeadline: Date,
		now?: Date
	): Promise<IJobParameters | undefined> {
		const indexJobToRun = this.data.findIndex(job => {
			return (
				job.name === jobName &&
				job.disabled !== true &&
				((job.lockedAt === null && new Date(job.nextRunAt!) <= nextScanAt) ||
					new Date(job.lockedAt!) <= lockDeadline)
			);
		});

		if (indexJobToRun !== -1) {
			this.data[indexJobToRun].lockedAt = now || new Date();
			await this.saveData();
			return this.data[indexJobToRun];
		}

		return undefined;
	}

	async saveJobState(job: Job<any>): Promise<void> {
		const indexJob = this.data.findIndex(j => j.id === job.attrs.id && j.name === job.attrs.name);
		if (indexJob !== -1) {
			this.data[indexJob] = {
				...this.data[indexJob],
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
		let indexJob = this.data.findIndex(j => j.id === job.attrs.id);

		if (indexJob !== -1) {
			this.data[indexJob] = {
				...this.data[indexJob],
				...job.attrs,
				lastModifiedBy
			};
		} else {
			job.attrs.id = crypto.randomUUID();
			this.data.push({ ...job.attrs, lastModifiedBy });

			indexJob = this.data.findIndex(j => j.id === job.attrs.id);
		}

		await this.saveData();

		return { job, result: (this.data[indexJob] as IJobParameters<DATA>) || job.attrs };
	}
}
