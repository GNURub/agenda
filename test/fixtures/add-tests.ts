import { Agenda } from '@agenda/agenda';

/* eslint-disable unicorn/no-process-exit */
export default {
	none: (): void => {},
	daily: (agenda: Agenda) => {
		agenda.define('once a day test job', (_, done) => {
			process.send!('ran');
			done();
			process.exit(0);
		});

		agenda.every('one day', 'once a day test job');
	},
	'daily-array': (agenda: Agenda) => {
		agenda.define('daily test 1', (_, done) => {
			process.send!('test1-ran');
			done();
		});

		agenda.define('daily test 2', (_, done) => {
			process.send!('test2-ran');
			done();
		});

		agenda.every('one day', ['daily test 1', 'daily test 2']);
	},
	'define-future-job': (agenda: Agenda) => {
		const future = new Date();
		future.setDate(future.getDate() + 1);

		agenda.define('job in the future', (_, done) => {
			process.send!('ran');
			done();
			process.exit(0);
		});

		agenda.schedule(future, 'job in the future');
	},
	'define-past-due-job': (agenda: Agenda) => {
		const past = new Date();
		past.setDate(past.getDate() - 1);

		agenda.define('job in the past', (_, done) => {
			process.send!('ran');
			done();
			process.exit(0);
		});

		agenda.schedule(past, 'job in the past');
	},
	'schedule-array': (agenda: Agenda) => {
		const past = new Date();
		past.setDate(past.getDate() - 1);

		agenda.define('scheduled test 1', (_, done) => {
			process.send!('test1-ran');
			done();
		});

		agenda.define('scheduled test 2', (_, done) => {
			process.send!('test2-ran');
			done();
		});

		agenda.schedule(past, ['scheduled test 1', 'scheduled test 2']);
	},
	now(agenda: Agenda) {
		agenda.define('now run this job', (_, done) => {
			process.send!('ran');
			done();
			process.exit(0);
		});

		agenda.now('now run this job');
	}
};
/* eslint-enable unicorn/no-process-exit */
