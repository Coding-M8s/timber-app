import type { ListedChop } from "../../shared/chops";
import { describeChopApproval } from "../chop-format";
import { useStore } from "../store/react";
import { OperationDialog } from "./OperationDialog";
import { estimateTerminalSize } from "./TerminalPanel";

export interface ApproveChopViewProps {
	chop: ListedChop;
	/** The file the chop comes from, in the repository's main checkout. */
	path: string;
	onRun: () => void;
	onClose: () => void;
}

/**
 * The question before a repository chop runs for the first time, or after
 * its text changed: the exact text as the main process read it, and where it
 * comes from. Run is never the default: focus starts on Cancel, and Enter
 * does not run it.
 */
export function ApproveChopView({ chop, path, onRun, onClose }: ApproveChopViewProps) {
	const words = describeChopApproval(chop, path);
	return (
		<OperationDialog
			title={words.title}
			command={chop.text}
			submission={{ running: false, failure: null }}
			submitLabel="Run"
			runningLabel={`Starting ${chop.name}`}
			failureTitle={`${chop.name} did not start`}
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
export function ApproveChopDialog({ request }: { request: { repository: string; worktree: string; chop: ListedChop; path: string } }) {
	const store = useStore();
	return (
		<ApproveChopView
			chop={request.chop}
			path={request.path}
			onRun={() => {
				// Closed first: if the text changed meanwhile, the run asks again with a new dialog.
				store.closeDialog();
				void store.runChop(request.repository, request.worktree, request.chop.name, estimateTerminalSize(document.getElementById("workspace-panel")), request.chop.text);
			}}
			onClose={() => store.closeDialog()}
		/>
	);
}
