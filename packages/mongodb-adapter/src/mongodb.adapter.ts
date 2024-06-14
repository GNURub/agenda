import { AgendaDBAdapter, FilterQuery, IJobParameters, Job, JobWithId } from '@agenda/agenda';
import debug from 'debug';
import type { SortDirection } from 'mongodb';
import {
	Collection,
	Db,
	Filter,
	FindOneAndUpdateOptions,
	MongoClient,
	MongoClientOptions,
	UpdateFilter
} from 'mongodb';

const log = debug('agenda:db:mongo');

export interface IDatabaseOptions {
	db: {
		collection?: string;
		address: string;
		options?: MongoClientOptions;
	};
}

export interface IMongoOptions {
	db?: {
		collection?: string;
	};
	mongo: Db;
}

export interface IDbConfig {
	ensureIndex?: boolean;
	sort?: {
		[key: string]: SortDirection;
	};
}

const hasMongoProtocol = (url: string): boolean => /mongodb(?:\+srv)?:\/\/.*/.test(url);

export class AgendaMongoAdapter implements AgendaDBAdapter {
	collection: Collection<IJobParameters>;

	private connectOptions: (IDatabaseOptions | IMongoOptions) & IDbConfig;

	constructor(mongoOptions: (IDatabaseOptions | IMongoOptions) & IDbConfig) {
		this.connectOptions = {
			sort: { nextRunAt: 1, priority: -1 },
			...mongoOptions
		};
	}

	private async createConnection(): Promise<Db> {
		const { connectOptions } = this;
		if (this.hasDatabaseConfig(connectOptions)) {
			log('using database config', connectOptions);
			return this.database(connectOptions.db.address, connectOptions.db.options);
		}

		if (this.hasMongoConnection(connectOptions)) {
			log('using passed in mongo connection');
			return connectOptions.mongo;
		}

		throw new Error('invalid db config, or db config not found');
	}

	private hasMongoConnection(connectOptions: unknown): connectOptions is IMongoOptions {
		return !!(connectOptions as IMongoOptions)?.mongo;
	}

	private hasDatabaseConfig(connectOptions: unknown): connectOptions is IDatabaseOptions {
		return !!(connectOptions as IDatabaseOptions)?.db?.address;
	}

	private async database(url: string, options?: MongoClientOptions): Promise<Db> {
		let connectionString = url;

		if (!hasMongoProtocol(connectionString)) {
			connectionString = `mongodb://${connectionString}`;
		}

		const client = await MongoClient.connect(connectionString, options);
		return client.db();
	}

	async connect(): Promise<void> {
		try {
			const db = await this.createConnection();
			log('successful connection to MongoDB', db.options);

			const collectionName = this.connectOptions.db?.collection || 'agendaJobs';
			this.collection = db.collection(collectionName);

			log(`connected with collection: ${collectionName}`);
			if (log.enabled) {
				const count = await this.collection.estimatedDocumentCount();
				log(`collection size: ${count}`);
			}

			if (this.connectOptions.ensureIndex) {
				log('attempting index creation');
				try {
					const result = await this.collection.createIndex(
						{
							name: 1,
							...this.connectOptions.sort,
							priority: -1,
							lockedAt: 1,
							nextRunAt: 1,
							disabled: 1
						},
						{ name: 'findAndLockNextJobIndex' }
					);
					log('index successfully created', result);
				} catch (error) {
					log('db index creation failed', error);
					throw error;
				}
			}
		} catch (error) {
			log('failed to connect to MongoDB', error);
			throw error;
		}
	}

	async getJobs<R = unknown>(
		query: Partial<IJobParameters>,
		sort?: `${string}:${1 | -1}`,
		limit?: number,
		skip?: number
	): Promise<IJobParameters<R>[]> {
		let q: any = {};

		for (const key in query) {
			if (Array.isArray(query[key as keyof FilterQuery])) {
				q[key] = { $in: query[key as keyof FilterQuery] };
			} else {
				q[key] = query[key as keyof FilterQuery];
			}
		}

		let r = this.collection.find<IJobParameters<R>>(q);

		if (skip !== undefined) {
			r = r.skip(skip);
		}

		if (limit !== undefined) {
			r = r.limit(limit);
		}

		if (sort !== undefined) {
			const [field, order] = sort.split(':');
			r = r.sort({ [field]: order === '1' ? 1 : -1 });
		}

		return r.toArray();
	}

	getJobById<R = unknown>(id: string): Promise<IJobParameters<R> | null> {
		return this.collection.findOne<IJobParameters<R> | null>({ id });
	}

	async removeJobs(query: FilterQuery): Promise<number> {
		let q: any = {};

		for (const key in query) {
			if (Array.isArray(query[key as keyof FilterQuery])) {
				q[key] = { $in: query[key as keyof FilterQuery] };
			} else {
				q[key] = query[key as keyof FilterQuery];
			}
		}

		const result = await this.collection.deleteMany(q);
		return result.deletedCount || 0;
	}

	getQueueSize(): Promise<number> {
		return this.collection.countDocuments({ nextRunAt: { $lt: new Date() } });
	}

	async unlockJob(jobId: string): Promise<void> {
		// only unlock jobs which are not currently processed (nextRunAT is not null)
		await this.collection.updateOne(
			{ id: jobId, nextRunAt: { $ne: null } },
			{ $unset: { lockedAt: true } }
		);
	}

	async unlockJobs(jobIds: string[]): Promise<void> {
		await this.collection.updateMany(
			{ id: { $in: jobIds }, nextRunAt: { $ne: null } },
			{ $unset: { lockedAt: true } }
		);
	}

	async lockJob(job: JobWithId): Promise<IJobParameters | undefined> {
		const criteria: Filter<Omit<IJobParameters, 'lockedAt'> & { lockedAt?: Date | null }> = {
			id: job.attrs.id,
			name: job.attrs.name,
			lockedAt: null,
			nextRunAt: job.attrs.nextRunAt,
			disabled: { $ne: true }
		};

		const update: UpdateFilter<IJobParameters> = { $set: { lockedAt: new Date() } };
		const options: FindOneAndUpdateOptions = {
			returnDocument: 'after',
			sort: this.connectOptions.sort
		};

		const resp = await this.collection.findOneAndUpdate(
			criteria as Filter<IJobParameters>,
			update,
			{
				...options,
				includeResultMetadata: true
			}
		);

		return resp.value || undefined;
	}

	async getNextJobToRun(
		jobName: string,
		nextScanAt: Date,
		lockDeadline: Date,
		now?: Date
	): Promise<IJobParameters | undefined> {
		const JOB_PROCESS_WHERE_QUERY: Filter<IJobParameters> = {
			name: jobName,
			disabled: { $ne: true },
			$or: [
				{
					lockedAt: { $eq: null as any },
					nextRunAt: { $lte: nextScanAt }
				},
				{
					lockedAt: { $lte: lockDeadline }
				}
			]
		};

		const JOB_PROCESS_SET_QUERY: UpdateFilter<IJobParameters> = { $set: { lockedAt: now } };

		const JOB_RETURN_QUERY: FindOneAndUpdateOptions = {
			returnDocument: 'after',
			sort: this.connectOptions.sort
		};

		const result = await this.collection.findOneAndUpdate(
			JOB_PROCESS_WHERE_QUERY,
			JOB_PROCESS_SET_QUERY,
			{
				...JOB_RETURN_QUERY,
				includeResultMetadata: true
			}
		);

		return result.value || undefined;
	}

	async saveJobState(job: Job<any>): Promise<void> {
		const id = job.attrs.id;
		const $set = {
			lockedAt: job.attrs.lockedAt ? new Date(job.attrs.lockedAt) : undefined,
			nextRunAt: job.attrs.nextRunAt ? new Date(job.attrs.nextRunAt) : undefined,
			lastRunAt: job.attrs.lastRunAt ? new Date(job.attrs.lastRunAt) : undefined,
			progress: job.attrs.progress,
			failReason: job.attrs.failReason,
			failCount: job.attrs.failCount,
			failedAt: job.attrs.failedAt ? new Date(job.attrs.failedAt) : undefined,
			lastFinishedAt: job.attrs.lastFinishedAt ? new Date(job.attrs.lastFinishedAt) : undefined
		};

		log('[job %s] save job state: \n%O', id, $set);

		const result = await this.collection.updateOne({ id, name: job.attrs.name }, { $set });

		if (!result.acknowledged || result.matchedCount !== 1) {
			throw new Error(
				`Job ${id} (name: ${job.attrs.name}) cannot be updated in the database, maybe it does not exist anymore?`
			);
		}
	}

	async saveJob<DATA = unknown>(
		job: Job<DATA>,
		lastModifiedBy?: string
	): Promise<{
		job: Job<DATA>;
		result: IJobParameters<DATA> | null;
	}> {
		try {
			log('attempting to save a job');

			const { id, unique, uniqueOpts, ...props } = {
				...job.attrs,
				lastModifiedBy
			};

			log('[job %s] set job props: \n%O', id, props);

			const now = new Date();
			const protect: Partial<IJobParameters> = {};
			let update: UpdateFilter<IJobParameters> = { $set: props };
			log('current time stored as %s', now.toISOString());

			if (id) {
				log('job already has id, calling findOneAndUpdate() using id as query');
				const result = await this.collection.findOneAndUpdate(
					{ id: id, name: props.name },
					update,
					{ returnDocument: 'after', includeResultMetadata: true }
				);

				return {
					job,
					result: result.value as IJobParameters<DATA>
				};
			}

			if (props.type === 'single') {
				log('job with type of "single" found');

				if (props.nextRunAt && props.nextRunAt <= now) {
					log('job has a scheduled nextRunAt time, protecting that field from upsert');
					protect.nextRunAt = props.nextRunAt;
					delete (props as Partial<IJobParameters>).nextRunAt;
				}

				if (Object.keys(protect).length > 0) {
					update.$setOnInsert = protect;
				}

				log(`calling findOneAndUpdate(${props.name}) with job name and type of "single" as query`);
				const result = await this.collection.findOneAndUpdate(
					{
						name: props.name,
						type: 'single'
					} as Filter<IJobParameters>,
					update,
					{
						upsert: true,
						returnDocument: 'after',
						includeResultMetadata: true
					}
				);
				log(
					`findOneAndUpdate(${props.name}) with type "single" ${result.lastErrorObject?.updatedExisting ? 'updated existing entry' : 'inserted new entry'}`
				);

				return {
					job,
					result: result.value as IJobParameters<DATA>
				};
			}

			if (job.attrs.unique) {
				const query: Partial<Omit<IJobParameters<DATA>, 'unique'>> = job.attrs.unique;
				query.name = props.name;
				if (uniqueOpts?.insertOnly) {
					update = { $setOnInsert: props };
				}

				log('calling findOneAndUpdate() with unique object as query: \n%O', query);
				const result = await this.collection.findOneAndUpdate(query as IJobParameters, update, {
					upsert: true,
					returnDocument: 'after',
					includeResultMetadata: true
				});

				return {
					job,
					result: result.value as IJobParameters<DATA>
				};
			}

			log(
				'using default behavior, inserting new job via insertOne() with props that were set: \n%O',
				props
			);

			const newId = crypto.randomUUID();

			await this.collection.insertOne({
				...props,
				id: newId
			});

			return {
				job,
				result: {
					id: newId,
					...props
				} as IJobParameters<DATA>
			};
		} catch (error) {
			log('processDbResult() received an error, job was not updated/created');
			throw error;
		}
	}
}
