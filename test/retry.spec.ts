import { Agenda, Job, type AgendaDBAdapter } from '@agenda/agenda';
import { AgendaMemoryAdapter } from '@agenda/memory-adapter';
import delay from 'delay';
import { afterEach, beforeEach, describe, it } from 'vitest';

// agenda instances
let agenda: Agenda;
// mongo db connection db instance
let adapter: AgendaDBAdapter;

const clearJobs = async (): Promise<void> => {
	if (adapter) {
		await adapter.removeJobs({});
	}
};

const jobType = 'do work';
const jobProcessor = () => {};

describe('Retry', () => {
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
	});

	it('should retry a job', async () => {
		let shouldFail = true;

		agenda.processEvery(100); // Shave 5s off test runtime :grin:
		agenda.define('a job', (_job, done) => {
			if (shouldFail) {
				shouldFail = false;
				return done(new Error('test failure'));
			}

			done();
			return undefined;
		});

		agenda.on('fail:a job', (err: any, job: Job) => {
			if (err) {
				// Do nothing as this is expected to fail.
			}

			job.schedule('now').save();
		});

		const successPromise = new Promise(resolve => {
			agenda.on('success:a job', resolve);
		});

		await agenda.now('a job');

		await agenda.start();
		await successPromise;
	});
});
