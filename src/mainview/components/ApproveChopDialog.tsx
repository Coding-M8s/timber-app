import type { ListedChop } from "../../shared/chops";
import { describeChopApproval } from "../chop-format";
import { useAppState, useStore } from "../store/react";
import { OperationDialog } from "./OperationDialog";
import { estimateTerminalSize } from "./TerminalPanel";

export interface ApproveChopViewProps {
	chop: ListedChop;
	/** The file the chop comes from, in the repository's main checkout. */
	path: string;
	/** For a prompt: the agent session it goes to, by name, or null for a new agent. */
	target?: string | null;
	onRun: () => void;
	onClose: () => void;
}

/**
 * The question before a repository chop runs for the first time, or after
 * its text changed: the exact text as the main process read it, and where it
 * comes from. Run is never the default: focus starts on Cancel, and Enter
 * does not run it.
 */
export function ApproveChopView({ chop, path, target = null, onRun, onClose }: ApproveChopViewProps) {
	const words = describeChopApproval(chop, path, target);
	return (
		<OperationDialog
			title={words.title}
			command={chop.text}
			submission={{ running: false, failure: null }}
			submitLabel={words.submit}
			runningLabel={chop.kind === "prompt" ? `Sending ${chop.name}` : `Starting ${chop.name}`}
			failureTitle={chop.kind === "prompt" ? `${chop.name} was not sent` : `${chop.name} did not start`}
			destructive
			onSubmit={onRun}
			onClose={onClose}
		>
			<p className="dialog-note">{words.text}</p>
			{chop.description !== "" && <p className="field-hint">{chop.description}</p>}
		</OperationDialog>
	);
}

/** The approval of one repository chop, for the worktree it was asked to run in. */
export function ApproveChopDialog({ request }: { request: { repository: string; worktree: string; chop: ListedChop; path: string; session?: string } }) {
	const store = useStore();
	const state = useAppState();
	const session = request.session === undefined ? null : state.terminals.find(candidate => candidate.id === request.session) ?? null;
	// A prompt goes where it was meant to: the agent picked before, or a new one.
	const target = request.chop.kind !== "prompt" ? undefined : { session: request.session ?? null };
	return (
		<ApproveChopView
			chop={request.chop}
			path={request.path}
			target={session?.name ?? null}
			onRun={() => {
				// Closed first: if the text changed meanwhile, the run asks again with a new dialog.
				store.closeDialog();
				void store.runChop(request.repository, request.worktree, request.chop.name, estimateTerminalSize(document.getElementById("workspace-panel")), request.chop.text, target);
			}}
			onClose={() => store.closeDialog()}
		/>
	);
}
