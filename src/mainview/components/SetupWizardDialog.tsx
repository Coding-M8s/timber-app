import { type SubmitEvent, useEffect, useId, useRef, useState } from "react";
import type { Repository } from "../../shared/model";
import { type Integration, type TimberConfigScope, REPOSITORY_CONFIG_FILE, shownApplyArguments } from "../../shared/timber-config";
import { describeTimberCommand } from "../../shared/timber-result";
import { WIZARD_STEPS, WIZARD_STEP_TITLES, type WizardStep, describeChoices, describeScope, firstStepOf, wizardSaveRequest } from "../setup-wizard-format";
import { useStore } from "../store/react";
import { type GroupDrafts, type TimberGroup, DRAWN_PATHS, TIMBER_GROUP_TITLES, credentialsToCheck, draftsOf, groupMessages, valuesWith } from "../timber-settings-format";
import { type CheckOutcome, type GroupOutcome, GitFields, LauncherFields, SaveOutcomeNotes, ScriptsFields, TrackingFields, useTimberRead } from "./settings/TimberSections";
import { TimberFailureDetails } from "./TimberFailureDetails";

const IDLE: GroupOutcome = { state: "idle" };
/** How long the last step shows before Save acts, so a double click on Next cannot save unseen. */
const SAVE_DELAY_MILLISECONDS = 500;
const ALL_DRAWN = Object.values(DRAWN_PATHS).flat();

/**
 * "Set up Timber" for a repository new to Timber: the choices of `timber
 * setup`, one step at a time, saved once at the end through Timber's
 * settings commands, as Settings > Repository saves them. The last step
 * shows the exact command before it runs. Cancel, Escape, or closing saves
 * nothing, and the setup prompt stays. Once Timber saved, the store has
 * read the repositories again, so the prompt is gone when the wizard closes.
 *
 * The settings go to the repository's `.timber.toml`, or, as `timber setup
 * --global` offers, to the machine defaults. Each scope is read through
 * Timber when chosen, and what was typed carries over between them.
 */
export function SetupWizardDialog({ repository }: { repository: Repository }) {
	const store = useStore();
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const stepTitleId = useId();
	const trackedId = useId();
	const [scope, setScope] = useState<TimberConfigScope>("repository");
	const [step, setStep] = useState<WizardStep>("scope");
	const [edited, setEdited] = useState<Partial<GroupDrafts>>({});
	const [outcome, setOutcome] = useState<GroupOutcome>(IDLE);
	const [checks, setChecks] = useState<Partial<Record<Integration, CheckOutcome>>>({});
	const [editTracked, setEditTracked] = useState(false);
	// A ref, not the state: a second Enter or an Escape can arrive before the next render.
	const saving = useRef(false);
	// When the shown step last changed. A second click of a double click, or a held Enter, that walked
	// onto the last step must not save before the command there could be seen.
	const stepShownAt = useRef(0);
	const stepTitle = useRef<HTMLParagraphElement>(null);
	const firstRender = useRef(true);

	const [read, readAgain] = useTimberRead({ scope, repository: scope === "repository" ? repository.path : null }, scope);
	const [machineRead] = useTimberRead(scope === "repository" ? { scope: "machine", repository: null } : null, scope);

	// Opened as a modal, so the rest of the window is inert and focus stays inside.
	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		return () => element?.close();
	}, []);

	// Each step takes the focus on its title, so Enter held on Next stops there, and a screen reader hears the step.
	useEffect(() => {
		stepShownAt.current = performance.now();
		if (firstRender.current) {
			firstRender.current = false;
			return;
		}
		stepTitle.current?.focus();
	}, [step]);

	const close = () => {
		if (!saving.current) store.closeDialog();
	};

	const result = read.result;
	const settings = result?.outcome === "read" ? result.settings : null;
	const machine = scope === "repository" && machineRead.result?.outcome === "read" ? machineRead.result.settings.values : null;
	const drafts: GroupDrafts | null = settings === null ? null : { ...draftsOf(settings.values), ...edited };
	const busy = outcome.state === "saving";
	const index = WIZARD_STEPS.indexOf(step);
	const messages = outcome.state === "invalid" ? outcome.fields : [];
	const needsTracked = settings !== null && settings.tracked && !editTracked;

	const change = <Group extends TimberGroup>(group: Group, draft: GroupDrafts[Group]) => {
		setEdited(previous => ({ ...previous, [group]: draft }));
		// Typing puts a past outcome away, except Timber's field messages and a conflict, which still need answering.
		if (outcome.state !== "invalid" && outcome.state !== "conflict" && outcome.state !== "saving") setOutcome(IDLE);
		if (group === "tracking") setChecks({});
	};

	const chooseScope = (next: TimberConfigScope) => {
		if (next === scope) return;
		setScope(next);
		setOutcome(IDLE);
		setChecks({});
		setEditTracked(false);
	};

	const save = async () => {
		if (saving.current || settings === null || drafts === null || needsTracked) return;
		saving.current = true;
		setOutcome({ state: "saving" });
		try {
			const answer = await store.saveTimberSettings(wizardSaveRequest(scope, repository.path, settings, drafts, editTracked));
			if (answer.outcome === "saved") {
				saving.current = false;
				store.closeDialog();
				return;
			}
			if (answer.outcome === "invalid") {
				setOutcome({ state: "invalid", fields: answer.invalidFields, failure: answer.failure });
				setStep(firstStepOf(answer.invalidFields));
			} else {
				setOutcome({ state: answer.outcome, failure: answer.failure });
			}
		} finally {
			saving.current = false;
		}
	};

	const check = async (integration: Integration) => {
		if (settings === null || drafts === null) return;
		setChecks(previous => ({ ...previous, [integration]: { state: "checking" } }));
		const credentials = credentialsToCheck(drafts.tracking, integration);
		const answer = await store.checkTimberConnection({
			scope,
			repository: scope === "repository" ? repository.path : null,
			integration,
			values: valuesWith("tracking", drafts.tracking, settings.values),
			...(credentials === undefined ? {} : { credentials }),
		});
		setChecks(previous => ({ ...previous, [integration]: { state: "done", result: answer } }));
	};

	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy || settings === null) return;
		if (step !== "review") setStep(WIZARD_STEPS[index + 1]!);
		else if (performance.now() - stepShownAt.current >= SAVE_DELAY_MILLISECONDS) void save();
	};

	const groupProps = <Group extends TimberGroup>(group: Group) => ({
		draft: drafts![group],
		onChange: (draft: GroupDrafts[Group]) => change(group, draft),
		scope,
		machine,
		messages,
	});

	const scopeChoice = (
		<fieldset className="settings-choice">
			<legend className="field-label">Save these settings for</legend>
			{(["repository", "machine"] as const).map(candidate => (
				<label key={candidate} className="check">
					<input type="radio" name={`${titleId}-scope`} value={candidate} checked={scope === candidate} onChange={() => chooseScope(candidate)} />
					<span className="check-text">
						{describeScope(candidate, repository.name)}
						<span className="check-hint">
							{candidate === "repository"
								? `In ${REPOSITORY_CONFIG_FILE} in its primary checkout. The machine defaults fill in what it leaves alone.`
								: "As machine defaults, as timber setup --global saves them. A repository's own settings take their place."}
						</span>
					</span>
				</label>
			))}
		</fieldset>
	);

	let body;
	if (result === null) {
		body = <p className="settings-section-text" role="status">Reading</p>;
	} else if (result.outcome === "failed") {
		body = (
			<>
				{/* The other scope stays a choice, so a file Timber cannot read does not hold the wizard on it. */}
				{step === "scope" && scopeChoice}
				<TimberFailureDetails title="Could not read these settings" failure={result.failure} />
				<p className="dialog-note">Nothing can be set up here until Timber can read them. A file Timber cannot read is fixed in an editor.</p>
				<div><button type="button" className="button quiet" disabled={read.reading} onClick={() => void readAgain()}>{read.reading ? "Reading" : "Read again"}</button></div>
			</>
		);
	} else if (step === "scope") {
		body = (
			<>
				<p className="settings-section-text">
					Everything works with Timber's defaults. These steps set your editor, coding assistant, starting branch, setup scripts, and issue tracking.
					Each one can be left as it is. Nothing is saved until the last step.
				</p>
				{scopeChoice}
				<p className="settings-section-text">
					{settings!.exists ? <>Changes <span className="mono">{settings!.path}</span>.</> : <>Creates <span className="mono">{settings!.path}</span>.</>}
				</p>
			</>
		);
	} else if (step === "review") {
		const rest = groupMessages(messages, ALL_DRAWN).rest;
		body = (
			<>
				<dl className="wizard-summary">
					<dt>{WIZARD_STEP_TITLES.scope}</dt>
					<dd>{describeScope(scope, repository.name)}</dd>
					{describeChoices(drafts!, scope).map(choice => [
						<dt key={`${choice.group}-title`}>{TIMBER_GROUP_TITLES[choice.group]}</dt>,
						<dd key={`${choice.group}-text`}>{choice.text}</dd>,
					])}
				</dl>
				{settings!.tracked && (
					<div className="sidebar-error info" role="status">
						<p className="sidebar-error-title">Git tracks this {REPOSITORY_CONFIG_FILE}</p>
						<p className="sidebar-error-text">
							Saving changes the file in the working tree, so the change shows in Git status for everyone's next commit. The index is left alone.
						</p>
						<label className="check">
							<input id={trackedId} type="checkbox" checked={editTracked} onChange={event => setEditTracked(event.target.checked)} />
							<span className="check-text">Change the tracked file</span>
						</label>
					</div>
				)}
				<SaveOutcomeNotes outcome={outcome} rest={rest} onReadAgain={() => void readAgain().then(() => setOutcome(IDLE))} marked="The fields it named are marked in their steps." />
			</>
		);
	} else {
		body = (
			<>
				{step === "editor" && <LauncherFields kind="editor" {...groupProps("editor")} />}
				{step === "agent" && <LauncherFields kind="agent" {...groupProps("agent")} />}
				{step === "git" && <GitFields {...groupProps("git")} />}
				{step === "scripts" && <ScriptsFields {...groupProps("scripts")} />}
				{step === "tracking" && <TrackingFields {...groupProps("tracking")} credentials={settings!.credentials} checks={checks} onCheck={integration => void check(integration)} busy={busy} />}
			</>
		);
	}

	const ready = settings !== null;
	return (
		<dialog
			ref={dialog}
			className="dialog setup-wizard"
			aria-labelledby={titleId}
			onCancel={event => {
				// Escape asks to close, through the store, and never while the save runs.
				event.preventDefault();
				close();
			}}
		>
			<form className="dialog-form" aria-busy={busy} aria-describedby={stepTitleId} onSubmit={submit}>
				<header className="dialog-head">
					<h2 id={titleId} className="dialog-title">Set up Timber for {repository.name}</h2>
				</header>
				<p id={stepTitleId} ref={stepTitle} tabIndex={-1} className="wizard-step" aria-live="polite">
					Step {index + 1} of {WIZARD_STEPS.length}: {WIZARD_STEP_TITLES[step]}
				</p>
				<fieldset className="dialog-fields" disabled={busy}>{body}</fieldset>
				{busy && (
					<div className="dialog-progress">
						<div className="progress" role="progressbar" aria-label="Saving" />
						<p className="dialog-progress-text" role="status">Saving</p>
					</div>
				)}
				<footer className="dialog-foot">
					{step === "review" && (
						<pre className="dialog-command" aria-label="Command that will run">{describeTimberCommand(shownApplyArguments(scope, settings?.tracked === true && editTracked))}</pre>
					)}
					{step === "review" && needsTracked && <p className="dialog-note">Tick "Change the tracked file" above to save.</p>}
					<div className="dialog-buttons">
						<button type="button" className="button quiet" disabled={busy} onClick={close}>Cancel</button>
						<button type="button" className="button quiet" disabled={busy || index === 0} onClick={() => setStep(WIZARD_STEPS[index - 1]!)}>Back</button>
						<button type="submit" className="button primary" disabled={busy || !ready || (step === "review" && needsTracked)}>
							{step === "review" ? (busy ? "Saving" : "Save") : "Next"}
						</button>
					</div>
				</footer>
			</form>
		</dialog>
	);
}
