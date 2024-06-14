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
import { Job, JobWithId } from '..';
import { AgendaDBAdapter, FilterQuery } from '../types/AgendaDBAdapter';
import { IJobParameters } from '../types/JobParameters';

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

	private async database(url: string, options?: MongoClientOptions) {
		let connectionString = url;

		if (!hasMongoProtocol(connectionString)) {
			connectionString = `mongodb://${connectionString}`;
		}

		const client = await MongoClient.connect(connectionString, {
			...options
		});

		return client.db();
	}

	async connect(): Promise<void> {
		const db = await this.createConnection();
		log('successful connection to MongoDB', db.options);

		const collection = this.connectOptions.db?.collection || 'agendaJobs';

		this.collection = db.collection(collection);
		if (log.enabled) {
			log(
				`connected with collection: ${collection}, collection size: ${
					typeof this.collection.estimatedDocumentCount === 'function'
						? await this.collection.estimatedDocumentCount()
						: '?'
				}`
			);
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
				log('index succesfully created', result);
			} catch (error) {
				log('db index creation failed', error);
				throw error;
			}
		}
	}

	close(): Promise<void> {
		throw new Error('Method not implemented.');
	}

	getJobs<R = unknown>(
		query: Partial<IJobParameters>,
		sort: `${string}:${1 | -1}`,
		limit: number,
		skip: number
	): Promise<IJobParameters<R>[]> {
		const [field, order] = sort.split(':');
		return this.collection
			.find<IJobParameters<R>>(query)
			.sort({
				[field]: order === '1' ? 1 : -1
			})
			.limit(limit)
			.skip(skip)
			.toArray();
	}

	getJobById<R = unknown>(id: string): Promise<IJobParameters<R> | null> {
		return this.collection.findOne<IJobParameters<R> | null>({ id });
	}

	async removeJobsWithNotNames(names: string[]): Promise<number> {
		const result = await this.collection.deleteMany({ name: { $nin: names } });
		return result.deletedCount || 0;
	}

	async removeJobs(query: FilterQuery<IJobParameters>): Promise<number> {
		const result = await this.collection.deleteMany(query);
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
		// Query to run against collection to see if we need to lock it
		const criteria: Filter<Omit<IJobParameters, 'lockedAt'> & { lockedAt?: Date | null }> = {
			id: job.attrs.id,
			name: job.attrs.name,
			lockedAt: null,
			nextRunAt: job.attrs.nextRunAt,
			disabled: { $ne: true }
		};

		// Update / options for the MongoDB query
		const update: UpdateFilter<IJobParameters> = { $set: { lockedAt: new Date() } };
		const options: FindOneAndUpdateOptions = {
			returnDocument: 'after',
			sort: this.connectOptions.sort
		};

		// Lock the job in MongoDB!
		const resp = await this.collection.findOneAndUpdate(
			criteria as Filter<IJobParameters>,
			update,
			options
		);

		return resp || undefined;
	}

	async getNextJobToRun(
		jobName: string,
		nextScanAt: Date,
		lockDeadline: Date,
		now?: Date
	): Promise<IJobParameters | undefined> {
		/**
		 * Query used to find job to run
		 */
		const JOB_PROCESS_WHERE_QUERY: Filter<IJobParameters /* Omit<IJobParameters, 'lockedAt'> & { lockedAt?: Date | null } */> =
			{
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

		/**
		 * Query used to set a job as locked
		 */
		const JOB_PROCESS_SET_QUERY: UpdateFilter<IJobParameters> = { $set: { lockedAt: now } };

		/**
		 * Query used to affect what gets returned
		 */
		const JOB_RETURN_QUERY: FindOneAndUpdateOptions = {
			returnDocument: 'after',
			sort: this.connectOptions.sort
		};

		// Find ONE and ONLY ONE job and set the 'lockedAt' time so that job begins to be processed
		const result = await this.collection.findOneAndUpdate(
			JOB_PROCESS_WHERE_QUERY,
			JOB_PROCESS_SET_QUERY,
			JOB_RETURN_QUERY
		);

		return result || undefined;
	}

	async saveJobState(job: Job<any>): Promise<void> {
		const id = job.attrs.id;
		const $set = {
			lockedAt: (job.attrs.lockedAt && new Date(job.attrs.lockedAt)) || undefined,
			nextRunAt: (job.attrs.nextRunAt && new Date(job.attrs.nextRunAt)) || undefined,
			lastRunAt: (job.attrs.lastRunAt && new Date(job.attrs.lastRunAt)) || undefined,
			progress: job.attrs.progress,
			failReason: job.attrs.failReason,
			failCount: job.attrs.failCount,
			failedAt: job.attrs.failedAt && new Date(job.attrs.failedAt),
			lastFinishedAt: (job.attrs.lastFinishedAt && new Date(job.attrs.lastFinishedAt)) || undefined
		};

		log('[job %s] save job state: \n%O', id, $set);

		const result = await this.collection.updateOne(
			{ id, name: job.attrs.name },
			{
				$set
			}
		);

		if (!result.acknowledged || result.matchedCount !== 1) {
			throw new Error(
				`job ${id} (name: ${job.attrs.name}) cannot be updated in the database, maybe it does not exist anymore?`
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
		try {
			log('attempting to save a job');

			// Grab information needed to save job but that we don't want to persist in MongoDB

			// Store job as JSON and remove props we don't want to store from object
			// id, unique, uniqueOpts
			const { id, unique, uniqueOpts, ...props } = {
				...job.attrs,
				// Store name of agenda queue as last modifier in job data
				lastModifiedBy
			};

			log('[job %s] set job props: \n%O', id, props);

			// Grab current time and set default query options for MongoDB
			const now = new Date();
			const protect: Partial<IJobParameters> = {};
			let update: UpdateFilter<IJobParameters> = { $set: props };
			log('current time stored as %s', now.toISOString());

			// If the job already had an ID, then update the properties of the job
			// i.e, who last modified it, etc
			if (id) {
				// Update the job and process the resulting data'
				log('job already has id, calling findOneAndUpdate() using id as query');
				const result = await this.collection.findOneAndUpdate(
					{ id: id, name: props.name },
					update,
					{ returnDocument: 'after' }
				);

				return {
					job,
					result: result as IJobParameters<DATA>
				};
			}

			if (props.type === 'single') {
				// Job type set to 'single' so...
				log('job with type of "single" found');

				// If the nextRunAt time is older than the current time, "protect" that property, meaning, don't change
				// a scheduled job's next run time!
				if (props.nextRunAt && props.nextRunAt <= now) {
					log('job has a scheduled nextRunAt time, protecting that field from upsert');
					protect.nextRunAt = props.nextRunAt;
					delete (props as Partial<IJobParameters>).nextRunAt;
				}

				// If we have things to protect, set them in MongoDB using $setOnInsert
				if (Object.keys(protect).length > 0) {
					update.$setOnInsert = protect;
				}

				// Try an upsert
				log(
					`calling findOneAndUpdate(${props.name}) with job name and type of "single" as query`,
					await this.collection.findOne({
						name: props.name,
						type: 'single'
					})
				);
				// this call ensure a job of this name can only exists once
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
					`findOneAndUpdate(${props.name}) with type "single" ${
						result.lastErrorObject?.updatedExisting
							? 'updated existing entry'
							: 'inserted new entry'
					}`
				);
				return {
					job,
					result: result.value as IJobParameters<DATA>
				};
			}

			if (job.attrs.unique) {
				// If we want the job to be unique, then we can upsert based on the 'unique' query object that was passed in
				const query: Partial<Omit<IJobParameters<DATA>, 'unique'>> = job.attrs.unique;
				query.name = props.name;
				if (uniqueOpts?.insertOnly) {
					update = { $setOnInsert: props };
				}

				// Use the 'unique' query object to find an existing job or create a new one
				log('calling findOneAndUpdate() with unique object as query: \n%O', query);
				const result = await this.collection.findOneAndUpdate(query as IJobParameters, update, {
					upsert: true,
					returnDocument: 'after'
				});

				return {
					job,
					result: result as IJobParameters<DATA>
				};
			}

			// If all else fails, the job does not exist yet so we just insert it into MongoDB
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
