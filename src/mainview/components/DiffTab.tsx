import { useEffect, useState } from "react";
import { type Comparison, type FileChange, sameFileChange } from "../../shared/file-changes";
import type { Repository, Worktree } from "../../shared/model";
import { NEXT_FILE, PREVIOUS_FILE, describeSteppedTo, filterFiles, listedOrder } from "../changes-format";
import { reviewButtonLabel, takesFileStepKey } from "../changes-panel-format";
import { useAppState, useStore } from "../store/react";
import { changesPanelShown, fileViewed } from "../store/state";
import type { AppStore } from "../store/store";
import { FOLDER_MISSING_CHANGES } from "./ChangesList";
import { DiffView } from "./DiffView";
import { toggleSidePanel } from "./SidePanel";

/** Whether a key goes to a field that edits text, where Alt+Up and Alt+Down move the cursor. */
const inTextField = (target: EventTarget | null) =>
	target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=\"false\"]), .cm-editor") !== null;

/** What a screen reader is told once a step opened `opened`: where the keyboard went, among the files the list shows. */
function describeOpened(store: AppStore, opened: FileChange | null): string {
	const state = store.getState();
	const view = state.changes;
	if (opened === null || !view?.files) return "";
	const order = filterFiles(listedOrder(view.files), state.changeFilters[view.worktree] ?? "");
	return describeSteppedTo(opened, order.findIndex(file => sameFileChange(file, opened)) + 1, order.length);
}

/** Open the previous or next file, and answer what a screen reader is told. */
async function step(store: AppStore, by: 1 | -1): Promise<string> {
	return describeOpened(store, await store.stepChangedFile(by));
}

/** Tick or untick Viewed, and answer what a screen reader is told: that, and the file it opened. */
async function toggle(store: AppStore, file: FileChange): Promise<string> {
	const opened = await store.toggleViewed(file);
	if (opened !== null) return `Viewed. ${describeOpened(store, opened)}`;
	const view = store.getState().changes;
	return view !== null && fileViewed(store.getState(), view.worktree, view.compared, file) ? "Viewed" : "Not viewed";
}

/** Alt+Up and Alt+Down open the previous and next file while the diff tab shows (see `takesFileStepKey`). It draws nothing. */
function FileStepShortcut({ onStep }: { onStep: (by: 1 | -1) => void }) {
	const store = useStore();
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const by = takesFileStepKey(event, store.getState(), inTextField(event.target));
			if (by === null) return;
			event.preventDefault();
			onStep(by);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [store, onStep]);
	return null;
}

function StepIcon({ up }: { up: boolean }) {
	return (
		<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d={up ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
		</svg>
	);
}

/** The diff tab's Viewed box: ticking it marks the file and opens the next one. */
function ViewedBox({ worktree, file, compared, onToggle }: { worktree: string; file: FileChange; compared: Comparison | null; onToggle: () => void }) {
	const state = useAppState();
	const viewed = fileViewed(state, worktree, compared, file);
	return (
		<label className="diff-viewed" title={viewed ? "Viewed. Untick when you want to read it again." : "Mark this file viewed and open the next one"}>
			<input type="checkbox" checked={viewed} onChange={onToggle} />
			Viewed
		</label>
	);
}

/**
 * A worktree's diff tab: the diff of the changed file chosen in the side
 * panel's Changes view, as the File tab shows a file. While the Changes
 * view is not on screen and the worktree has review notes, its title line
 * has a Review button with their count, which shows the Changes view. Its
 * title line also has the previous and next file buttons, Alt+Up and
 * Alt+Down, and the Viewed box.
 */
export function DiffTab({ repository, worktree }: { repository: Repository; worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const [stepped, setStepped] = useState("");
	const [onStep] = useState(() => (by: 1 | -1) => void step(store, by).then(setStepped));
	const tab = state.diffs[worktree.id];
	const view = state.changes?.worktree === worktree.id ? state.changes : null;
	const notes = state.reviews[worktree.id]?.length ?? 0;

	if (!worktree.pathExists) {
		return (
			<div className="empty">
				<p className="empty-title">No changes to show</p>
				<p className="empty-text">{FOLDER_MISSING_CHANGES}</p>
			</div>
		);
	}
	const file = tab && view?.files?.find(candidate => sameFileChange(candidate, tab.file));
	if (!view || !file) {
		if (view?.problem != null) {
			return (
				<div className="sidebar-error diff-problem" role="alert">
					<p className="sidebar-error-title">Could not read the changes</p>
					<p className="sidebar-error-text">{view.problem}</p>
				</div>
			);
		}
		return <p className="diff-reading" role="status">Reading the diff</p>;
	}
	const review = notes > 0 && !changesPanelShown(state)
		? (
			<button type="button" className="button quiet review-toggle" aria-label={reviewButtonLabel(notes)} title="Show the review in the Changes view" onClick={() => void toggleSidePanel(store, "changes")}>
				Review
				<span className="change-group-count" aria-hidden="true">{notes}</span>
			</button>
		)
		: null;
	const several = filterFiles(view.files ?? [], state.changeFilters[worktree.id] ?? "").length > 1;
	const steps = (
		<span className="diff-steps">
			<button type="button" className="icon-button" aria-label={PREVIOUS_FILE} title={`${PREVIOUS_FILE} (Alt+Up)`} aria-keyshortcuts="Alt+ArrowUp" disabled={!several} onClick={() => onStep(-1)}>
				<StepIcon up />
			</button>
			<button type="button" className="icon-button" aria-label={NEXT_FILE} title={`${NEXT_FILE} (Alt+Down)`} aria-keyshortcuts="Alt+ArrowDown" disabled={!several} onClick={() => onStep(1)}>
				<StepIcon up={false} />
			</button>
		</span>
	);
	return (
		<>
			<FileStepShortcut onStep={onStep} />
			<span className="visually-hidden" role="status">{stepped}</span>
			<DiffView
				repository={repository.path}
				worktree={worktree}
				view={view}
				file={file}
				layout="unified"
				steps={steps}
				review={review}
				viewed={<ViewedBox worktree={worktree.id} file={file} compared={view.compared} onToggle={() => void toggle(store, file).then(setStepped)} />}
				onClose={() => store.closeDiff(worktree.id)}
			/>
		</>
	);
}
