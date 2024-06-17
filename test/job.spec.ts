import { Agenda, Job, type AgendaDBAdapter } from '@agenda/agenda';
import { AgendaMemoryAdapter } from '@agenda/memory-adapter';
import { fail } from 'assert';
import delay from 'delay';
import { DateTime } from 'luxon';
import sinon from 'sinon';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

// Create agenda instances
let agenda: Agenda;
// connection string to mongodb
let mongoCfg: string;
// mongo db connection db instance
let adapter: AgendaDBAdapter;

const clearJobs = async (): Promise<void> => {
	if (adapter) {
		await adapter.removeJobs();
	}
};

// Slow timeouts for Travis
const jobTimeout = 500;
const jobType = 'do work';
const jobProcessor = () => {};

describe('Job', () => {
	beforeEach(async () => {
		if (!adapter) {
			adapter = new AgendaMemoryAdapter();
		}

		return new Promise(resolve => {
			agenda = new Agenda(
				{
					adapter
				},
				async () => {
					await delay(50);
					await clearJobs();
					agenda.define('someJob', jobProcessor);
					agenda.define('send email', jobProcessor);
					agenda.define('some job', jobProcessor);
					agenda.define(jobType, jobProcessor);
					return resolve();
				}
			);
		});
	});

	afterEach(async () => {
		await delay(50);
		await agenda.stop();
		await clearJobs();
		// await mongoClient.disconnect();
		// await jobs._db.close();
	});

	describe('repeatAt', () => {
		const job = new Job(agenda, { name: 'demo', type: 'normal' });
		test('sets the repeat at', () => {
			job.repeatAt('3:30pm');
			expect(job.attrs.repeatAt).toBe('3:30pm');
		});
		test('returns the job', () => {
			expect(job.repeatAt('3:30pm')).toBe(job);
		});
	});

	describe('toJSON', () => {
		test('failedAt', () => {
			let job = new Job(agenda, {
				name: 'demo',
				type: 'normal',
				nextRunAt: null,
				failedAt: null as any
			});
			expect(job.toJson().failedAt).not.toBeInstanceOf(Date);

			job = new Job(agenda, {
				name: 'demo',
				type: 'normal',
				nextRunAt: null,
				failedAt: new Date()
			});
			expect(job.toJson().failedAt).toBeInstanceOf(Date);
		});
	});

	describe('unique', () => {
		const job = new Job(agenda, { name: 'demo', type: 'normal' });
		test('sets the unique property', () => {
			job.unique({
				data: {
					type: 'active',
					userId: '123'
				}
			});
			expect(JSON.stringify(job.attrs.unique)).toBe(
				JSON.stringify({ data: { type: 'active', userId: '123' } })
			);
		});

		test('returns the job', () => {
			expect(
				job.unique({
					data: {
						type: 'active',
						userId: '123'
					}
				})
			).toBe(job);
		});
	});

	describe('repeatEvery', () => {
		const job = new Job(agenda, { name: 'demo', type: 'normal' });
		test('sets the repeat interval', () => {
			job.repeatEvery(5000);
			expect(job.attrs.repeatInterval).toBe(5000);
		});

		test('returns the job', () => {
			expect(job.repeatEvery('one second')).toBe(job);
		});

		test('sets the nextRunAt property with skipImmediate', () => {
			const job2 = new Job(agenda, { name: 'demo', type: 'normal' });
			const now = new Date().valueOf();
			job2.repeatEvery('3 minutes', { skipImmediate: true });
			expect(job2.attrs.nextRunAt!.valueOf()).toBeGreaterThanOrEqual(
				new Date(now + 180000).valueOf()
			);
			expect(job2.attrs.nextRunAt!.valueOf()).toBeLessThanOrEqual(new Date(now + 180002).valueOf()); // Inclusive
		});

		test('repeats from the existing nextRunAt property with skipImmediate', () => {
			const job2 = new Job(agenda, { name: 'demo', type: 'normal' });
			const futureDate = new Date('3000-01-01T00:00:00');
			job2.attrs.nextRunAt = futureDate;
			job2.repeatEvery('3 minutes', { skipImmediate: true });
			expect(job2.attrs.nextRunAt!.getTime()).toBe(futureDate.getTime() + 180000);
		});

		test('repeats from the existing scheduled date with skipImmediate', () => {
			const futureDate = new Date('3000-01-01T00:00:00');
			const job2 = new Job(agenda, { name: 'demo', type: 'normal' }).schedule(futureDate);
			job2.repeatEvery('3 minutes', { skipImmediate: true });
			expect(job2.attrs.nextRunAt!.getTime()).toBe(futureDate.valueOf() + 180000);
		});
	});

	describe('schedule', () => {
		let job: Job;
		beforeEach(() => {
			job = new Job(agenda, { name: 'demo', type: 'normal' });
		});

		test('sets the next run time', () => {
			job.schedule('in 5 minutes');
			expect(job.attrs.nextRunAt).toBeInstanceOf(Date);
		});

		test('sets the next run time Date object', () => {
			const when = new Date(Date.now() + 1000 * 60 * 3);
			job.schedule(when);
			expect(job.attrs.nextRunAt).toBeInstanceOf(Date);
			expect(job.attrs.nextRunAt!.getTime()).toEqual(when.getTime());
		});

		test('returns the job', () => {
			expect(job.schedule('tomorrow at noon')).toBe(job);
		});

		test('understands ISODates on the 30th', () => {
			// https://github.com/agenda/agenda/issues/807
			expect(job.schedule('2019-04-30T22:31:00.00Z').attrs.nextRunAt!.getTime()).toBe(
				1556663460000
			);
		});
	});

	describe('priority', () => {
		let job: Job;
		beforeEach(() => {
			job = new Job(agenda, { name: 'demo', type: 'normal' });
		});

		test('sets the priority to a number', () => {
			job.priority(10);
			expect(job.attrs.priority).toBe(10);
		});

		test('returns the job', () => {
			expect(job.priority(50)).toBe(job);
		});

		test('parses written priorities', () => {
			job.priority('high');
			expect(job.attrs.priority).toBe(10);
		});
	});

	describe('computeNextRunAt', () => {
		let job: Job;

		beforeEach(() => {
			job = new Job(agenda, { name: 'demo', type: 'normal' });
		});

		test('returns the job', () => {
			const jobProto = Object.getPrototypeOf(job);
			expect(jobProto.computeNextRunAt.call(job)).toBe(job);
		});

		test('sets to undefined if no repeat at', () => {
			job.attrs.repeatAt = undefined;
			const jobProto = Object.getPrototypeOf(job);
			jobProto.computeNextRunAt.call(job);
			expect(job.attrs.nextRunAt).toBe(null);
		});

		test('it understands repeatAt times', () => {
			const d = new Date();
			d.setHours(23);
			d.setMinutes(59);
			d.setSeconds(0);
			job.attrs.repeatAt = '11:59pm';
			const jobProto = Object.getPrototypeOf(job);
			jobProto.computeNextRunAt.call(job);
			expect(job.attrs.nextRunAt?.getHours()).toBe(d.getHours());
			expect(job.attrs.nextRunAt?.getMinutes()).toBe(d.getMinutes());
		});

		test('sets to undefined if no repeat interval', () => {
			job.attrs.repeatInterval = undefined;
			const jobProto = Object.getPrototypeOf(job);
			jobProto.computeNextRunAt.call(job);
			expect(job.attrs.nextRunAt).toBe(null);
		});

		test('it understands human intervals', () => {
			const now = new Date();
			job.attrs.lastRunAt = now;
			job.repeatEvery('2 minutes');
			const jobProto = Object.getPrototypeOf(job);
			jobProto.computeNextRunAt.call(job);
			expect(job.attrs.nextRunAt?.getTime()).toBe(now.valueOf() + 120000);
		});

		test('understands cron intervals', () => {
			const now = new Date();
			now.setMinutes(1);
			now.setMilliseconds(0);
			now.setSeconds(0);
			job.attrs.lastRunAt = now;
			job.repeatEvery('*/2 * * * *');
			const jobProto = Object.getPrototypeOf(job);
			jobProto.computeNextRunAt.call(job);
			expect(job.attrs.nextRunAt?.valueOf()).toBe(now.valueOf() + 60000);
		});

		test('understands cron intervals with a timezone', () => {
			const date = new Date('2015-01-01T06:01:00-00:00');
			job.attrs.lastRunAt = date;
			job.repeatEvery('0 6 * * *', {
				timezone: 'GMT'
			});
			const jobProto = Object.getPrototypeOf(job);
			jobProto.computeNextRunAt.call(job);
			expect(DateTime.fromJSDate(job.attrs.nextRunAt!).setZone('GMT').hour).toBe(6);
			expect(DateTime.fromJSDate(job.attrs.nextRunAt!).toJSDate().getDate()).toBe(
				DateTime.fromJSDate(job.attrs.lastRunAt!).plus({ days: 1 }).toJSDate().getDate()
			);
		});

		test('understands cron intervals with a vienna timezone with higher hours', () => {
			const date = new Date('2015-01-01T06:01:00-00:00');
			job.attrs.lastRunAt = date;
			job.repeatEvery('0 16 * * *', {
				timezone: 'Europe/Vienna'
			});
			const jobProto = Object.getPrototypeOf(job);
			jobProto.computeNextRunAt.call(job);
			expect(DateTime.fromJSDate(job.attrs.nextRunAt!).setZone('GMT').hour).toBe(15);
			expect(DateTime.fromJSDate(job.attrs.nextRunAt!).toJSDate().getDate()).toBe(
				DateTime.fromJSDate(job.attrs.lastRunAt!).toJSDate().getDate()
			);
		});

		test('understands cron intervals with a timezone when last run is the same as the interval', () => {
			const date = new Date('2015-01-01T06:00:00-00:00');
			job.attrs.lastRunAt = date;
			job.repeatEvery('0 6 * * *', {
				timezone: 'GMT'
			});
			const jobProto = Object.getPrototypeOf(job);
			jobProto.computeNextRunAt.call(job);
			expect(DateTime.fromJSDate(job.attrs.nextRunAt!).setZone('GMT').hour).toBe(6);
			expect(DateTime.fromJSDate(job.attrs.nextRunAt!).toJSDate().getDate()).toBe(
				DateTime.fromJSDate(job.attrs.lastRunAt!).plus({ days: 1 }).toJSDate().getDate()
			);
		});

		test('gives the correct nextDate when the lastRun is 1ms before the expected time', () => {
			// (Issue #858): lastRunAt being 1ms before the nextRunAt makes cronTime return the same nextRunAt
			const last = new Date();
			last.setSeconds(59);
			last.setMilliseconds(999);
			const next = new Date(last.valueOf() + 1);
			const expectedDate = new Date(next.valueOf() + 60000);
			job.attrs.lastRunAt = last;
			job.attrs.nextRunAt = next;
			job.repeatEvery('* * * * *', {
				timezone: 'GMT'
			});
			const jobProto = Object.getPrototypeOf(job);
			jobProto.computeNextRunAt.call(job);
			expect(job.attrs.nextRunAt.valueOf()).toBe(expectedDate.valueOf());
		});

		test('cron job with month starting at 1', async () => {
			job.repeatEvery('0 0 * 1 *', {
				timezone: 'GMT'
			});
			if (job.attrs.nextRunAt) {
				expect(job.attrs.nextRunAt.getMonth()).toBe(0);
			} else {
				fail();
			}
		});

		test('repeating job with cron', async () => {
			job.repeatEvery('0 0 * 1 *', {
				timezone: 'GMT'
			});
			expect(job.attrs.nextRunAt).not.toEqual(null);
		});

		describe('when repeat at time is invalid', () => {
			beforeEach(() => {
				job.attrs.repeatAt = 'foo';
				const jobProto = Object.getPrototypeOf(job);
				jobProto.computeNextRunAt.call(job);
			});

			test('sets nextRunAt to null', () => {
				expect(job.attrs.nextRunAt).toBe(null);
			});

			test('fails the job', () => {
				expect(job.attrs.failReason).toBe(
					'failed to calculate repeatAt time due to invalid format'
				);
			});
		});

		describe('when repeat interval is invalid', () => {
			beforeEach(() => {
				job.attrs.repeatInterval = 'asd';
				const jobProto = Object.getPrototypeOf(job);
				jobProto.computeNextRunAt.call(job);
			});

			test('sets nextRunAt to null', () => {
				expect(job.attrs.nextRunAt).toBe(null);
			});

			test('fails the job', () => {
				expect(job.attrs.failReason).toBe(
					'failed to calculate nextRunAt due to invalid repeat interval (asd): Error: Validation error, cannot resolve alias "asd"'
				);
			});
		});
	});

	describe('remove', () => {
		test('removes the job', async () => {
			const job = new Job(agenda, {
				name: 'removed job',
				type: 'normal'
			});
			await job.save();

			const resultSaved = await adapter.getJobs({
				id: job.attrs.id!
			});

			expect(resultSaved).toHaveLength(1);
			await job.remove();

			const resultDeleted = await adapter.getJobs({
				id: job.attrs.id!
			});

			expect(resultDeleted).toHaveLength(0);
		});
	});

	describe('run', () => {
		beforeEach(async () => {
			agenda.define('testRun', (_job, done) => {
				setTimeout(() => {
					done();
				}, 100);
			});
		});

		test('updates lastRunAt', async () => {
			const job = new Job(agenda, { name: 'testRun', type: 'normal' });
			await job.save();
			const now = new Date();
			await delay(5);
			await job.run();

			expect(job.attrs.lastRunAt?.valueOf()).toBeGreaterThan(now.valueOf());
		});

		test('fails if job is undefined', async () => {
			const job = new Job(agenda, { name: 'not defined', type: 'normal' });
			await job.save();

			await job.run().catch(error => {
				expect(error.message).toBe('Undefined job');
			});
			expect(job.attrs.failedAt).toBeDefined();
			expect(job.attrs.failReason).toBe('Undefined job');
		});

		test('updates nextRunAt', async () => {
			const job = new Job(agenda, { name: 'testRun', type: 'normal' });
			await job.save();

			const now = new Date();
			job.repeatEvery('10 minutes');
			await delay(5);
			await job.run();
			expect(job.attrs.nextRunAt?.valueOf()).toBeGreaterThan(now.valueOf() + 59999);
		});

		test('handles errors', async () => {
			const job = new Job(agenda, { name: 'failBoat', type: 'normal' });
			await job.save();

			agenda.define('failBoat', () => {
				throw new Error('Zomg fail');
			});
			await job.run();
			expect(job.attrs.failReason).toBe('Zomg fail');
		});

		test('handles errors with q promises', async () => {
			const job = new Job(agenda, { name: 'failBoat2', type: 'normal' });
			await job.save();

			agenda.define('failBoat2', async (_job, cb) => {
				try {
					throw new Error('Zomg fail');
				} catch (err: any) {
					cb(err);
				}
			});
			await job.run();
			expect(job.attrs.failReason).toBeDefined();
		});

		test('allows async functions', async () => {
			const job = new Job(agenda, { name: 'async', type: 'normal' });
			await job.save();

			const successSpy = sinon.stub();
			let finished = false;

			agenda.once('success:async', successSpy);

			agenda.define('async', async () => {
				await delay(5);
				finished = true;
			});

			expect(finished).toBe(false);
			await job.run();
			expect(successSpy.callCount).toBe(1);
			expect(finished).toBe(true);
		});

		test('handles errors from async functions', async () => {
			const job = new Job(agenda, { name: 'asyncFail', type: 'normal' });
			await job.save();

			const failSpy = sinon.stub();
			const err = new Error('failure');

			agenda.once('fail:asyncFail', failSpy);

			agenda.define('asyncFail', async () => {
				await delay(5);
				throw err;
			});

			await job.run();
			expect(failSpy.callCount).toBe(1);
			expect(failSpy.calledWith(err)).toBe(true);
		});

		test('waits for the callback to be called even if the function is async', async () => {
			const job = new Job(agenda, { name: 'asyncCb', type: 'normal' });
			await job.save();

			const successSpy = sinon.stub();
			let finishedCb = false;

			agenda.once('success:asyncCb', successSpy);

			agenda.define('asyncCb', async (_job, cb) => {
				(async () => {
					await delay(5);
					finishedCb = true;
					cb();
				})();
			});

			await job.run();
			expect(finishedCb).toBe(true);
			expect(successSpy.callCount).toBe(1);
		});

		test("uses the callback error if the function is async and didn't reject", async () => {
			const job = new Job(agenda, { name: 'asyncCbError', type: 'normal' });
			await job.save();

			const failSpy = sinon.stub();
			const err = new Error('failure');

			agenda.once('fail:asyncCbError', failSpy);

			agenda.define('asyncCbError', async (_job, cb) => {
				(async () => {
					await delay(5);
					cb(err);
				})();
			});

			await job.run();
			expect(failSpy.callCount).toBe(1);
			expect(failSpy.calledWith(err)).toBe(true);
		});

		test('favors the async function error over the callback error if it comes first', async () => {
			const job = new Job(agenda, { name: 'asyncCbTwoError', type: 'normal' });
			await job.save();

			const failSpy = sinon.stub();
			const fnErr = new Error('functionFailure');
			const cbErr = new Error('callbackFailure');

			agenda.on('fail:asyncCbTwoError', failSpy);

			agenda.define('asyncCbTwoError', async (_job, cb) => {
				(async () => {
					await delay(5);
					cb(cbErr);
				})();

				throw fnErr;
			});

			await job.run();
			expect(failSpy.callCount).toBe(1);
			expect(failSpy.calledWith(fnErr)).toBe(true);
			expect(failSpy.calledWith(cbErr)).toBe(false);
		});

		test('favors the callback error over the async function error if it comes first', async () => {
			const job = new Job(agenda, { name: 'asyncCbTwoErrorCb', type: 'normal' });
			await job.save();

			const failSpy = sinon.stub();
			const fnErr = new Error('functionFailure');
			const cbErr = new Error('callbackFailure');

			agenda.on('fail:asyncCbTwoErrorCb', failSpy);

			agenda.define('asyncCbTwoErrorCb', async (_job, cb) => {
				cb(cbErr);
				await delay(5);
				throw fnErr;
			});

			await job.run();
			expect(failSpy.callCount).toBe(1);
			expect(failSpy.calledWith(cbErr)).toBe(true);
			expect(failSpy.calledWith(fnErr)).toBe(false);
		});

		test("doesn't allow a stale job to be saved", async () => {
			const job = new Job(agenda, { name: 'failBoat3', type: 'normal' });
			await job.save();

			agenda.define('failBoat3', async (_job, cb) => {
				// Explicitly find the job again,
				// so we have a new job object
				const jobs = await agenda.jobs({ name: 'failBoat3' });
				expect(jobs).toHaveLength(1);
				await jobs[0].remove();
				cb();
			});

			await job.run();

			// Expect the deleted job to not exist in the database
			const deletedJob = await agenda.jobs({ name: 'failBoat3' });
			expect(deletedJob).toHaveLength(0);
		});
	});

	describe('touch', () => {
		test('extends the lock lifetime', async () => {
			const lockedAt = new Date();
			const job = new Job(agenda, { name: 'some job', type: 'normal', lockedAt });
			await job.save();
			await delay(2);
			await job.touch();
			expect(job.attrs.lockedAt!.valueOf()).toBeGreaterThan(lockedAt.valueOf());
		});
	});

	describe('fail', () => {
		const job = new Job(agenda, { name: 'demo', type: 'normal' });
		test('takes a string', () => {
			job.fail('test');
			expect(job.attrs.failReason).toBe('test');
		});
		test('takes an error object', () => {
			job.fail(new Error('test'));
			expect(job.attrs.failReason).toBe('test');
		});
		test('sets the failedAt time', () => {
			job.fail('test');
			expect(job.attrs.failedAt).toBeInstanceOf(Date);
		});
		test('sets the failedAt time equal to lastFinishedAt time', () => {
			job.fail('test');
			expect(job.attrs.failedAt).toBe(job.attrs.lastFinishedAt);
		});
	});

	describe('enable', () => {
		test('sets disabled to false on the job', () => {
			const job = new Job(agenda, { name: 'test', type: 'normal', disabled: true });
			job.enable();
			expect(job.attrs.disabled).toBe(false);
		});

		test('returns the job', () => {
			const job = new Job(agenda, { name: 'test', type: 'normal', disabled: true });
			expect(job.enable()).toBe(job);
		});
	});

	describe('disable', () => {
		test('sets disabled to true on the job', () => {
			const job = new Job(agenda, { name: 'demo', type: 'normal' });
			job.disable();
			expect(job.attrs.disabled).toBe(true);
		});
		test('returns the job', () => {
			const job = new Job(agenda, { name: 'demo', type: 'normal' });
			expect(job.disable()).toBe(job);
		});
	});

	describe('save', () => {
		/** this is undocumented, and therefore we remvoe it
		test('calls saveJob on the agenda', done => {
			const oldSaveJob = agenda.saveJob;
			agenda.saveJob = () => {
				agenda.saveJob = oldSaveJob;
				done();
			};

			const job = agenda.create('some job', {
				wee: 1
			});
			job.save();
		}); */

		test('doesnt save the job if its been removed', async () => {
			const job = agenda.create('another job');
			// Save, then remove, then try and save again.
			// The second save should fail.
			const j = await job.save();
			await j.remove();
			await j.save();

			const jobs = await agenda.jobs({ name: 'another job' });
			expect(jobs).toHaveLength(0);
		});

		test('returns the job', async () => {
			const job = agenda.create('some job', {
				wee: 1
			});
			expect(await job.save()).toBe(job);
		});
	});

	describe('start/stop', () => {
		test('starts/stops the job queue', async () => {
			const processed = new Promise(resolve => {
				agenda.define('jobQueueTest', async _job => {
					resolve('processed');
				});
			});
			await agenda.every('1 second', 'jobQueueTest');
			agenda.processEvery('1 second');
			await agenda.start();

			expect(
				await Promise.race([
					processed,
					new Promise(resolve => {
						setTimeout(() => resolve(`not processed`), 1100);
					})
				])
			).toBe('processed');

			await agenda.stop();
			const processedStopped = new Promise<void>(resolve => {
				agenda.define('jobQueueTest', async _job => {
					resolve();
				});
			});

			expect(
				await Promise.race([
					processedStopped,
					new Promise(resolve => {
						setTimeout(() => resolve(`not processed`), 1100);
					})
				])
			).toBe('not processed');
		});

		test('does not run disabled jobs', async () => {
			let ran = false;
			agenda.define('disabledJob', () => {
				ran = true;
			});

			const job = await agenda.create('disabledJob').disable().schedule('now');
			await job.save();
			await agenda.start();
			await delay(jobTimeout);

			expect(ran).toBe(false);

			await agenda.stop();
		});

		test('does not throw an error trying to process undefined jobs', async () => {
			await agenda.start();
			const job = agenda.create('jobDefinedOnAnotherServer').schedule('now');

			await job.save();

			await delay(jobTimeout);
			await agenda.stop();
		});

		test('clears locks on stop', async () => {
			agenda.define('longRunningJob', (_job, _cb) => {
				// eslint-disable-line no-unused-vars
				// Job never finishes
			});
			agenda.every('10 seconds', 'longRunningJob');
			agenda.processEvery('1 second');

			await agenda.start();
			await delay(jobTimeout);
			const jobStarted = await agenda.db.getJobs({ name: 'longRunningJob' });
			expect(jobStarted[0].lockedAt).not.toBe(null);
			await agenda.stop();
			const job = await agenda.db.getJobs({ name: 'longRunningJob' });
			expect(job[0].lockedAt).toBeUndefined();
		});

		describe('events', () => {
			beforeEach(() => {
				agenda.define('jobQueueTest', (_job, cb) => {
					cb();
				});
				agenda.define('failBoat', () => {
					throw new Error('Zomg fail');
				});
			});

			test('emits start event', async () => {
				const spy = sinon.spy();
				const job = new Job(agenda, { name: 'jobQueueTest', type: 'normal' });
				await job.save();
				agenda.once('start', spy);

				await job.run();
				expect(spy.called).toBe(true);
				expect(spy.calledWithExactly(job)).toBe(true);
			});

			test('emits start:job name event', async () => {
				const spy = sinon.spy();
				const job = new Job(agenda, { name: 'jobQueueTest', type: 'normal' });
				await job.save();
				agenda.once('start:jobQueueTest', spy);

				await job.run();
				expect(spy.called).toBe(true);
				expect(spy.calledWithExactly(job)).toBe(true);
			});

			test('emits complete event', async () => {
				const spy = sinon.spy();
				const job = new Job(agenda, { name: 'jobQueueTest', type: 'normal' });
				await job.save();
				agenda.once('complete', spy);

				await job.run();
				expect(spy.called).toBe(true);
				expect(spy.calledWithExactly(job)).toBe(true);
			});

			test('emits complete:job name event', async () => {
				const spy = sinon.spy();
				const job = new Job(agenda, { name: 'jobQueueTest', type: 'normal' });
				await job.save();
				agenda.once('complete:jobQueueTest', spy);

				await job.run();
				expect(spy.called).toBe(true);
				expect(spy.calledWithExactly(job)).toBe(true);
			});

			test('emits success event', async () => {
				const spy = sinon.spy();
				const job = new Job(agenda, { name: 'jobQueueTest', type: 'normal' });
				await job.save();
				agenda.once('success', spy);

				await job.run();
				expect(spy.called).toBe(true);
				expect(spy.calledWithExactly(job)).toBe(true);
			});

			test('emits success:job name event', async () => {
				const spy = sinon.spy();
				const job = new Job(agenda, { name: 'jobQueueTest', type: 'normal' });
				await job.save();
				agenda.once('success:jobQueueTest', spy);

				await job.run();
				expect(spy.called).toBe(true);
				expect(spy.calledWithExactly(job)).toBe(true);
			});

			test('emits fail event', async () => {
				const spy = sinon.spy();
				const job = new Job(agenda, { name: 'failBoat', type: 'normal' });
				await job.save();
				agenda.once('fail', spy);

				await job.run().catch(error => {
					expect(error.message).toBe('Zomg fail');
				});

				expect(spy.called).toBe(true);

				const err = spy.args[0][0];
				expect(err.message).toBe('Zomg fail');
				expect(job.attrs.failCount).toBe(1);
				expect(job.attrs.failedAt!.valueOf()).not.toBeLessThan(job.attrs.lastFinishedAt!.valueOf());
			});

			test('emits fail:job name event', async () => {
				const spy = sinon.spy();
				const job = new Job(agenda, { name: 'failBoat', type: 'normal' });
				await job.save();
				agenda.once('fail:failBoat', spy);

				await job.run().catch(error => {
					expect(error.message).toBe('Zomg fail');
				});

				expect(spy.called).toBe(true);

				const err = spy.args[0][0];
				expect(err.message).toBe('Zomg fail');
				expect(job.attrs.failCount).toBe(1);
				expect(job.attrs.failedAt!.valueOf()).not.toBeLessThan(job.attrs.lastFinishedAt!.valueOf());
			});
		});
	});

	describe('job lock', () => {
		test('runs a recurring job after a lock has expired', async () => {
			const processorPromise = new Promise(resolve => {
				let startCounter = 0;
				agenda.define(
					'lock job',
					async () => {
						startCounter++;

						if (startCounter !== 1) {
							await agenda.stop();
							resolve(startCounter);
						}
					},
					{
						lockLifetime: 50
					}
				);
			});

			expect(agenda.definitions['lock job'].lockLifetime).toBe(50);

			agenda.defaultConcurrency(100);
			agenda.processEvery(10);
			agenda.every('0.02 seconds', 'lock job');
			await agenda.stop();
			await agenda.start();
			expect(await processorPromise).toBe(2);
		});

		test('runs a one-time job after its lock expires', async () => {
			const processorPromise = new Promise(resolve => {
				let runCount = 0;

				agenda.define(
					'lock job',
					async _job => {
						runCount++;
						if (runCount === 1) {
							// this should time out
							await new Promise(longResolve => {
								setTimeout(longResolve, 1000);
							});
						} else {
							await new Promise(longResolve => {
								setTimeout(longResolve, 10);
							});
							resolve(runCount);
						}
					},
					{
						lockLifetime: 50,
						concurrency: 1
					}
				);
			});

			let errorHasBeenThrown: any;
			agenda.on('error', err => {
				errorHasBeenThrown = err;
			});
			agenda.processEvery(25);
			await agenda.start();
			agenda.now('lock job', {
				i: 1
			});
			expect(await processorPromise).toBe(2);
			expect(errorHasBeenThrown?.message).contain("execution of 'lock job' canceled");
		});

		test('does not process locked jobs', async () => {
			const history: any[] = [];

			agenda.define(
				'lock job',
				(job, cb) => {
					history.push(job.attrs.data.i);

					setTimeout(() => {
						cb();
					}, 150);
				},
				{
					lockLifetime: 300
				}
			);

			agenda.processEvery(100);
			await agenda.start();

			await Promise.all([
				agenda.now('lock job', { i: 1 }),
				agenda.now('lock job', { i: 2 }),
				agenda.now('lock job', { i: 3 })
			]);

			await delay(500);
			expect(history).toHaveLength(3);
			expect(history).toEqual(expect.arrayContaining([1]));
			expect(history).toEqual(expect.arrayContaining([2]));
			expect(history).toEqual(expect.arrayContaining([3]));
		});

		test('does not on-the-fly lock more than agenda._lockLimit jobs', async () => {
			agenda.lockLimit(1);

			agenda.define('lock job', (_job, _cb) => {
				/* this job nevers finishes */
			}); // eslint-disable-line no-unused-vars

			await agenda.start();

			await Promise.all([agenda.now('lock job', { i: 1 }), agenda.now('lock job', { i: 2 })]);

			// give it some time to get picked up
			await delay(200);

			expect((await agenda.getRunningStats()).lockedJobs).toBe(1);
		});

		test('does not on-the-fly lock more mixed jobs than agenda._lockLimit jobs', async () => {
			agenda.lockLimit(1);

			agenda.define('lock job', (_job, _cb) => {}); // eslint-disable-line no-unused-vars
			agenda.define('lock job2', (_job, _cb) => {}); // eslint-disable-line no-unused-vars
			agenda.define('lock job3', (_job, _cb) => {}); // eslint-disable-line no-unused-vars
			agenda.define('lock job4', (_job, _cb) => {}); // eslint-disable-line no-unused-vars
			agenda.define('lock job5', (_job, _cb) => {}); // eslint-disable-line no-unused-vars

			await agenda.start();

			await Promise.all([
				agenda.now('lock job', { i: 1 }),
				agenda.now('lock job5', { i: 2 }),
				agenda.now('lock job4', { i: 3 }),
				agenda.now('lock job3', { i: 4 }),
				agenda.now('lock job2', { i: 5 })
			]);

			await delay(500);
			expect((await agenda.getRunningStats()).lockedJobs).toBe(1);
			await agenda.stop();
		});

		test('does not on-the-fly lock more than definition.lockLimit jobs', async () => {
			agenda.define('lock job', (_job, _cb) => {}, { lockLimit: 1 }); // eslint-disable-line no-unused-vars

			await agenda.start();

			await Promise.all([agenda.now('lock job', { i: 1 }), agenda.now('lock job', { i: 2 })]);

			await delay(500);
			expect((await agenda.getRunningStats()).lockedJobs).toBe(1);
		});

		test('does not lock more than agenda._lockLimit jobs during processing interval', async () => {
			agenda.lockLimit(1);
			agenda.processEvery(200);

			agenda.define('lock job', (_job, _cb) => {}); // eslint-disable-line no-unused-vars

			await agenda.start();

			const when = DateTime.local().plus({ milliseconds: 300 }).toJSDate();

			await Promise.all([
				agenda.schedule(when, 'lock job', { i: 1 }),
				agenda.schedule(when, 'lock job', { i: 2 })
			]);

			await delay(500);
			expect((await agenda.getRunningStats()).lockedJobs).toBe(1);
		});

		test('does not lock more than definition.lockLimit jobs during processing interval', async () => {
			agenda.processEvery(200);

			agenda.define('lock job', (_job, _cb) => {}, { lockLimit: 1 }); // eslint-disable-line no-unused-vars

			await agenda.start();

			const when = DateTime.local().plus({ milliseconds: 300 }).toJSDate();

			await Promise.all([
				agenda.schedule(when, 'lock job', { i: 1 }),
				agenda.schedule(when, 'lock job', { i: 2 })
			]);

			await delay(500);
			expect((await agenda.getRunningStats()).lockedJobs).toBe(1);
			await agenda.stop();
		});
	});

	// describe('job concurrency', () => {
	// 	test('should not block a job for concurrency of another job', async () => {
	// 		agenda.processEvery(50);

	// 		const processed: number[] = [];
	// 		const now = Date.now();

	// 		agenda.define(
	// 			'blocking',
	// 			(job, cb) => {
	// 				processed.push(job.attrs.data.i);
	// 				setTimeout(cb, 400);
	// 			},
	// 			{
	// 				concurrency: 1
	// 			}
	// 		);

	// 		const checkResultsPromise = new Promise<number[]>(resolve => {
	// 			agenda.define(
	// 				'non-blocking',
	// 				job => {
	// 					processed.push(job.attrs.data.i);
	// 					resolve(processed);
	// 				},
	// 				{
	// 					// Lower priority to keep it at the back in the queue
	// 					priority: 'lowest'
	// 				}
	// 			);
	// 		});

	// 		let finished = false;
	// 		agenda.on('complete', () => {
	// 			if (!finished && processed.length === 3) {
	// 				finished = true;
	// 			}
	// 		});

	// 		agenda.start();

	// 		await Promise.all([
	// 			agenda.schedule(new Date(now + 100), 'blocking', { i: 1 }),
	// 			agenda.schedule(new Date(now + 101), 'blocking', { i: 2 }),
	// 			agenda.schedule(new Date(now + 102), 'non-blocking', { i: 3 })
	// 		]);

	// 		try {
	// 			const results: number[] = await Promise.race([
	// 				checkResultsPromise,
	// 				// eslint-disable-next-line prefer-promise-reject-errors
	// 				new Promise<number[]>((_, reject) => {
	// 					setTimeout(() => {
	// 						reject(`not processed`);
	// 					}, 2000);
	// 				})
	// 			]);
	// 			expect(results).toEqual(expect.not.arrayContaining([2]));
	// 		} catch (err) {
	// 			console.log('stats', err, JSON.stringify(await agenda.getRunningStats(), undefined, 3));
	// 			throw err;
	// 		}
	// 	});

	// 	test('should run jobs as first in first out (FIFO)', async () => {
	// 		agenda.processEvery(100);
	// 		agenda.define('fifo', (_job, cb) => cb(), { concurrency: 1 });

	// 		const checkResultsPromise = new Promise<number[]>(resolve => {
	// 			const results: number[] = [];

	// 			agenda.on('start:fifo', job => {
	// 				results.push(new Date(job.attrs.nextRunAt!).getTime());
	// 				if (results.length !== 3) {
	// 					return;
	// 				}

	// 				resolve(results);
	// 			});
	// 		});

	// 		await agenda.start();

	// 		await agenda.now('fifo');
	// 		await delay(50);
	// 		await agenda.now('fifo');
	// 		await delay(50);
	// 		await agenda.now('fifo');
	// 		await delay(50);
	// 		try {
	// 			const results: number[] = await Promise.race([
	// 				checkResultsPromise,
	// 				// eslint-disable-next-line prefer-promise-reject-errors
	// 				new Promise<number[]>((_, reject) => {
	// 					setTimeout(() => {
	// 						reject(`not processed`);
	// 					}, 2000);
	// 				})
	// 			]);
	// 			expect(results.join('')).toEqual(results.sort().join(''));
	// 		} catch (err) {
	// 			console.log('stats', err, JSON.stringify(await agenda.getRunningStats(), undefined, 3));
	// 			throw err;
	// 		}
	// 	});

	// 	test('should run jobs as first in first out (FIFO) with respect to priority', async () => {
	// 		const now = Date.now();

	// 		agenda.define('fifo-priority', (_job, cb) => setTimeout(cb, 100), { concurrency: 1 });

	// 		const checkResultsPromise = new Promise(resolve => {
	// 			const times: number[] = [];
	// 			const priorities: number[] = [];

	// 			agenda.on('start:fifo-priority', job => {
	// 				priorities.push(job.attrs.priority);
	// 				times.push(new Date(job.attrs.lastRunAt!).getTime());
	// 				if (priorities.length !== 3 || times.length !== 3) {
	// 					return;
	// 				}

	// 				resolve({ times, priorities });
	// 			});
	// 		});

	// 		await Promise.all([
	// 			agenda.create('fifo-priority', { i: 1 }).schedule(new Date(now)).priority('high').save(),
	// 			agenda
	// 				.create('fifo-priority', { i: 2 })
	// 				.schedule(new Date(now + 100))
	// 				.priority('low')
	// 				.save(),
	// 			agenda
	// 				.create('fifo-priority', { i: 3 })
	// 				.schedule(new Date(now + 100))
	// 				.priority('high')
	// 				.save()
	// 		]);
	// 		await agenda.start();
	// 		try {
	// 			const { times, priorities } = await Promise.race<any>([
	// 				checkResultsPromise,
	// 				// eslint-disable-next-line prefer-promise-reject-errors
	// 				new Promise<any>((_, reject) => {
	// 					setTimeout(() => {
	// 						reject(`not processed`);
	// 					}, 2000);
	// 				})
	// 			]);

	// 			expect(times.join('')).toEqual(times.sort().join(''));
	// 			expect(priorities).toEqual([10, 10, -10]);
	// 		} catch (err) {
	// 			console.log('stats', err, JSON.stringify(await agenda.getRunningStats(), undefined, 3));
	// 			throw err;
	// 		}
	// 	});

	// 	test('should run higher priority jobs first', async () => {
	// 		// Inspired by tests added by @lushc here:
	// 		// <https://github.com/agenda/agenda/pull/451/commits/336ff6445803606a6dc468a6f26c637145790adc>
	// 		const now = new Date();

	// 		agenda.define('priority', (_job, cb) => setTimeout(cb, 10), { concurrency: 1 });

	// 		const checkResultsPromise = new Promise(resolve => {
	// 			const results: number[] = [];

	// 			agenda.on('start:priority', job => {
	// 				results.push(job.attrs.priority);
	// 				if (results.length !== 3) {
	// 					return;
	// 				}

	// 				resolve(results);
	// 			});
	// 		});

	// 		await Promise.all([
	// 			agenda.create('priority').schedule(now).save(),
	// 			agenda.create('priority').schedule(now).priority('low').save(),
	// 			agenda.create('priority').schedule(now).priority('high').save()
	// 		]);
	// 		await agenda.start();
	// 		try {
	// 			const results = await Promise.race([
	// 				checkResultsPromise,
	// 				// eslint-disable-next-line prefer-promise-reject-errors
	// 				new Promise((_, reject) => {
	// 					setTimeout(() => {
	// 						reject(`not processed`);
	// 					}, 2000);
	// 				})
	// 			]);
	// 			expect(results).toEqual([10, 0, -10]);
	// 		} catch (err) {
	// 			console.log('stats', JSON.stringify(await agenda.getRunningStats(), undefined, 3));
	// 			throw err;
	// 		}
	// 	});
	// });

	// describe('every running', () => {
	// 	beforeEach(async () => {
	// 		agenda.defaultConcurrency(1);
	// 		agenda.processEvery(5);

	// 		await agenda.stop();
	// 	});

	// 	test('should run the same job multiple times', async () => {
	// 		let counter = 0;

	// 		agenda.define('everyRunTest1', (_job, cb) => {
	// 			if (counter < 2) {
	// 				counter++;
	// 			}

	// 			cb();
	// 		});

	// 		await agenda.every(10, 'everyRunTest1');

	// 		await agenda.start();

	// 		await agenda.jobs({ name: 'everyRunTest1' });
	// 		await delay(jobTimeout);
	// 		expect(counter).toBe(2);

	// 		await agenda.stop();
	// 	});

	// 	test('should reuse the same job on multiple runs', async () => {
	// 		let counter = 0;

	// 		agenda.define('everyRunTest2', (_job, cb) => {
	// 			if (counter < 2) {
	// 				counter++;
	// 			}

	// 			cb();
	// 		});
	// 		await agenda.every(10, 'everyRunTest2');

	// 		await agenda.start();

	// 		await delay(jobTimeout);
	// 		const result = await agenda.jobs({ name: 'everyRunTest2' });

	// 		expect(result).toHaveLength(1);
	// 		await agenda.stop();
	// 	});
	// });

	// describe('Integration Tests', () => {
	// 	describe('.every()', () => {
	// 		test('Should not rerun completed jobs after restart', () =>
	// 			new Promise<void>((done, reject) => {
	// 				let i = 0;

	// 				const serviceError = function (e: any) {
	// 					done(e);
	// 				};

	// 				const receiveMessage = function (msg: any) {
	// 					if (msg === 'ran') {
	// 						expect(i).toBe(0);
	// 						i += 1;
	// 						// eslint-disable-next-line @typescript-eslint/no-use-before-define
	// 						startService();
	// 					} else if (msg === 'notRan') {
	// 						expect(i).toBe(1);
	// 						done();
	// 					} else {
	// 						reject(new Error('Unexpected response returned!'));
	// 					}
	// 				};

	// 				const startService = () => {
	// 					const serverPath = path.join(__dirname, 'fixtures', 'agenda-instance.ts');
	// 					const n = cp.fork(serverPath, [mongoCfg, 'daily'], {
	// 						execArgv: ['-r', 'ts-node/register']
	// 					});

	// 					n.on('message', receiveMessage);
	// 					n.on('error', serviceError);
	// 				};

	// 				startService();
	// 			}));

	// 		test('Should properly run jobs when defined via an array', () =>
	// 			new Promise<void>((done, reject) => {
	// 				{
	// 					const serverPath = path.join(__dirname, 'fixtures', 'agenda-instance.ts');
	// 					const n = cp.fork(serverPath, [mongoCfg, 'daily-array'], {
	// 						execArgv: ['-r', 'ts-node/register']
	// 					});

	// 					let ran1 = false;
	// 					let ran2 = false;
	// 					let doneCalled = false;

	// 					const serviceError = function (e: any) {
	// 						done(e);
	// 					};

	// 					const receiveMessage = function (msg: any) {
	// 						if (msg === 'test1-ran') {
	// 							ran1 = true;
	// 							if (ran1 && ran2 && !doneCalled) {
	// 								doneCalled = true;
	// 								done();
	// 								n.send('exit');
	// 							}
	// 						} else if (msg === 'test2-ran') {
	// 							ran2 = true;
	// 							if (ran1 && ran2 && !doneCalled) {
	// 								doneCalled = true;
	// 								done();
	// 								n.send('exit');
	// 							}
	// 						} else if (!doneCalled) {
	// 							reject(new Error('Jobs did not run!'));
	// 						}
	// 					};

	// 					n.on('message', receiveMessage);
	// 					n.on('error', serviceError);
	// 				}
	// 			}));

	// 		test('should not run if job is disabled', async () => {
	// 			let counter = 0;

	// 			agenda.define('everyDisabledTest', (_job, cb) => {
	// 				counter++;
	// 				cb();
	// 			});

	// 			const job = await agenda.every(10, 'everyDisabledTest');

	// 			job.disable();

	// 			await job.save();
	// 			await agenda.start();

	// 			await delay(jobTimeout);
	// 			await agenda.jobs({ name: 'everyDisabledTest' });
	// 			expect(counter).toBe(0);
	// 			await agenda.stop();
	// 		});
	// 	});

	// 	describe('schedule()', () => {
	// 		test('Should not run jobs scheduled in the future', () =>
	// 			new Promise<void>((done, reject) => {
	// 				let i = 0;

	// 				const serviceError = function (e: any) {
	// 					done(e);
	// 				};

	// 				const receiveMessage = function (msg: any) {
	// 					if (msg === 'notRan') {
	// 						if (i < 5) {
	// 							done();
	// 							return;
	// 						}

	// 						i += 1;
	// 						// eslint-disable-next-line @typescript-eslint/no-use-before-define
	// 						startService();
	// 					} else {
	// 						reject(new Error('Job scheduled in future was ran!'));
	// 					}
	// 				};

	// 				const startService = () => {
	// 					const serverPath = path.join(__dirname, 'fixtures', 'agenda-instance.ts');
	// 					const n = cp.fork(serverPath, [mongoCfg, 'define-future-job'], {
	// 						execArgv: ['-r', 'ts-node/register']
	// 					});

	// 					n.on('message', receiveMessage);
	// 					n.on('error', serviceError);
	// 				};

	// 				startService();
	// 			}));

	// 		test('Should run past due jobs when process starts', () =>
	// 			new Promise<void>((done, reject) => {
	// 				const serviceError = function (e: any) {
	// 					done(e);
	// 				};

	// 				const receiveMessage = function (msg: any) {
	// 					if (msg === 'ran') {
	// 						done();
	// 					} else {
	// 						reject(new Error('Past due job did not run!'));
	// 					}
	// 				};

	// 				const startService = () => {
	// 					const serverPath = path.join(__dirname, 'fixtures', 'agenda-instance.ts');
	// 					const n = cp.fork(serverPath, [mongoCfg, 'define-past-due-job'], {
	// 						execArgv: ['-r', 'ts-node/register']
	// 					});

	// 					n.on('message', receiveMessage);
	// 					n.on('error', serviceError);
	// 				};

	// 				startService();
	// 			}));

	// 		test('Should schedule using array of names', () =>
	// 			new Promise<void>((done, reject) => {
	// 				const serverPath = path.join(__dirname, 'fixtures', 'agenda-instance.ts');
	// 				const n = cp.fork(serverPath, [mongoCfg, 'schedule-array'], {
	// 					execArgv: ['-r', 'ts-node/register']
	// 				});

	// 				let ran1 = false;
	// 				let ran2 = false;
	// 				let doneCalled = false;

	// 				const serviceError = (err: any) => {
	// 					done(err);
	// 				};

	// 				const receiveMessage = (msg: any) => {
	// 					if (msg === 'test1-ran') {
	// 						ran1 = true;
	// 						if (ran1 && ran2 && !doneCalled) {
	// 							doneCalled = true;
	// 							done();
	// 							n.send('exit');
	// 						}
	// 					} else if (msg === 'test2-ran') {
	// 						ran2 = true;
	// 						if (ran1 && ran2 && !doneCalled) {
	// 							doneCalled = true;
	// 							done();
	// 							n.send('exit');
	// 						}
	// 					} else if (!doneCalled) {
	// 						reject(new Error('Jobs did not run!'));
	// 					}
	// 				};

	// 				n.on('message', receiveMessage);
	// 				n.on('error', serviceError);
	// 			}));
	// 	});

	// 	describe('now()', () => {
	// 		test('Should immediately run the job', () =>
	// 			new Promise<void>((done, reject) => {
	// 				const serviceError = function (e: any) {
	// 					done(e);
	// 				};

	// 				const receiveMessage = function (msg: any) {
	// 					if (msg === 'ran') {
	// 						return done();
	// 					}

	// 					return reject(new Error('Job did not immediately run!'));
	// 				};

	// 				const serverPath = path.join(__dirname, 'fixtures', 'agenda-instance.ts');
	// 				const n = cp.fork(serverPath, [mongoCfg, 'now'], {
	// 					execArgv: ['-r', 'ts-node/register']
	// 				});

	// 				n.on('message', receiveMessage);
	// 				n.on('error', serviceError);
	// 			}));
	// 	});

	// 	describe('General Integration', () => {
	// 		test('Should not run a job that has already been run', async () => {
	// 			const runCount: any = {};

	// 			agenda.define('test-job', (job, cb) => {
	// 				const id = job.attrs.id!.toString();

	// 				runCount[id] = runCount[id] ? runCount[id] + 1 : 1;
	// 				cb();
	// 			});

	// 			agenda.processEvery(100);
	// 			await agenda.start();

	// 			await Promise.all([...new Array(10)].map(() => agenda.now('test-job')));

	// 			await delay(jobTimeout);
	// 			const ids = Object.keys(runCount);
	// 			expect(ids).toHaveLength(10);
	// 			Object.keys(runCount).forEach(id => {
	// 				expect(runCount[id]).toBe(1);
	// 			});
	// 		});
	// 	});
	// });

	// test('checks database for running job on "client"', async () => {
	// 	agenda.define('test', async () => {
	// 		await new Promise(resolve => {
	// 			setTimeout(resolve, 30000);
	// 		});
	// 	});

	// 	const job = await agenda.now('test');
	// 	await agenda.start();

	// 	await new Promise(resolve => {
	// 		agenda.on('start:test', resolve);
	// 	});

	// 	expect(await job.isRunning()).toBe(true);
	// });

	// test('should not run job if is has been removed', async () => {
	// 	let executed = false;
	// 	agenda.define('test', async () => {
	// 		executed = true;
	// 	});

	// 	const job = new Job(agenda, {
	// 		name: 'test',
	// 		type: 'normal'
	// 	});
	// 	job.schedule('in 1 second');
	// 	await job.save();

	// 	await agenda.start();

	// 	let jobStarted;
	// 	let retried = 0;
	// 	// wait till it's locked (Picked up by the event processor)
	// 	do {
	// 		jobStarted = await agenda.db.getJobs({ name: 'test' });
	// 		if (!jobStarted[0].lockedAt) {
	// 			delay(100);
	// 		}
	// 		retried++;
	// 	} while (!jobStarted[0].lockedAt || retried > 10);

	// 	expect(jobStarted[0].lockedAt).toBeDefined(); // .equal(null);

	// 	await job.remove();

	// 	let error: Error | undefined;
	// 	const completed = new Promise<void>(resolve => {
	// 		agenda.on('error', err => {
	// 			error = err;
	// 			resolve();
	// 		});
	// 	});

	// 	await Promise.race([
	// 		new Promise<void>(resolve => {
	// 			setTimeout(() => {
	// 				resolve();
	// 			}, 1000);
	// 		}),
	// 		completed
	// 	]);

	// 	expect(executed).toBe(false);
	// 	assert.ok(typeof error !== 'undefined');
	// 	expect(error.message).toEqual(
	// 		expect.arrayContaining(['(name: test) cannot be updated in the database'])
	// 	);
	// });

	// describe('job fork mode', () => {
	// 	test('runs a job in fork mode', async () => {
	// 		const agendaFork = new Agenda({
	// 			adapter,
	// 			forkHelper: {
	// 				path: './test/helpers/forkHelper.ts',
	// 				options: {
	// 					env: { DB_CONNECTION: mongoCfg },
	// 					execArgv: ['-r', 'ts-node/register']
	// 				}
	// 			}
	// 		});

	// 		expect(agendaFork.forkHelper?.path).toBe('./test/helpers/forkHelper.ts');

	// 		const job = agendaFork.create('some job');
	// 		job.forkMode(true);
	// 		job.schedule('now');
	// 		await job.save();

	// 		const jobData = await agenda.db.getJobById(job.attrs.id as any);

	// 		if (!jobData) {
	// 			throw new Error('job not found');
	// 		}

	// 		expect(jobData.fork).toBe(true);

	// 		// initialize job definition (keep in a seperate file to have a easier fork mode implementation)
	// 		someJobDefinition(agendaFork);

	// 		await agendaFork.start();

	// 		do {
	// 			// console.log('.');
	// 			await delay(50);
	// 		} while (await job.isRunning());

	// 		const jobDataFinished = await agenda.db.getJobById(job.attrs.id as any);
	// 		expect(jobDataFinished?.lastFinishedAt).toBeDefined();
	// 		expect(jobDataFinished?.failReason).toBe(null);
	// 		expect(jobDataFinished?.failCount).toBe(null);
	// 	});

	// 	test('runs a job in fork mode, but let it fail', async () => {
	// 		const agendaFork = new Agenda({
	// 			adapter,
	// 			forkHelper: {
	// 				path: './test/helpers/forkHelper.ts',
	// 				options: {
	// 					env: { DB_CONNECTION: mongoCfg },
	// 					execArgv: ['-r', 'ts-node/register']
	// 				}
	// 			}
	// 		});

	// 		expect(agendaFork.forkHelper?.path).toBe('./test/helpers/forkHelper.ts');

	// 		const job = agendaFork.create('some job', { failIt: 'error' });
	// 		job.forkMode(true);
	// 		job.schedule('now');
	// 		await job.save();

	// 		const jobData = await agenda.db.getJobById(job.attrs.id as any);

	// 		if (!jobData) {
	// 			throw new Error('job not found');
	// 		}

	// 		expect(jobData.fork).toBe(true);

	// 		// initialize job definition (keep in a seperate file to have a easier fork mode implementation)
	// 		someJobDefinition(agendaFork);

	// 		await agendaFork.start();

	// 		do {
	// 			// console.log('.');
	// 			await delay(50);
	// 		} while (await job.isRunning());

	// 		const jobDataFinished = await agenda.db.getJobById(job.attrs.id as any);
	// 		expect(jobDataFinished?.lastFinishedAt).toBeDefined();
	// 		expect(jobDataFinished?.failReason).not.toBe(null);
	// 		expect(jobDataFinished?.failCount).toBe(1);
	// 	});

	// 	test('runs a job in fork mode, but let it die', async () => {
	// 		const agendaFork = new Agenda({
	// 			adapter,
	// 			forkHelper: {
	// 				path: './test/helpers/forkHelper.ts',
	// 				options: {
	// 					env: { DB_CONNECTION: mongoCfg },
	// 					execArgv: ['-r', 'ts-node/register']
	// 				}
	// 			}
	// 		});

	// 		expect(agendaFork.forkHelper?.path).toBe('./test/helpers/forkHelper.ts');

	// 		const job = agendaFork.create('some job', { failIt: 'die' });
	// 		job.forkMode(true);
	// 		job.schedule('now');
	// 		await job.save();

	// 		const jobData = await agenda.db.getJobById(job.attrs.id as any);

	// 		if (!jobData) {
	// 			throw new Error('job not found');
	// 		}

	// 		expect(jobData.fork).toBe(true);

	// 		// initialize job definition (keep in a seperate file to have a easier fork mode implementation)
	// 		someJobDefinition(agendaFork);

	// 		await agendaFork.start();

	// 		do {
	// 			// console.log('.');
	// 			await delay(50);
	// 		} while (await job.isRunning());

	// 		const jobDataFinished = await agenda.db.getJobById(job.attrs.id as any);
	// 		expect(jobDataFinished?.lastFinishedAt).toBeDefined();
	// 		expect(jobDataFinished?.failReason).not.toBe(null);
	// 		expect(jobDataFinished?.failCount).toBe(1);
	// 	});
	// });
});
