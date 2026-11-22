import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PullSectionView, type PullSectionViewProps } from "../src/mainview/components/settings/PullSection";
import { createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { defaultPullConfirmSetting } from "../src/shared/pull-confirm-setting";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};

const repositories = [{ path: "/work/app", name: "app" }, { path: "/home/me/app", name: "app" }];

const view = (props: Partial<PullSectionViewProps> = {}) => renderToStaticMarkup(
	<PullSectionView
		draft={defaultPullConfirmSetting()}
		saved={defaultPullConfirmSetting()}
		repositories={repositories}
		save={{ state: "idle" }}
		onEdit={() => {}}
		onSave={() => {}}
		{...props}
	/>,
);

/** The switches in the order drawn: whether each is on, and its text. */
const switches = (markup: string) => [...markup.matchAll(/<label class="check"><input type="checkbox" role="switch"([^>]*)\/><span class="check-text">(.*?)<\/label>/g)]
	.map(match => ({ on: match[1]!.includes("checked=\"\""), text: match[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }));

describe("the Pull section of Settings", () => {
	test("has Ask before pulling, on by default, then every repository's Skip pull confirmation, off by default, told apart by path", () => {
		const markup = view();
		expect(markup).toContain("<h3");
		expect(markup).toContain(">Pull</h3>");
		expect(markup).toContain("Push always shows its dialog.");
		expect(switches(markup)).toEqual([
			{ on: true, text: expect.stringMatching(/^Ask before pulling When this is off, Pull runs at once in every repository\./) },
			{ on: false, text: "app /work/app" },
			{ on: false, text: "app /home/me/app" },
		]);
		expect(markup).toContain("Skip pull confirmation");
		// Nothing differs from what is saved, so Save is marked off.
		expect(markup).toContain("aria-disabled=\"true\"");
	});

	test("shows a repository's switch on, and says when Ask before pulling being off makes the switches wait", () => {
		const draft = { ask: false, skip: ["/work/app"] };
		const markup = view({ draft });
		expect(switches(markup).map(entry => entry.on)).toEqual([false, true, false]);
		expect(markup).toContain("Ask before pulling is off, so no repository asks.");
		expect(markup).not.toContain("aria-disabled=\"true\"");
	});

	test("says when there are no repositories", () => {
		expect(view({ repositories: [] })).toContain("No repositories are in the app yet.");
	});
});

describe("the Pull setting through the store", () => {
	test("saves Ask before pulling, keeps it for the next start, and a switch turned off brings the dialog back", async () => {
		const engine = createMockEngine(structuredClone(sampleRepositories), sampleTimberStatuses.ready);
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		expect(store.getState().preferences.pull).toEqual({ ask: true, skip: [] });
		expect(await store.savePreferences({ pull: { ask: false, skip: [] } })).toMatchObject({ outcome: "saved" });
		const again = createAppStore(engine, () => () => {});
		again.start();
		await settle();
		expect(again.getState().preferences.pull).toEqual({ ask: false, skip: [] });

		const main = again.getState().repositories[0]!.worktrees.find(worktree => worktree.primary)!;
		const request = { kind: "sync-action" as const, action: "pull" as const, repository: "/work/timber", worktree: main.id };
		await again.savePreferences({ pull: { ask: true, skip: ["/work/timber"] } });
		await again.savePreferences({ pull: { ask: true, skip: [] } });
		again.openDialog(request);
		expect(again.getState().dialog).toEqual(request);
	});
});
