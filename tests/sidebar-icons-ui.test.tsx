import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { SidebarIconDialogView } from "../src/mainview/components/SidebarIconDialog";
import { SidebarIconView } from "../src/mainview/components/SidebarIcon";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { SAMPLE_AVATAR_PNG, SAMPLE_ICON_FILE_PNG } from "../src/mainview/engine/mock-sidebar-icons";
import { chooseFromRepositoryMenu } from "../src/mainview/sidebar-groups";
import { describeCurrentIcon, describeIconDialogTitle } from "../src/mainview/sidebar-icon-format";
import { createAppStore } from "../src/mainview/store/store";
import { type SidebarIcon, fromBase64, remoteIconSourceOf } from "../src/shared/sidebar-icons";
import { png } from "./support/images";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const API_SERVER = sampleRepositories[1]!.path;

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { store, engine };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

/** The markup of one section of the sidebar, from its opening tag to the next section. */
function sectionOf(markup: string, marker: string): string {
	const start = markup.indexOf(marker);
	expect(start).toBeGreaterThan(-1);
	const end = markup.indexOf("<section", start + marker.length);
	return markup.slice(start, end === -1 ? undefined : end);
}

describe("an icon in the sidebar", () => {
	test("shows before a repository's name and a group's name once set, and not before", async () => {
		const { store } = await startedStore();
		expect(render(store)).not.toContain("sidebar-icon");

		expect(await store.createGroup("Work", TIMBER)).toBe(true);
		const work = store.getState().repositoryGroups.groups[0]!.id;
		expect(await store.setSidebarIcon({ kind: "repository", path: TIMBER }, { kind: "bundled", name: "star" })).toMatchObject({ outcome: "saved" });
		expect(await store.setSidebarIcon({ kind: "group", id: work }, { kind: "remote" })).toEqual({ outcome: "refused", message: "Only a repository can take its icon from a remote." });
		expect(await store.setSidebarIcon({ kind: "group", id: work }, { kind: "bundled", name: "briefcase" })).toMatchObject({ outcome: "saved" });

		const markup = render(store);
		const group = sectionOf(markup, `data-group="${work}"`);
		expect(group).toMatch(/<span class="sidebar-icon bundled" aria-hidden="true"><svg[^>]*>.*?<\/svg><\/span><span class="repository-group-name">Work<\/span>/);
		const repository = sectionOf(markup, `data-repository="${TIMBER}"`);
		expect(repository).toMatch(/<span class="sidebar-icon bundled" aria-hidden="true"><svg[^>]*>.*?<\/svg><\/span><span class="group-name">timber<\/span>/);
		expect(sectionOf(markup, `data-repository="${API_SERVER}"`)).not.toContain("sidebar-icon");
	});

	test("an image icon is drawn from the copy kept, with no address on the network", () => {
		const icon: SidebarIcon = { kind: "image", source: "github", type: "image/png", data: SAMPLE_AVATAR_PNG };
		const markup = renderToStaticMarkup(<SidebarIconView icon={icon} />);
		expect(markup).toContain(`<img src="data:image/png;base64,${SAMPLE_AVATAR_PNG}" alt="" width="14" height="14" draggable="false"/>`);
		expect(markup).not.toContain("http");
		expect(renderToStaticMarkup(<SidebarIconView icon={null} />)).toBe("");
	});

	test("removing a repository or deleting a group drops its icon", async () => {
		const { store, engine } = await startedStore();
		await store.createGroup("Work", TIMBER);
		const work = store.getState().repositoryGroups.groups[0]!.id;
		await store.setSidebarIcon({ kind: "repository", path: API_SERVER }, { kind: "bundled", name: "code" });
		await store.setSidebarIcon({ kind: "group", id: work }, { kind: "bundled", name: "home" });
		await store.removeRepository(API_SERVER);
		await store.deleteGroup(work);
		await settle();
		expect(store.getState().sidebarIcons).toEqual({ repositories: {}, groups: {} });
		expect(await engine.listSidebarIcons()).toEqual({ repositories: {}, groups: {} });
	});
});

test("an icon set while the whole list is read again stays shown when that read answers", async () => {
	const engine = createMockEngine();
	const { store } = await startedStore(engine);
	const list = engine.listRepositories.bind(engine);
	let release!: () => void;
	const gate = new Promise<void>(resolve => {
		release = resolve;
	});
	engine.listRepositories = async () => {
		await gate;
		return list();
	};
	// The icons are read now, before the icon is set, and answer only with the slow list.
	const reload = store.refresh();
	await settle();
	expect(await store.setSidebarIcon({ kind: "repository", path: TIMBER }, { kind: "bundled", name: "star" })).toMatchObject({ outcome: "saved" });
	release();
	await reload;
	await settle();
	expect(store.getState().sidebarIcons.repositories[TIMBER]).toEqual({ kind: "bundled", name: "star" });
	// The next read has it from the settings.
	await store.refresh();
	await settle();
	expect(store.getState().sidebarIcons.repositories[TIMBER]).toEqual({ kind: "bundled", name: "star" });
});

describe("an icon in the command palette", () => {
	test("shows beside the repository's name in the scope chip and on rows of another repository", async () => {
		const { store } = await startedStore();
		await store.setSidebarIcon({ kind: "repository", path: TIMBER }, { kind: "bundled", name: "rocket" });
		store.openDialog({ kind: "palette" });
		await settle();
		const markup = render(store);
		const palette = markup.slice(markup.indexOf('<dialog class="dialog palette"'));
		const chip = palette.slice(palette.indexOf('class="palette-scope"'), palette.indexOf("</button>", palette.indexOf('class="palette-scope"')));
		expect(chip).toMatch(/<span class="palette-repository-icon bundled" aria-hidden="true"><svg[^>]*width="12"/);
		expect(chip).toContain("<span>timber</span>");
	});

	test("an image icon shows in the chip too, from the copy kept", async () => {
		const engine = createMockEngine();
		engine.setIconFile(fromBase64(SAMPLE_ICON_FILE_PNG));
		const { store } = await startedStore(engine);
		expect(await store.setSidebarIcon({ kind: "repository", path: API_SERVER }, { kind: "file" })).toMatchObject({ outcome: "saved" });
		store.select(sampleRepositories[1]!.worktrees[0]!.id);
		store.openDialog({ kind: "palette" });
		await settle();
		const markup = render(store);
		const palette = markup.slice(markup.indexOf('<dialog class="dialog palette"'));
		expect(palette).toContain(`<span class="palette-repository-icon image" aria-hidden="true"><img src="data:image/png;base64,${SAMPLE_ICON_FILE_PNG}" alt="" width="12" height="12" draggable="false"/></span><span>api-server</span>`);
		// The rows of another repository, shown once something is typed, are checked in sidebar-icons-browser.test.ts.
	});
});

describe("the icon dialog", () => {
	test("opens from a repository's menu entry Icon...", async () => {
		const { store } = await startedStore();
		chooseFromRepositoryMenu(store, TIMBER, { kind: "icon" }, () => {});
		expect(store.getState().dialog).toEqual({ kind: "sidebar-icon", target: { kind: "repository", path: TIMBER } });
		await settle();
		const markup = render(store);
		expect(markup).toContain('<dialog class="dialog sidebar-icon-dialog"');
		expect(markup).toContain("Icon for timber");
		expect(markup).toContain("Choose image file...");
		// Where the remote icon comes from is read once the dialog shows: see sidebar-icons-browser.test.ts.
	});

	test("sets a bundled icon, an image file, and the remote icon, each shown at once", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		const target = { kind: "repository", path: TIMBER } as const;
		await store.setSidebarIcon(target, { kind: "bundled", name: "flask" });
		expect(store.getState().sidebarIcons.repositories[TIMBER]).toEqual({ kind: "bundled", name: "flask" });

		engine.setIconFile(png(16, 16));
		expect(await store.setSidebarIcon(target, { kind: "file" })).toMatchObject({ outcome: "saved" });
		expect(store.getState().sidebarIcons.repositories[TIMBER]).toMatchObject({ kind: "image", source: "file" });

		expect(await store.setSidebarIcon(target, { kind: "remote" })).toMatchObject({ outcome: "saved" });
		expect(store.getState().sidebarIcons.repositories[TIMBER]).toEqual({ kind: "image", source: "github", type: "image/png", data: SAMPLE_AVATAR_PNG });

		expect(await store.setSidebarIcon(target, null)).toMatchObject({ outcome: "saved" });
		expect(store.getState().sidebarIcons.repositories).toEqual({});
	});

	test("a refused file or a failed fetch is answered with why, and leaves the icon shown", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		const target = { kind: "repository", path: TIMBER } as const;
		await store.setSidebarIcon(target, { kind: "bundled", name: "bug" });
		engine.setIconFile(new Uint8Array(200 * 1024));
		expect(await store.setSidebarIcon(target, { kind: "file" })).toEqual({ outcome: "refused", message: "That image is 200 KB. An icon can be at most 32 KB." });
		engine.setIconFile(new TextEncoder().encode("plain text, not an image at all"));
		expect(await store.setSidebarIcon(target, { kind: "file" })).toEqual({ outcome: "refused", message: "That file is not a PNG, JPEG, or WebP image." });
		engine.setRemoteIcon(TIMBER, { source: remoteIconSourceOf("git@bitbucket.org:acme/timber.git")!, failure: { outcome: "failed", message: "Could not reach Bitbucket: offline" } });
		expect(await store.setSidebarIcon(target, { kind: "remote" })).toEqual({ outcome: "failed", message: "Could not reach Bitbucket: offline The icon was not changed." });
		expect(store.getState().sidebarIcons.repositories[TIMBER]).toEqual({ kind: "bundled", name: "bug" });
	});

	test("says what is set, offers the remote only where the origin has one, and shows a problem as an alert", () => {
		const choose = () => {};
		const github = remoteIconSourceOf("git@github.com:acme/shop.git");
		const avatar: SidebarIcon = { kind: "image", source: "github", type: "image/png", data: SAMPLE_AVATAR_PNG };
		const view = (props: Partial<Parameters<typeof SidebarIconDialogView>[0]>) => renderToStaticMarkup(
			<SidebarIconDialogView kind="repository" name="shop" icon={null} remote={github} busy={null} problem={null} onChoose={choose} onClose={choose} {...props} />,
		);
		expect(view({})).toContain("Use the GitHub avatar of acme");
		expect(view({ icon: avatar })).toContain("Refresh the GitHub avatar");
		expect(view({ icon: avatar })).toContain("The GitHub avatar");
		expect(view({ remote: null })).toContain("No icon can be taken from a remote: origin is not one GitHub or Bitbucket repository");
		expect(view({ remote: null })).not.toContain("Use the GitHub avatar");
		expect(view({ remote: undefined })).not.toContain("No icon can be taken");
		expect(view({ kind: "group", name: "Work", remote: null })).not.toContain("No icon can be taken");
		expect(view({ problem: "GitHub has no avatar for acme." })).toContain('role="alert">GitHub has no avatar for acme.</p>');
		expect(view({ icon: { kind: "bundled", name: "star" } })).toContain('aria-label="Star" title="Star" aria-pressed="true"');
		// Remove is offered only while there is an icon, and nothing else can be asked while one choice runs.
		expect(view({})).toMatch(/<button type="button" class="button quiet" disabled="">Remove icon<\/button>/);
		expect(view({ busy: "remote", icon: avatar })).toContain("Fetching from GitHub");
		expect(view({ busy: "remote", icon: avatar })).toMatch(/aria-label="Folder" title="Folder" aria-pressed="false" disabled=""/);
	});

	test("words", () => {
		expect(describeIconDialogTitle("repository", "timber")).toBe("Icon for timber");
		expect(describeIconDialogTitle("group", "Work › Client")).toBe("Icon for group Work › Client");
		expect(describeCurrentIcon(null, () => "")).toBe("No icon");
		expect(describeCurrentIcon({ kind: "image", source: "file", type: "image/png", data: "" }, () => "")).toBe("An image file");
		expect(describeCurrentIcon({ kind: "image", source: "bitbucket", type: "image/png", data: "" }, () => "")).toBe("The Bitbucket icon");
	});
});
