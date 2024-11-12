import { Agenda } from '@agenda/agenda';
import { AgendaMemoryAdapter } from '@agenda/memory-adapter';
import addTests from './add-tests';

const tests = process.argv.slice(2);

const adapter = new AgendaMemoryAdapter();

const agenda = new Agenda(
	{
		adapter,
		processEvery: 100
	},
	async () => {
		tests.forEach((test: any) => {
			addTests[test as keyof typeof addTests](agenda);
		});

		await agenda.start();

		// Ensure we can shut down the process from tests
		process.on('message', msg => {
			if (msg === 'exit') {
				process.exit(0);
			}
		});

		// Send default message of "notRan" after 400ms
		setTimeout(() => {
			process.send!('notRan');
			// eslint-disable-next-line unicorn/no-process-exit
			process.exit(0);
		}, 400);
	}
);
