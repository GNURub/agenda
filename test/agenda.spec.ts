import { Agenda, AgendaDBAdapter, Job } from '@agenda/agenda';
import { AgendaMemoryAdapter } from '@agenda/memory-adapter';
import delay from 'delay';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// agenda instances
let globalAgenda: Agenda;

let adapter: AgendaDBAdapter;

const clearJobs = async (): Promise<void> => {
	if (adapter) {
		await adapter.removeJobs({});
	}
};

// Slow timeouts for Travis
const jobTimeout = 500;
const jobType = 'do work';
const jobProcessor = () => {};

describe('Agenda', () => {
	beforeEach(async () => {
		if (!adapter) {
			adapter = new AgendaMemoryAdapter();
		}

		return new Promise(resolve => {
			globalAgenda = new Agenda(
				{
					adapter
				},
				async () => {
					await delay(50);
					await clearJobs();
					globalAgenda.define('someJob', jobProcessor);
					globalAgenda.define('send email', jobProcessor);
					globalAgenda.define('some job', jobProcessor);
					globalAgenda.define(jobType, jobProcessor);
					return resolve();
				}
			);
		});
	});

	afterEach(async () => {
		await delay(50);
		if (globalAgenda) {
			await globalAgenda.stop();
			await clearJobs();
		}
	});

	it('sets a default processEvery', () => {
		expect(globalAgenda.attrs.processEvery).toBe(5000);
	});

	describe('configuration methods', () => {
		it('sets the _db directly when passed as an option', () => {
			const agendaDb = new Agenda({ adapter });
			expect(agendaDb.db).toBeDefined();
		});
	});

	describe('name', () => {
		it('sets the agenda name', () => {
			globalAgenda.name('test queue');
			expect(globalAgenda.attrs.name).toBe('test queue');
		});
		it('returns itself', () => {
			expect(globalAgenda.name('test queue')).toBe(globalAgenda);
		});
	});

	describe('processEvery', () => {
		it('sets the processEvery time', () => {
			globalAgenda.processEvery('3 minutes');
			expect(globalAgenda.attrs.processEvery).toBe(180000);
		});
		it('returns itself', () => {
			expect(globalAgenda.processEvery('3 minutes')).toBe(globalAgenda);
		});
	});

	describe('maxConcurrency', () => {
		it('sets the maxConcurrency', () => {
			globalAgenda.maxConcurrency(10);
			expect(globalAgenda.attrs.maxConcurrency).toBe(10);
		});
		it('returns itself', () => {
			expect(globalAgenda.maxConcurrency(10)).toBe(globalAgenda);
		});
	});

	describe('defaultConcurrency', () => {
		it('sets the defaultConcurrency', () => {
			globalAgenda.defaultConcurrency(1);
			expect(globalAgenda.attrs.defaultConcurrency).toBe(1);
		});
		it('returns itself', () => {
			expect(globalAgenda.defaultConcurrency(5)).toBe(globalAgenda);
		});
	});

	describe('lockLimit', () => {
		it('sets the lockLimit', () => {
			globalAgenda.lockLimit(10);
			expect(globalAgenda.attrs.lockLimit).toBe(10);
		});
		it('returns itself', () => {
			expect(globalAgenda.lockLimit(10)).toBe(globalAgenda);
		});
	});

	describe('defaultLockLimit', () => {
		it('sets the defaultLockLimit', () => {
			globalAgenda.defaultLockLimit(1);
			expect(globalAgenda.attrs.defaultLockLimit).toBe(1);
		});
		it('returns itself', () => {
			expect(globalAgenda.defaultLockLimit(5)).toBe(globalAgenda);
		});
	});

	describe('defaultLockLifetime', () => {
		it('returns itself', () => {
			expect(globalAgenda.defaultLockLifetime(1000)).toBe(globalAgenda);
		});
		it('sets the default lock lifetime', () => {
			globalAgenda.defaultLockLifetime(9999);
			expect(globalAgenda.attrs.defaultLockLifetime).toBe(9999);
		});
		it('is inherited by jobs', () => {
			globalAgenda.defaultLockLifetime(7777);
			globalAgenda.define('testDefaultLockLifetime', () => {});
			expect(globalAgenda.definitions.testDefaultLockLifetime.lockLifetime).toBe(7777);
		});
	});
});

describe('job methods', () => {
	describe('create', () => {
		let job: Job;
		beforeEach(() => {
			job = globalAgenda.create('sendEmail', { to: 'some guy' });
		});

		it('returns a job', () => {
			expect(job).to.toBeInstanceOf(Job);
		});
		it('sets the name', () => {
			expect(job.attrs.name).toBe('sendEmail');
		});
		it('sets the type', () => {
			expect(job.attrs.type).toBe('normal');
		});
		it('sets the agenda', () => {
			expect(job.agenda).toBe(globalAgenda);
		});
		it('sets the data', () => {
			expect(job.attrs.data).toHaveProperty('to', 'some guy');
		});
	});

	describe('define', () => {
		it('stores the definition for the job', () => {
			expect(globalAgenda.definitions.someJob).toHaveProperty('fn', jobProcessor);
		});

		it('sets the default concurrency for the job', () => {
			expect(globalAgenda.definitions.someJob).toHaveProperty('concurrency', 5);
		});

		it('sets the default lockLimit for the job', () => {
			expect(globalAgenda.definitions.someJob).toHaveProperty('lockLimit', 0);
		});

		it('sets the default priority for the job', () => {
			expect(globalAgenda.definitions.someJob).toHaveProperty('priority', 0);
		});
		it('takes concurrency option for the job', () => {
			globalAgenda.define('highPriority', jobProcessor, { priority: 10 });
			expect(globalAgenda.definitions.highPriority).toHaveProperty('priority', 10);
		});
	});

	describe('every', () => {
		describe('with a job name specified', () => {
			it('returns a job', async () => {
				expect(await globalAgenda.every('5 minutes', 'send email')).toBeInstanceOf(Job);
			});
			it('sets the repeatEvery', async () => {
				expect(
					await globalAgenda
						.every('5 seconds', 'send email')
						.then(({ attrs }) => attrs.repeatInterval)
				).toBe('5 seconds');
			});
			it('sets the agenda', async () => {
				expect(
					await globalAgenda.every('5 seconds', 'send email').then(({ agenda }) => agenda)
				).toBe(globalAgenda);
			});
			it('should update a job that was previously scheduled with `every`', async () => {
				await globalAgenda.every(10, 'shouldBeSingleJob');
				await delay(10);
				await globalAgenda.every(20, 'shouldBeSingleJob');

				// Give the saves a little time to propagate
				await delay(jobTimeout);

				const res = await globalAgenda.jobs({ name: 'shouldBeSingleJob' });
				expect(res).toHaveLength(1);
			});
			it('should not run immediately if options.skipImmediate is true', async () => {
				const jobName = 'send email';
				await globalAgenda.every('5 minutes', jobName, {}, { skipImmediate: true });
				const job = (await globalAgenda.jobs({ name: jobName }))[0];
				const nextRunAt = job.attrs.nextRunAt!.getTime();
				const now = new Date().getTime();
				expect(nextRunAt - now > 0).toBe(true);
			});
			it('should run immediately if options.skipImmediate is false', async () => {
				const jobName = 'send email';
				await globalAgenda.every('5 minutes', jobName, {}, { skipImmediate: false });
				const job = (await globalAgenda.jobs({ name: jobName }))[0];
				const nextRunAt = job.attrs.nextRunAt!.getTime();
				const now = new Date().getTime();
				expect(nextRunAt - now <= 0).toBe(true);
			});
		});
		describe('with array of names specified', () => {
			it('returns array of jobs', async () => {
				expect(
					Array.isArray(await globalAgenda.every('5 minutes', ['send email', 'some job']))
				).toBe(true);
			});
		});
	});

	describe('schedule', () => {
		describe('with a job name specified', () => {
			it('returns a job', async () => {
				expect(await globalAgenda.schedule('in 5 minutes', 'send email')).toBeInstanceOf(Job);
			});
			it('sets the schedule', async () => {
				const fiveish = new Date().valueOf() + 250000;
				const scheduledJob = await globalAgenda.schedule('in 5 minutes', 'send email');
				expect(scheduledJob.attrs.nextRunAt!.valueOf()).toBeGreaterThan(fiveish);
			});
		});
		describe('with array of names specified', () => {
			it('returns array of jobs', async () => {
				expect(
					Array.isArray(await globalAgenda.schedule('5 minutes', ['send email', 'some job']))
				).toBe(true);
			});
		});
	});

	describe('unique', () => {
		describe('should demonstrate unique contraint', () => {
			it('should modify one job when unique matches', async () => {
				const job1 = await globalAgenda
					.create('unique job', {
						type: 'active',
						userId: '123',
						other: true
					})
					.unique({
						data: {
							type: 'active',
							userId: '123'
						}
					})
					.schedule('now')
					.save();

				await delay(100);

				const job2 = await globalAgenda
					.create('unique job', {
						type: 'active',
						userId: '123',
						other: false
					})
					.unique({
						data: {
							type: 'active',
							userId: '123'
						}
					})
					.schedule('now')
					.save();

				expect(job1.attrs.nextRunAt!.toISOString()).not.toBe(job2.attrs.nextRunAt!.toISOString());

				const jobs = await adapter.getJobs({ name: 'unique job' });

				expect(jobs).toHaveLength(1);
			});

			it('should not modify job when unique matches and insertOnly is set to true', async () => {
				const job1 = await globalAgenda
					.create('unique job', {
						type: 'active',
						userId: '123',
						other: true
					})
					.unique(
						{
							data: {
								type: 'active',
								userId: '123'
							}
						},
						{
							insertOnly: true
						}
					)
					.schedule('now')
					.save();

				const job2 = await globalAgenda
					.create('unique job', {
						type: 'active',
						userId: '123',
						other: false
					})
					.unique(
						{
							data: {
								type: 'active',
								userId: '123'
							}
						},
						{
							insertOnly: true
						}
					)
					.schedule('now')
					.save();

				expect(job1.attrs.nextRunAt!.toISOString()).toBe(job2.attrs.nextRunAt!.toISOString());

				const jobs = await adapter.getJobs({ name: 'unique job' });
				expect(jobs).toHaveLength(1);
			});
		});

		describe('should demonstrate non-unique contraint', () => {
			it("should create two jobs when unique doesn't match", async () => {
				const time = new Date(Date.now() + 1000 * 60 * 3);
				const time2 = new Date(Date.now() + 1000 * 60 * 4);

				await globalAgenda
					.create('unique job', {
						type: 'active',
						userId: '123',
						other: true
					})
					.unique({
						data: {
							type: 'active',
							userId: '123'
						},
						nextRunAt: time
					})
					.schedule(time)
					.save();

				await globalAgenda
					.create('unique job', {
						type: 'active',
						userId: '123',
						other: false
					})
					.unique({
						data: {
							type: 'active',
							userId: '123'
						},
						nextRunAt: time2
					})
					.schedule(time)
					.save();

				const jobs = await adapter.getJobs({ name: 'unique job' });

				expect(jobs).toHaveLength(2);
			});
		});

		describe('now', () => {
			it('returns a job', async () => {
				expect(await globalAgenda.now('send email')).to.toBeInstanceOf(Job);
			});
			it('sets the schedule', async () => {
				const now = new Date();
				expect(
					await globalAgenda.now('send email').then(({ attrs }) => attrs.nextRunAt!.valueOf())
				).toBeGreaterThan(now.valueOf() - 1);
			});

			it('runs the job immediately', async () => {
				globalAgenda.define('immediateJob', async job => {
					expect(await job.isRunning()).toBe(true);
					await globalAgenda.stop();
				});
				await globalAgenda.now('immediateJob');
				await globalAgenda.start();
			});
		});

		describe('jobs', () => {
			it('returns jobs', async () => {
				await globalAgenda.create('test').save();
				const c = await globalAgenda.jobs({});

				expect(c.length).not.toBe(0);
				expect(c[0]).to.toBeInstanceOf(Job);
				await clearJobs();
			});
		});

		describe('purge', () => {
			it('removes all jobs without definitions', async () => {
				const job = globalAgenda.create('no definition');
				await globalAgenda.stop();
				await job.save();
				const j = await globalAgenda.jobs({
					name: 'no definition'
				});

				expect(j).toHaveLength(1);
				await globalAgenda.purge();
				const jAfterPurge = await globalAgenda.jobs({
					name: 'no definition'
				});

				expect(jAfterPurge).toHaveLength(0);
			});
		});

		describe('saveJob', () => {
			it('persists job to the database', async () => {
				const job = globalAgenda.create('someJob', {});
				await job.save();

				expect(job.attrs.id).toBeDefined();

				await clearJobs();
			});
		});
	});

	describe('cancel', () => {
		beforeEach(async () => {
			let remaining = 3;
			const checkDone = () => {
				remaining -= 1;
			};

			await globalAgenda.create('jobA').save().then(checkDone);
			await globalAgenda.create('jobA', 'someData').save().then(checkDone);
			await globalAgenda.create('jobB').save().then(checkDone);
			expect(remaining).toBe(0);
		});

		afterEach(async () => {
			await globalAgenda.db.removeJobs({ name: ['jobA', 'jobB'] });
		});

		it('should cancel a job', async () => {
			const j = await globalAgenda.jobs({ name: 'jobA' });
			expect(j).toHaveLength(2);

			await globalAgenda.cancel({ name: 'jobA' });
			const job = await globalAgenda.jobs({ name: 'jobA' });

			expect(job).toHaveLength(0);
		});

		it('should cancel multiple jobs', async () => {
			const jobs1 = await Promise.all([
				globalAgenda.jobs({ name: 'jobA' }),
				globalAgenda.jobs({ name: 'jobB' })
			]).then(r => r.flat());
			expect(jobs1).toHaveLength(3);
			await globalAgenda.cancel({ name: ['jobA', 'jobB'] });

			const jobs2 = await Promise.all([
				globalAgenda.jobs({ name: 'jobA' }),
				globalAgenda.jobs({ name: 'jobB' })
			]).then(r => r.flat());
			expect(jobs2).toHaveLength(0);
		});

		it('should cancel jobs only if the data matches', async () => {
			const jobs1 = await globalAgenda.jobs({ name: 'jobA', data: 'someData' });
			expect(jobs1).toHaveLength(1);
			await globalAgenda.cancel({ name: 'jobA', data: 'someData' });

			const jobs2 = await globalAgenda.jobs({ name: 'jobA', data: 'someData' });
			expect(jobs2).toHaveLength(0);

			const jobs3 = await globalAgenda.jobs({ name: 'jobA' });
			expect(jobs3).toHaveLength(1);
		});
	});

	describe('search', () => {
		beforeEach(async () => {
			await globalAgenda.create('jobA', 1).save();
			await globalAgenda.create('jobA', 2).save();
			await globalAgenda.create('jobA', 3).save();
		});

		afterEach(async () => {
			await globalAgenda.db.removeJobs({ name: 'jobA' });
		});

		it('should limit jobs', async () => {
			const results = await globalAgenda.jobs({ name: 'jobA' }, undefined, 2);
			expect(results).toHaveLength(2);
		});

		it('should skip jobs', async () => {
			const results = await globalAgenda.jobs({ name: 'jobA' }, undefined, 2, 2);
			expect(results).toHaveLength(1);
		});

		it('should sort jobs', async () => {
			const results = await globalAgenda.jobs({ name: 'jobA' }, 'data:-1');

			expect(results).toHaveLength(3);

			const job1 = results[0];
			const job2 = results[1];
			const job3 = results[2];

			expect(job1.attrs.data).toBe(3);
			expect(job2.attrs.data).toBe(2);
			expect(job3.attrs.data).toBe(1);
		});
	});

	describe('process jobs', () => {
		// eslint-disable-line prefer-arrow-callback
		it('do not run failed jobs again', async () => {
			const unhandledRejections: any[] = [];
			const rejectionsHandler = (error: any) => unhandledRejections.push(error);
			process.on('unhandledRejection', rejectionsHandler);

			let jprocesses = 0;

			globalAgenda.define('failing job', async _job => {
				jprocesses++;
				throw new Error('failed');
			});

			let failCalled = false;
			globalAgenda.on('fail:failing job', _err => {
				failCalled = true;
			});

			let errorCalled = false;
			globalAgenda.on('error', _err => {
				errorCalled = true;
			});

			globalAgenda.processEvery(100);
			await globalAgenda.start();

			await globalAgenda.now('failing job');

			await delay(500);

			process.removeListener('unhandledRejection', rejectionsHandler);

			expect(jprocesses).toBe(1);
			expect(errorCalled).toBe(false);
			expect(failCalled).toBe(true);
			expect(unhandledRejections).toHaveLength(0);
		});

		// eslint-disable-line prefer-arrow-callback
		it('ensure there is no unhandledPromise on job timeouts', async () => {
			const unhandledRejections: any[] = [];
			const rejectionsHandler = (error: any) => unhandledRejections.push(error);
			process.on('unhandledRejection', rejectionsHandler);

			globalAgenda.define(
				'very short timeout',
				(_job, done) => {
					setTimeout(() => {
						done();
					}, 10000);
				},
				{
					lockLifetime: 100
				}
			);

			let errorCalled = false;
			globalAgenda.on('error', _err => {
				errorCalled = true;
			});

			globalAgenda.processEvery(100);
			await globalAgenda.start();

			// await globalAgenda.every('1 seconds', 'j0');
			await globalAgenda.now('very short timeout');

			await delay(500);

			process.removeListener('unhandledRejection', rejectionsHandler);

			expect(errorCalled).toBe(true);
			expect(unhandledRejections).toHaveLength(0);
		});

		it('should not cause unhandledRejection', async () => {
			// This unit tests if for this bug [https://github.com/agenda/agenda/issues/884]
			// which is not reproducible with default agenda config on shorter processEvery.
			// Thus we set the test timeout to 10000, and the delay below to 6000.

			const unhandledRejections: any[] = [];
			const rejectionsHandler = (error: any) => unhandledRejections.push(error);
			process.on('unhandledRejection', rejectionsHandler);

			/*
			let j0processes = 0;
			globalAgenda.define('j0', (_job, done) => {
				j0processes += 1;
				done();
			}); */

			let j1processes = 0;

			globalAgenda.define('j1', (_job, done) => {
				j1processes += 1;
				done();
			});

			let j2processes = 0;
			globalAgenda.define('j2', (_job, done) => {
				j2processes += 1;
				done();
			});

			let j3processes = 0;
			globalAgenda.define('j3', async _job => {
				j3processes += 1;
			});
			await globalAgenda.start();

			// await globalAgenda.every('1 seconds', 'j0');
			await globalAgenda.every('5 seconds', 'j1');
			await globalAgenda.every('10 seconds', 'j2');
			await globalAgenda.every('15 seconds', 'j3');

			await delay(3001);

			process.removeListener('unhandledRejection', rejectionsHandler);

			// expect(j0processes).to.equal(5);
			expect(j1processes).toBeGreaterThanOrEqual(1);
			expect(j2processes).toBe(1);
			expect(j3processes).toBe(1);

			expect(unhandledRejections).toHaveLength(0);
		});
	});
});
