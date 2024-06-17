export interface IJobParameters<DATA = unknown | void> {
	id?: string;

	name: string;
	priority: number;
	nextRunAt: Date | null;
	/**
	 * normal: job is queued and will be processed (regular case when the user adds a new job)
	 * single: job with this name is only queued once, if there is an exisitn gentry in the database, the job is just updated, but not newly inserted (this is used for .every())
	 */
	type: 'normal' | 'single';

	lockedAt?: Date;
	lastFinishedAt?: Date;
	failedAt?: Date;
	failCount?: number;
	failReason?: string;
	repeatTimezone?: string;
	lastRunAt?: Date;
	repeatInterval?: string | number;
	data: DATA | Partial<DATA>;
	repeatAt?: string;
	disabled?: boolean;
	progress?: number;

	// unique query object
	unique?: Partial<Omit<IJobParameters<DATA>, 'unique'>>;
	uniqueOpts?: {
		insertOnly: boolean;
	};

	lastModifiedBy?: string;

	/** forks a new node sub process for executing this job */
	fork?: boolean;
}

export class JobParameters<T> implements IJobParameters<T> {
	id?: string | undefined;
	name: string;
	priority: number;
	nextRunAt: Date | null;
	type: 'normal' | 'single';
	lockedAt?: Date | undefined;
	lastFinishedAt?: Date | undefined;
	failedAt?: Date | undefined;
	failCount?: number | undefined;
	failReason?: string | undefined;
	repeatTimezone?: string | undefined;
	lastRunAt?: Date | undefined;
	repeatInterval?: string | number | undefined;
	data: T | Partial<T>;
	repeatAt?: string | undefined;
	disabled?: boolean | undefined;
	progress?: number | undefined;
	unique?: Partial<Omit<IJobParameters<T>, 'unique'>> | undefined;
	uniqueOpts?: { insertOnly: boolean } | undefined;
	lastModifiedBy?: string | undefined;
	fork?: boolean | undefined;

	get uniqueHash(): string {
		const attrsStr = Object.entries(this.unique || {})
			.sort(([key1], [key2]) => key1.localeCompare(key2))
			.reduce((acc, [key, value]) => acc + key + value, '');

		return attrsStr ? Buffer.from(attrsStr).toString('base64') : '';
	}

	toObject(): IJobParameters<T> {
		return {
			id: this.id,
			name: this.name,
			priority: this.priority,
			nextRunAt: this.nextRunAt,
			type: this.type,
			lockedAt: this.lockedAt,
			lastFinishedAt: this.lastFinishedAt,
			failedAt: this.failedAt,
			failCount: this.failCount,
			failReason: this.failReason,
			repeatTimezone: this.repeatTimezone,
			lastRunAt: this.lastRunAt,
			repeatInterval: this.repeatInterval,
			data: this.data,
			repeatAt: this.repeatAt,
			disabled: this.disabled,
			progress: this.progress,
			unique: this.unique,
			uniqueOpts: this.uniqueOpts,
			lastModifiedBy: this.lastModifiedBy,
			fork: this.fork
		};
	}

	static fromObject<T>(data: IJobParameters<T>): JobParameters<T> {
		return new JobParameters(data);
	}

	private constructor(data: IJobParameters<T>) {
		Object.assign(this, data);
	}
}

export type TJobDatefield = keyof Pick<
	IJobParameters,
	'lastRunAt' | 'lastFinishedAt' | 'nextRunAt' | 'failedAt' | 'lockedAt'
>;

export const datefields: Array<TJobDatefield> = [
	'lastRunAt',
	'lastFinishedAt',
	'nextRunAt',
	'failedAt',
	'lockedAt'
];
