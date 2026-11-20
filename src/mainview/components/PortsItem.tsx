import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Repository, Worktree } from "../../shared/model";
import { portAddress } from "../../shared/ports";
import { clashMarksOf, describePortsItem, portGroups } from "../ports-format";
import { useAppState, useStore } from "../store/react";

/**
 * The ports item of the workspace header, such as "6 ports", and the list it
 * opens, grouped by Docker and sessions. Reads the worktree's ports when it
 * is selected, whenever its repository reloads (a new `worktree` object), and
 * when the list opens. The engine holds reads to its gap and skips them while
 * the window is hidden, so there is no timer here.
 */
export function PortsItem({ repository, worktree }: { repository: Repository; worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const [open, setOpen] = useState(false);
	const listId = useId();
	const holder = useRef<HTMLSpanElement>(null);
	const button = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (worktree.pathExists) void store.readPorts(repository.path, worktree.id);
	}, [store, repository.path, worktree]);

	// Another worktree starts with the list closed.
	useEffect(() => setOpen(false), [worktree.path]);

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: PointerEvent) => {
			if (holder.current && !holder.current.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", onPointer);
		return () => document.removeEventListener("pointerdown", onPointer);
	}, [open]);

	const result = state.ports[worktree.path];
	const marks = useMemo(() => clashMarksOf(state.portClashes, state.repositories), [state.portClashes, state.repositories]);
	const item = describePortsItem(result);
	if (item === null) return null;
	const groups = portGroups(result, marks.get(worktree.path) ?? []);

	const toggle = () => {
		if (!open) void store.readPorts(repository.path, worktree.id);
		setOpen(!open);
	};

	return (
		<span
			className="ports"
			ref={holder}
			// On the holder, so Escape closes the list whether focus is on the button or in the list.
			onKeyDown={event => {
				if (event.key !== "Escape" || !open) return;
				event.stopPropagation();
				setOpen(false);
				button.current?.focus();
			}}
		>
			<button
				type="button"
				className="ports-button"
				ref={button}
				title={item.tooltip}
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				onClick={toggle}
			>
				{item.text}
			</button>
			{open && (
				<div
					id={listId}
					className="ports-list"
					role="group"
					aria-label={`Ports of ${worktree.branch ?? worktree.path}`}
				>
					{groups.length === 0 && <p className="ports-empty">{item.tooltip}</p>}
					{groups.map(group => (
						<section key={group.title} className="ports-group">
							<h2 className="ports-group-title">{group.title}</h2>
							<ul>
								{group.lines.map(line => (
									<li key={line.key} className="ports-line">
										<span className="ports-owner">{line.owner}</span>
										<span className="ports-port">{line.port}</span>
										{line.alsoClaimedBy.length > 0 && (
											<span className="ports-clash" title={`Port ${line.hostPort} is also claimed by ${line.alsoClaimedBy.join(" and ")}.`}>
												also {line.alsoClaimedBy.join(", ")}
											</span>
										)}
										<span className="ports-actions">
											<button type="button" className="button quiet" title={`Open ${portAddress(line.hostPort)}`} onClick={() => void store.openLink(portAddress(line.hostPort))}>
												Open in browser
											</button>
											<button
												type="button"
												className="button quiet"
												title={`Copy ${portAddress(line.hostPort)}`}
												onClick={() => {
													void store.copyText(portAddress(line.hostPort));
													store.showToast(`Copied ${portAddress(line.hostPort)}`);
												}}
											>
												Copy
											</button>
										</span>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
			)}
		</span>
	);
}
