import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, readlink, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { type AgentId, agentById } from "../shared/agent-registry";
import { messageOf } from "../shared/error-message";
import {
	type HookDetails, type HookState, STATUS_HOOK_SCRIPT, type StatusHookRequest, type StatusHookResult, type StatusHookView,
	hookCommand, hookedAgent, planHook, reportedStates,
} from "../shared/status-hooks";

/** An agent's file larger than this is not read: hook files are a few kilobytes. */
const FILE_LIMIT = 1024 * 1024;

export interface StatusHookFilesDependencies {
	/** The home folder the agents read their files from. */
	home: string;
	/** Where the script the entries run is written: the app's settings folder. */
	scriptPath: string;
	/** The agent each saved row runs, in the order saved (`TerminalSessions.savedPrograms`). */
	savedPrograms: () => Promise<{ name: string; agent: AgentId | null }[]>;
	/** The operating system, as `process.platform` names it. The hook is a `sh` script, so Windows gets none yet. */
	platform?: NodeJS.Platform;
}

/**
 * Status hooks in the agents' own files (see ../shared/status-hooks.ts and
 * docs/decision-agent-status-hooks.md).
 *
 * - Only an agent a saved row runs, only its file in the home folder that the
 *   registry names, and only the app's own entries. The window names the
 *   agent, never a file.
 * - A file that is a link, cannot be written, or holds comments is never
 *   written: its entries are shown to add or take out by hand.
 * - Before writing, the file is read again and checked against what was
 *   shown (`token`, a hash of its bytes); a change since stops the write.
 *   Written to a temporary file beside it with the same mode, then renamed
 *   over it. No backup copy is kept: the file can hold secrets.
 * - Nothing of the file but the app's entries leaves this module.
 */
export interface StatusHookFiles {
	list(): Promise<StatusHookView[]>;
	install(request: StatusHookRequest): Promise<StatusHookResult>;
	remove(request: StatusHookRequest): Promise<StatusHookResult>;
}

/** What the agent's file is, read. */
interface FileRead {
	path: string;
	exists: boolean;
	text: string | null;
	token: string;
	/** Why the app does not write it, or null. */
	byHand: string | null;
	/** Why it cannot be read, or null. */
	unreadable: string | null;
	mode: number;
}

const tokenOf = (bytes: Uint8Array | null) => bytes === null ? "missing" : createHash("sha256").update(bytes).digest("hex");

export function createStatusHookFiles({ home, scriptPath, savedPrograms, platform = process.platform }: StatusHookFilesDependencies): StatusHookFiles {
	// The script is `sh`, and the agents' files on Windows are not confirmed: nothing there is offered or written.
	const supported = platform !== "win32";
	const shown = (path: string) => path === home ? "~" : path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;

	async function writable(path: string): Promise<boolean> {
		return access(path, constants.W_OK).then(() => true, () => false);
	}

	/**
	 * Why the folders between the home folder and the file are not plain
	 * folders of the home folder, or null. A folder that is a link, as stow
	 * makes for a dotfiles repository, may lead into a repository.
	 */
	async function linkedFolder(path: string): Promise<string | null> {
		const realHome = await realpath(home).catch(() => home);
		let folder = dirname(path);
		// A folder not there yet is made under the first one that is.
		while (!(await lstat(folder).then(() => true, () => false)) && dirname(folder) !== folder) folder = dirname(folder);
		if (folder === home || !folder.startsWith(home + sep)) return null;
		const real = await realpath(folder).catch(() => null);
		const expected = join(realHome, folder.slice(home.length + 1));
		if (real === expected) return null;
		return `${shown(folder)} is a link to ${real ?? "somewhere that cannot be read"}, so the app does not write in it: it may be in a repository.`;
	}

	async function readAgentFile(path: string): Promise<FileRead> {
		const linked = await linkedFolder(path);
		const base = { path, exists: false, text: null, token: "missing", byHand: linked, unreadable: null, mode: 0o644 };
		const info = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? null : error);
		if (info instanceof Error) return { ...base, exists: true, token: "unreadable", unreadable: `It cannot be read: ${messageOf(info)}.` };
		if (info === null) {
			// A new file goes in the agent's folder, made if need be, under a home folder that can be written.
			let folder = dirname(path);
			while (!(await stat(folder).then(() => true, () => false)) && dirname(folder) !== folder) folder = dirname(folder);
			return { ...base, byHand: linked ?? (await writable(folder) ? null : `${shown(folder)} cannot be written, so the app does not make the file.`) };
		}
		let byHand: string | null = linked;
		if (info.isSymbolicLink()) {
			const target = await readlink(path).catch(() => "another file");
			byHand = `${shown(path)} is a link to ${target}, so the app does not write it: it may be in a repository.`;
		}
		const real = await stat(path).catch(() => null);
		if (real === null) return { ...base, exists: true, token: "unreadable", byHand, unreadable: "It is a link that leads nowhere." };
		if (!real.isFile()) return { ...base, exists: true, token: "unreadable", byHand, unreadable: "It is not a file." };
		if (real.size > FILE_LIMIT) return { ...base, exists: true, token: "unreadable", byHand, unreadable: "It is too large to read." };
		let bytes: Uint8Array;
		try {
			bytes = await readFile(path);
		} catch (error) {
			return { ...base, exists: true, token: "unreadable", byHand, unreadable: `It cannot be read: ${messageOf(error)}.` };
		}
		if (byHand === null && !(await writable(path))) byHand = `${shown(path)} cannot be written, so the app does not change it.`;
		// The file is replaced by a rename, which needs its folder to be writable too.
		if (byHand === null && !(await writable(dirname(path)))) byHand = `${shown(dirname(path))} cannot be written, so the app does not change ${shown(path)}.`;
		return { path, exists: true, text: new TextDecoder().decode(bytes), token: tokenOf(bytes), byHand, unreadable: null, mode: real.mode & 0o777 };
	}

	/** The script as found: as the app writes it, missing, unreadable or not to be run, or something else. */
	async function scriptState(): Promise<"same" | "missing" | "unusable" | "different"> {
		try {
			if ((await readFile(scriptPath, "utf8")) !== STATUS_HOOK_SCRIPT) return "different";
			return (await stat(scriptPath)).mode & 0o100 ? "same" : "unusable";
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unusable";
		}
	}

	async function inspect(agent: AgentId): Promise<{ details: HookDetails; file: FileRead; installed: string | null; removed: string | null | undefined } | null> {
		const definition = hookedAgent(agent);
		if (definition === null) return null;
		const hook = definition.status.hook;
		const path = join(home, ...hook.file);
		const file = await readAgentFile(path);
		const plan = planHook(file.text, hook, scriptPath, agent);
		let state: HookState = file.unreadable !== null ? { kind: "broken", reason: file.unreadable } : plan.state;
		let byHand = file.byHand;
		if (byHand === null && plan.comments) byHand = `${shown(path)} holds comments, which the app would drop if it wrote the file.`;
		if (byHand === null && plan.unsafe) byHand = `${shown(path)} holds a value the app could not write back exactly.`;
		if (byHand === null && hookCommand(scriptPath, agent, "x") === null) byHand = `The app's settings folder, ${shown(dirname(scriptPath))}, has a quote in its path, which the entries cannot hold.`;
		if (state.kind === "on" || state.kind === "changed") {
			const script = await scriptState();
			if (script === "missing") state = { kind: "broken", reason: `The script its entries run, ${shown(scriptPath)}, is missing.` };
			else if (script === "unusable") state = { kind: "broken", reason: `The script its entries run, ${shown(scriptPath)}, cannot be read or run.` };
			else if (script === "different") state = { kind: "changed", reason: `The script its entries run, ${shown(scriptPath)}, is not as the app writes it.`, script: true };
		}
		return {
			details: {
				agent, agentName: definition.name, file: shown(path), exists: file.exists, state, byHand, token: file.token,
				entries: plan.entries, present: plan.present, script: STATUS_HOOK_SCRIPT, scriptPath: shown(scriptPath), checked: hook.checked,
			},
			file,
			installed: byHand === null ? plan.installed : null,
			removed: byHand === null ? plan.removed : undefined,
		};
	}

	async function list(): Promise<StatusHookView[]> {
		const rows = await savedPrograms();
		const found = new Map<AgentId, HookDetails | null>();
		const views: StatusHookView[] = [];
		for (const row of rows) {
			const definition = row.agent === null ? null : agentById(row.agent);
			if (supported && row.agent !== null && definition?.status.source === "hook" && !found.has(row.agent)) found.set(row.agent, (await inspect(row.agent))?.details ?? null);
			views.push({
				name: row.name,
				agent: row.agent,
				source: definition?.status.source ?? "none",
				reports: definition === null ? [] : reportedStates(definition),
				hook: row.agent === null ? null : found.get(row.agent) ?? null,
			});
		}
		return views;
	}

	/** Write a file whole: to a temporary file beside it with `mode`, then renamed over it. */
	async function replace(path: string, text: string, mode: number): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		const temporary = join(dirname(path), `.${randomUUID()}.timber-app.tmp`);
		try {
			await writeFile(temporary, text, { mode, flag: "wx" });
			await chmod(temporary, mode);
			await rename(temporary, path);
		} catch (error) {
			await rm(temporary, { force: true }).catch(() => undefined);
			throw error;
		}
	}

	async function change(request: StatusHookRequest, action: "install" | "remove"): Promise<StatusHookResult> {
		const answer = async (outcome: StatusHookResult["outcome"], message: string): Promise<StatusHookResult> => ({ outcome, message, hooks: await list() });
		const rows = await savedPrograms();
		if (!supported) return answer("refused", "Status hooks are not built for Windows yet. Nothing was written.");
		if (!rows.some(row => row.agent === request.agent)) return answer("refused", "No saved agent in Settings, Agents runs that agent. Nothing was written.");
		const found = await inspect(request.agent);
		if (found === null) return answer("refused", "That agent has no status hook. Nothing was written.");
		const { details, file } = found;
		const name = details.agentName;
		if (details.token !== request.token) return answer("changed-since", `${details.file} changed since it was shown. Nothing was written; look at it again.`);
		// A file the app does not write: Turn on only puts the script in place, in the app's own folder, for the entries added by hand.
		if (details.byHand !== null && action === "install" && details.state.kind === "off" && hookCommand(scriptPath, request.agent, "x") !== null) {
			const script = await scriptState();
			if (script === "different" || script === "unusable") return answer("refused", `${details.scriptPath} is there but ${script === "unusable" ? "cannot be read or run" : "not as the app writes it"}, so the app does not replace it. Nothing was written.`);
			try {
				if (script === "missing") await replace(scriptPath, STATUS_HOOK_SCRIPT, 0o755);
			} catch (error) {
				return answer("failed", `Could not write ${details.scriptPath}: ${messageOf(error)}.`);
			}
			return answer("done", `The script is in place at ${details.scriptPath}. Add the entries to ${details.file} by hand.`);
		}
		if (details.byHand !== null) return answer("refused", `${details.byHand} Nothing was written.`);
		try {
			if (action === "install") {
				if (details.state.kind !== "off" || found.installed === null) return answer("refused", `The ${name} status hook is not off. Nothing was written.`);
				const script = await scriptState();
				if (script === "different" || script === "unusable") return answer("refused", `${details.scriptPath} is there but ${script === "unusable" ? "cannot be read or run" : "not as the app writes it"}, so the app does not replace it. Nothing was written.`);
				if (script === "missing") await replace(scriptPath, STATUS_HOOK_SCRIPT, 0o755);
				// Read again just before writing: what is written is what was shown.
				if ((await readAgentFile(file.path)).token !== request.token) return answer("changed-since", `${details.file} changed since it was shown. Nothing was written; look at it again.`);
				await replace(file.path, found.installed, file.exists ? file.mode : 0o644);
				return answer("done", `The ${name} status hook is on, in ${details.file}.`);
			}
			if (details.present.length === 0 || found.removed === undefined) return answer("refused", `The app's entries are not in ${details.file}. Nothing was written.`);
			if ((await readAgentFile(file.path)).token !== request.token) return answer("changed-since", `${details.file} changed since it was shown. Nothing was written; look at it again.`);
			if (found.removed === null) await unlink(file.path);
			else await replace(file.path, found.removed, file.mode);
			return answer("done", found.removed === null ? `The ${name} status hook is off, and ${details.file}, left empty, was deleted.` : `The ${name} status hook is off. The app's entries were taken out of ${details.file}.`);
		} catch (error) {
			return answer("failed", `Could not write ${details.file}: ${messageOf(error)}.`);
		}
	}

	return {
		list,
		install: request => change(request, "install"),
		remove: request => change(request, "remove"),
	};
}
