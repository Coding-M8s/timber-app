import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { sampleContainers } from "../src/mainview/engine/mock-ports";
import { clashMarksOf, describePortClash, describePortsItem, portGroups } from "../src/mainview/ports-format";
import { createAppStore } from "../src/mainview/store/store";
import type { PortsResult } from "../src/shared/ports";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const LOOKUP = sampleRepositories[0]!.worktrees.find(worktree => worktree.branch === "feat/github-issue-lookup")!;
const SPIKE = sampleRepositories[0]!.worktrees.find(worktree => worktree.branch === "spike/new-idea")!;
const MAIN = sampleRepositories[0]!.worktrees[0]!;

async function started(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return store;
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

describe("the store's ports", () => {
	test("reads a worktree's ports and every clash, and marks both worktrees of one", async () => {
		const engine = createMockEngine();
		const store = await started(engine);
		await store.readPorts(TIMBER, LOOKUP.id);
		const result = store.getState().ports[LOOKUP.path];
		expect(describePortsItem(result)?.text).toBe("7 ports");
		expect(store.getState().portClashes).toEqual([{ hostPort: 5432, protocol: "tcp", folders: [LOOKUP.path, SPIKE.path] }]);
		const marks = clashMarksOf(store.getState().portClashes, store.getState().repositories);
		expect(describePortClash(marks.get(LOOKUP.path))).toBe("Port also claimed elsewhere: 5432 with spike/new-idea.");
		expect(describePortClash(marks.get(SPIKE.path))).toBe("Port also claimed elsewhere: 5432 with feat/github-issue-lookup.");
		expect(describePortClash(marks.get(MAIN.path))).toBeNull();
	});

	test("a hidden window reads nothing and keeps the last answer", async () => {
		const engine = createMockEngine();
		const store = await started(engine);
		await store.readPorts(TIMBER, LOOKUP.id);
		const before = store.getState().ports[LOOKUP.path];
		const reads = engine.portReads();
		engine.attend({ visible: false, focused: false, selected: null, session: null });
		engine.setDocker("stopped");
		await store.readPorts(TIMBER, LOOKUP.id);
		expect(engine.portReads()).toBe(reads);
		expect(store.getState().ports[LOOKUP.path]).toBe(before);
	});

	test("Docker that cannot be read is a quiet reason in the tooltip, never a dialog", async () => {
		for (const problem of ["no-docker", "stopped", "denied"] as const) {
			const engine = createMockEngine();
			engine.setDocker(problem);
			const store = await started(engine);
			await store.readPorts(TIMBER, MAIN.id);
			const item = describePortsItem(store.getState().ports[MAIN.path])!;
			expect(item.text).toBe("no ports");
			expect(item.tooltip).toContain(problem === "no-docker" ? "Docker is not installed" : problem === "stopped" ? "Docker is not running." : "No permission to use Docker.");
			expect(store.getState().dialog).toBeNull();
			expect(portGroups(store.getState().ports[MAIN.path], [])).toEqual([]);
		}
	});
});

describe("the list", () => {
	const result: PortsResult = {
		outcome: "read",
		docker: { state: "read", ports: [{ service: "web", container: "web-1", hostPort: 8080, containerPort: 80, protocol: "tcp" }, { service: "dns", container: "dns-1", hostPort: 5353, containerPort: 53, protocol: "udp" }] },
		sessions: { state: "read", ports: [{ session: "s1", name: "Dev server", hostPort: 5173, protocol: "tcp" }] },
		clashes: [],
	};

	test("groups by source, Docker first, with host and container ports", () => {
		const groups = portGroups(result, [{ hostPort: 8080, protocol: "tcp", others: ["feat/b"] }]);
		expect(groups.map(group => [group.title, group.lines.map(line => `${line.owner} ${line.port} ${line.alsoClaimedBy.join(",")}`.trim())])).toEqual([
			["Docker", ["web 8080 -> 80 feat/b", "dns 5353 -> 53/udp"]],
			["Sessions", ["Dev server 5173"]],
		]);
	});

	test("the item counts ports, and says what could not be read", () => {
		expect(describePortsItem(result)).toEqual({ text: "3 ports", tooltip: "3 ports open in this worktree. Show them." });
		expect(describePortsItem({ ...result, sessions: { state: "unknown", message: "Ports of sessions are read on Linux only." } })?.tooltip).toBe("2 ports open in this worktree. Show them. Ports of sessions are read on Linux only.");
		expect(describePortsItem(undefined)).toBeNull();
		expect(describePortsItem({ outcome: "not-listed", message: "Timber lists no worktree." })).toEqual({ text: "ports unknown", tooltip: "Timber lists no worktree." });
	});
});

describe("in the window", () => {
	test("the header has one quiet item, and only rows in a clash show a warning", async () => {
		const engine = createMockEngine();
		const store = await started(engine);
		store.select(LOOKUP.id);
		await store.readPorts(TIMBER, LOOKUP.id);
		const markup = render(store);
		expect(markup).toContain('class="ports-button"');
		expect(markup).toContain(">7 ports</button>");
		expect(markup.match(/>port clash</g)?.length).toBe(2);
		expect(markup).toContain("Port also claimed elsewhere: 5432 with spike/new-idea.");
	});

	test("no clash, no warning", async () => {
		const engine = createMockEngine();
		engine.setDocker(sampleContainers.filter(container => container.state === "running"));
		const store = await started(engine);
		store.select(LOOKUP.id);
		await store.readPorts(TIMBER, LOOKUP.id);
		const markup = render(store);
		expect(markup).toContain(">7 ports</button>");
		expect(markup).not.toContain("port clash");
	});
});
