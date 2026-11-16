/** Run `task` after `milliseconds`. Returns a function that calls it off. */
type Schedule = (task: () => void, milliseconds: number) => () => void;

/** A clock the test moves by hand, in place of real timers. Tasks run in the order they are due. */
export function manualClock() {
	let now = 0;
	let waiting: { at: number; task: () => void }[] = [];
	const schedule: Schedule = (task, milliseconds) => {
		const entry = { at: now + milliseconds, task };
		waiting.push(entry);
		return () => {
			waiting = waiting.filter(candidate => candidate !== entry);
		};
	};
	return {
		schedule,
		now: () => now,
		waiting: () => waiting.length,
		advance(milliseconds: number) {
			const end = now + milliseconds;
			for (;;) {
				const due = waiting.filter(entry => entry.at <= end).sort((a, b) => a.at - b.at)[0];
				if (!due) break;
				waiting = waiting.filter(entry => entry !== due);
				now = due.at;
				due.task();
			}
			now = end;
		},
	};
}
