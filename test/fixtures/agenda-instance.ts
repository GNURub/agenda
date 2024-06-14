import { Agenda } from '@agenda/agenda';
import { AgendaMongoAdapter } from '@agenda/mongodb-adapter';
import addTests from './add-tests';

const connStr = process.argv[2];
const tests = process.argv.slice(3);

const adapter = new AgendaMongoAdapter({
	db: {
		address: connStr
	}
});

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
