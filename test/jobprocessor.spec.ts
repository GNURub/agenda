/* eslint-disable no-console */
import { fail } from 'node:assert';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Agenda, type AgendaDBAdapter } from '@agenda/agenda';
import { AgendaMemoryAdapter } from '@agenda/memory-adapter';

// Create agenda instances
let agenda: Agenda;
// mongo db connection db instance
let adapter: AgendaDBAdapter;

const clearJobs = async (): Promise<void> => {
	if (adapter) {
		await adapter.removeJobs({});
	}
};

describe('JobProcessor', () => {
	beforeEach(async () => {
		if (!adapter) {
			adapter = new AgendaMemoryAdapter();
		}

		return new Promise(resolve => {
			agenda = new Agenda(
				{
					adapter,
					maxConcurrency: 4,
					defaultConcurrency: 1,
					lockLimit: 15,
					defaultLockLimit: 6,
					processEvery: '1 second',
					name: 'agendaTest'
				},
				async () => {
					await clearJobs();
					return resolve();
				}
			);
		});
	});

	afterEach(async () => {
		await agenda.stop();
		await clearJobs();
	});

	describe('getRunningStats', () => {
		it('throws an error when agenda is not running', async () => {
			try {
				await agenda.getRunningStats();
				fail();
			} catch (err: any) {
				expect(err.message).toBe('agenda not running!');
			}
		});

		it('contains the agendaVersion', async () => {
			await agenda.start();

			const status = await agenda.getRunningStats();
			expect(status).toHaveProperty('version');
			expect(status.version).toMatch(/\d+.\d+.\d+/);
		});

		it('shows the correct job status', async () => {
			agenda.define('test', async () => {
				await new Promise(resolve => {
					setTimeout(resolve, 30000);
				});
			});

			agenda.now('test');
			await agenda.start();

			await new Promise(resolve => {
				agenda.on('start:test', resolve);
			});

			const status = await agenda.getRunningStats();
			expect(status).toHaveProperty('jobStatus');
			if (status.jobStatus) {
				expect(status.jobStatus).toHaveProperty('test');
				expect(status.jobStatus.test.locked).toBe(1);
				expect(status.jobStatus.test.running).toBe(1);
				expect(status.jobStatus.test.config.fn).toBeInstanceOf(Function);
				expect(status.jobStatus.test.config.concurrency).toBe(1);
				expect(status.jobStatus.test.config.lockLifetime).toBe(600000);
				expect(status.jobStatus.test.config.priority).toBe(0);
				expect(status.jobStatus.test.config.lockLimit).toBe(6);
			}
		});

		it('shows isLockingOnTheFly', async () => {
			await agenda.start();

			const status = await agenda.getRunningStats();
			expect(status).toHaveProperty('isLockingOnTheFly');
			expect(status.isLockingOnTheFly).toBeTypeOf('boolean');
			expect(status.isLockingOnTheFly).toBe(false);
		});

		it('shows queueName', async () => {
			await agenda.start();

			const status = await agenda.getRunningStats();
			expect(status).toHaveProperty('queueName');
			expect(typeof status.queueName).toBe('string');
			expect(status.queueName).toBe('agendaTest');
		});

		it('shows totalQueueSizeDB', async () => {
			await agenda.start();

			const status = await agenda.getRunningStats();
			expect(status).toHaveProperty('totalQueueSizeDB');
			expect(status.totalQueueSizeDB).toBeTypeOf('number');
			expect(status.totalQueueSizeDB).toBe(0);
		});
	});

	it('ensure new jobs are always filling up running queue', async () => {
		let shortOneFinished = false;

		agenda.define('test long', async () => {
			await new Promise(resolve => {
				setTimeout(resolve, 1000);
			});
		});
		agenda.define('test short', async () => {
			shortOneFinished = true;
			await new Promise(resolve => {
				setTimeout(resolve, 5);
			});
		});

		await agenda.start();

		// queue up long ones
		for (let i = 0; i < 100; i += 1) {
			agenda.now('test long');
		}

		await new Promise(resolve => {
			setTimeout(resolve, 1000);
		});

		// queue more short ones (they should complete first!)
		for (let j = 0; j < 100; j += 1) {
			agenda.now('test short');
		}

		await new Promise(resolve => {
			setTimeout(resolve, 1000);
		});

		expect(shortOneFinished).toBe(true);
	});

	it('ensure slow jobs time out', async () => {
		let jobStarted = false;
		agenda.define(
			'test long',
			async () => {
				jobStarted = true;
				await new Promise(resolve => {
					setTimeout(resolve, 2500);
				});
			},
			{ lockLifetime: 500 }
		);

		// queue up long ones
		agenda.now('test long');

		await agenda.start();

		const promiseResult = await new Promise<Error | void>(resolve => {
			agenda.on('error', err => {
				resolve(err);
			});

			agenda.on('success', () => {
				resolve();
			});
		});

		expect(jobStarted).toBe(true);
		expect(promiseResult).toBeInstanceOf(Error);
	});

	it('ensure slow jobs do not time out when calling touch', async () => {
		agenda.define(
			'test long',
			async job => {
				for (let i = 0; i < 10; i += 1) {
					await new Promise(resolve => {
						setTimeout(resolve, 100);
					});
					await job.touch();
				}
			},
			{ lockLifetime: 500 }
		);

		await agenda.start();

		// queue up long ones
		agenda.now('test long');

		const promiseResult = await new Promise<Error | void>(resolve => {
			agenda.on('error', err => {
				resolve(err);
			});

			agenda.on('success', () => {
				resolve();
			});
		});

		expect(promiseResult).not.toBeInstanceOf(Error);
	});

	it('ensure concurrency is filled up', async () => {
		agenda.maxConcurrency(300);
		agenda.lockLimit(150);
		agenda.defaultLockLimit(20);
		agenda.defaultConcurrency(10);

		for (let jobI = 0; jobI < 10; jobI += 1) {
			agenda.define(
				`test job ${jobI}`,
				async () => {
					await new Promise(resolve => {
						setTimeout(resolve, 5000);
					});
				},
				{ lockLifetime: 10000 }
			);
		}

		// queue up jobs
		for (let jobI = 0; jobI < 10; jobI += 1) {
			for (let jobJ = 0; jobJ < 25; jobJ += 1) {
				agenda.now(`test job ${jobI}`);
			}
		}

		await agenda.start();

		let runningJobs = 0;
		const allJobsStarted = new Promise(async resolve => {
			do {
				runningJobs = (await agenda.getRunningStats()).runningJobs as number;
				await new Promise(wait => {
					setTimeout(wait, 50);
				});
			} while (runningJobs < 90); // @todo Why not 100?
			resolve('all started');
		});

		expect(
			await Promise.race([
				allJobsStarted,
				new Promise(resolve => {
					setTimeout(
						() => resolve(`not all jobs started, currently running: ${runningJobs}`),
						1500
					);
				})
			])
		).toBe('all started');
	});
});
