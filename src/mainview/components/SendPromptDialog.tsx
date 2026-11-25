import { useEffect, useId, useRef, useState } from "react";
import { findAgent } from "../../shared/agent";
import { defaultAgent, defaultAgentName, whyNoDefaultAgent } from "../../shared/agent-lookup";
import { findListedChop, listedChops } from "../../shared/chops";
import { runningAgents, waitsOnPerson } from "../agent-sessions";
import { PROMPT_WAITS_WARNING, describeNewAgentChoice, noNewPromptAgent } from "../chop-format";
import { repositoryPick } from "../store/state";
import { useAppState, useStore } from "../store/react";
import { AgentChoices } from "./AgentChoices";
import { estimateTerminalSize } from "./TerminalPanel";

/** The radio value of the "new agent" choice; session ids never take this form. */
const NEW_AGENT = "\0new";

/**
 * Where a prompt chop goes, asked when the worktree has several running
 * agents, or only one that waits on the person: one of them, or a new agent,
 * the chop's or the default agent, the repository's or the first saved one found. Nothing is picked at
 * first, so Send needs a choice. The prompt is shown as it is listed, or as the person
 * edited it for this run in the chop search, which is then what is sent;
 * otherwise the main process sends the text it reads, never this one.
 */
export function SendPromptDialog({ request }: { request: { repository: string; worktree: string; chop: string; text?: string } }) {
	const store = useStore();
	const state = useAppState();
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const [picked, setPicked] = useState<string | null>(null);
	const sessions = runningAgents(state.terminals, request.worktree);
	const list = state.chops?.repository === request.repository ? state.chops.list : null;
	const chop = findListedChop(listedChops(list), request.chop);
	const agents = state.preferences.agents;
	const pick = repositoryPick(state, request.repository);
	// The chop's agent, found or not, or the default agent: the repository's, or the first saved one found.
	const newAgent = chop?.agent ? findAgent(agents, chop.agent) : defaultAgent(agents, state.agentLocations, pick);
	// While the app does not know which agents are installed, a new agent can still be picked: the main process looks, and decides.
	const why = whyNoDefaultAgent(agents, state.agentLocations, pick);
	const newReason = newAgent === null && (chop?.agent || why !== "not-known") ? noNewPromptAgent(chop?.agent || null, why) : null;
	const chosen = sessions.find(session => session.id === picked) ?? null;

	// A new agent that names none is the default one: look again for which agents are installed.
	useEffect(() => {
		void store.locateAgents();
	}, [store]);

	useEffect(() => {
		const element = dialog.current;
		const opener = document.activeElement;
		if (element && !element.open) element.showModal();
		return () => {
			element?.close();
			const lost = document.activeElement === null || document.activeElement === document.body;
			if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus();
		};
	}, []);

	const send = () => {
		if (picked === null) return;
		store.closeDialog();
		const target = picked === NEW_AGENT ? { session: null } : { session: picked };
		void store.runChop(request.repository, request.worktree, request.chop, estimateTerminalSize(document.getElementById("workspace-panel")), { target, ...(request.text === undefined ? {} : { text: request.text }) });
	};

	return (
		<dialog
			ref={dialog}
			className="dialog review-dialog"
			aria-labelledby={titleId}
			onCancel={event => {
				event.preventDefault();
				store.closeDialog();
			}}
		>
			<div className="dialog-form">
				<header className="dialog-head">
					<h2 id={titleId} className="dialog-title">Send {request.chop}</h2>
				</header>
				<div className="dialog-fields">
					<AgentChoices sessions={sessions} picked={picked} onPick={setPicked} name="prompt-agent" legend="Send to" disabled={false}>
						<label className="review-agent" title={newReason ?? undefined}>
							<input type="radio" name="prompt-agent" checked={picked === NEW_AGENT} disabled={newReason !== null} onChange={() => setPicked(NEW_AGENT)} />
							<span className="review-agent-name">{describeNewAgentChoice(newAgent?.name ?? chop?.agent ?? defaultAgentName(agents, state.agentLocations, pick))}</span>
							<span className="review-agent-state">{newReason ?? "Starts it here, then sends the prompt once it is ready"}</span>
						</label>
					</AgentChoices>
					{chosen !== null && waitsOnPerson(chosen) && <p className="review-warning" role="alert">{PROMPT_WAITS_WARNING}</p>}
					{request.text !== undefined
						? <pre className="review-preview" tabIndex={0} aria-label="The prompt, as you edited it for this run">{request.text}</pre>
						: chop !== null && <pre className="review-preview" tabIndex={0} aria-label="The prompt, as listed">{chop.text}</pre>}
					<p className="dialog-note">The prompt goes as one paste, then Enter, so its line breaks do not send it early. An agent that is busy gets it as typed input.</p>
				</div>
				<footer className="dialog-foot">
					<div className="dialog-buttons">
						<button type="button" className="button quiet" onClick={() => store.closeDialog()}>Cancel</button>
						<button type="button" className="button primary" disabled={picked === null} onClick={send}>Send</button>
					</div>
				</footer>
			</div>
		</dialog>
	);
}
