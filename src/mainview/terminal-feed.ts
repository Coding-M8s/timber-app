import type { TerminalOutput, TerminalSnapshot } from "../shared/terminal";

/** Text to draw, the number of the last part it holds, and whether it starts the screen afresh. */
export interface Draw {
	data: string;
	seq: number;
	reset: boolean;
}

/**
 * What to draw of one session, from its snapshot and the numbered parts that
 * arrive while and after it is read. Pure, so it is tested without a window.
 *
 * A pane asks for the snapshot and listens for parts at the same time. Parts
 * that arrive before the snapshot are held. When it comes, the parts it
 * already holds (`seq` up to the snapshot's) are dropped, and the rest follow
 * it. After that, every part is drawn once, in order. A part marked `reset`
 * replaces the screen with what it holds.
 */
export interface TerminalFeed {
	/** A part arrived. Answers what to draw now, or null while it is held or when it was drawn already. */
	receive(part: Pick<TerminalOutput, "seq" | "data" | "reset">): Draw | null;
	/** The snapshot arrived, or null for a session that is gone. Answers what to draw. */
	begin(snapshot: TerminalSnapshot | null): Draw;
}

export function createTerminalFeed(): TerminalFeed {
	let held: Pick<TerminalOutput, "seq" | "data" | "reset">[] | null = [];
	let drawn = 0;
	const take = (part: Pick<TerminalOutput, "seq" | "data" | "reset">): Draw | null => {
		if (part.seq <= drawn) return null;
		drawn = part.seq;
		return { data: part.data, seq: part.seq, reset: part.reset === true };
	};
	return {
		receive(part) {
			if (held !== null) {
				held.push(part);
				return null;
			}
			return take(part);
		},
		begin(snapshot) {
			const waiting = (held ?? []).sort((a, b) => a.seq - b.seq);
			held = null;
			drawn = snapshot?.seq ?? 0;
			let draw: Draw = { data: snapshot?.data ?? "", seq: drawn, reset: true };
			for (const part of waiting) {
				const next = take(part);
				if (!next) continue;
				draw = next.reset ? next : { data: draw.data + next.data, seq: next.seq, reset: draw.reset };
			}
			return draw;
		},
	};
}
