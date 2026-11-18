import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { aboutRows } from "../src/mainview/about-format";
import { AboutSectionView } from "../src/mainview/components/settings/AboutSection";
import { UninstallPanelView, type UninstallPanelViewProps } from "../src/mainview/components/settings/UninstallPanel";
import { createMockEngine, sampleUninstallPlan } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { describeEndingTerminals, describeForgetHint, describeUninstallCommand, uninstallRemovals, uninstallRunOf } from "../src/mainview/uninstall-format";

const nothing = () => {};

function render(change: Partial<UninstallPanelViewProps> = {}): string {
	return renderToStaticMarkup(
		<UninstallPanelView
			plan={sampleUninstallPlan}
			confirming={false}
			cancelled={false}
			forgetSettings={false}
			run={{ state: "idle" }}
			liveTerminals={0}
			onStart={nothing}
			onCancel={nothing}
			onForgetSettings={nothing}
			onConfirm={nothing}
			onQuit={nothing}
			{...change}
		/>,
	);
}

describe("what the Uninstall part of About says", () => {
	test("the command is shown as it would run", () => {
		expect(describeUninstallCommand(sampleUninstallPlan)).toBe("/home/sam/.local/share/com.codingm8s.timber-app/stable/uninstall --quiet --delete-data");
		expect(describeUninstallCommand({ ...sampleUninstallPlan, command: ["/home/sam/my data/stable/uninstall", "--quiet", "--delete-data"] }))
			.toBe("'/home/sam/my data/stable/uninstall' --quiet --delete-data");
	});

	test("the settings folder is listed only when it is to go, and last", () => {
		expect(uninstallRemovals(sampleUninstallPlan, false)).toEqual(sampleUninstallPlan.removes);
		expect(uninstallRemovals(sampleUninstallPlan, true)).toEqual([...sampleUninstallPlan.removes, "/home/sam/.config/timber-app"]);
	});

	test("the hint under the checkbox says what happens to the settings either way", () => {
		expect(describeForgetHint("/home/sam/.config/timber-app", false)).toBe("/home/sam/.config/timber-app stays, so another install finds the same repositories.");
		expect(describeForgetHint("/home/sam/.config/timber-app", true)).toBe("/home/sam/.config/timber-app is deleted once the app is removed. Another install starts with an empty list.");
	});

	test("running terminals are counted, and none is not mentioned", () => {
		expect(describeEndingTerminals(0)).toBeNull();
		expect(describeEndingTerminals(1)).toBe("1 terminal is running and will be ended.");
		expect(describeEndingTerminals(3)).toBe("3 terminals are running and will be ended.");
	});

	test("an answer that is not a removal is a failure with its message", () => {
		expect(uninstallRunOf({ outcome: "uninstalled", settingsProblem: null })).toEqual({ state: "done", settingsProblem: null });
		expect(uninstallRunOf({ outcome: "failed", message: "exit code 1" })).toEqual({ state: "failed", message: "exit code 1" });
		expect(uninstallRunOf({ outcome: "unavailable", message: "Not installed." })).toEqual({ state: "failed", message: "Not installed." });
	});
});

describe("the Uninstall part of About", () => {
	test("is the last part of About", () => {
		const markup = renderToStaticMarkup(<AboutSectionView rows={aboutRows("0.4.0", null)} uninstall={<p>here</p>} />);
		expect(markup).toContain('<h4 class="about-subtitle">Uninstall</h4><p>here</p></section>');
		expect(markup.indexOf("Licenses")).toBeLessThan(markup.indexOf("Uninstall"));
	});

	test("says it is checking until the main process answered", () => {
		const markup = render({ plan: undefined });
		expect(markup).toContain("Checking whether this copy can be uninstalled.");
		expect(markup).not.toContain("<button");
	});

	test("a copy that was not installed gets the reason and no button", () => {
		const markup = render({ plan: { available: false, reason: "This copy of the app was not installed, so there is nothing to uninstall. It runs from /home/sam/timber-app." } });
		expect(markup).toContain("It runs from /home/sam/timber-app.");
		expect(markup).not.toContain("<button");
	});

	test("the first button only asks: no command yet, and nothing marked as dangerous", () => {
		const markup = render();
		expect(markup).toContain('<button type="button" class="button quiet">Uninstall Timber</button>');
		expect(markup).toContain("Your repositories, their worktrees, and Timber itself are not touched.");
		expect(markup).not.toContain("danger");
		expect(markup).not.toContain("--delete-data");
		expect(markup).not.toContain("autofocus");
	});

	test("after Cancel, focus goes back to the button it came from", () => {
		expect(render({ cancelled: true })).toContain('<button type="button" class="button quiet" autofocus="">Uninstall Timber</button>');
	});

	test("confirming shows everything that goes and the command before anything runs", () => {
		const markup = render({ confirming: true });
		for (const path of sampleUninstallPlan.removes) expect(markup).toContain(`<li>${path}</li>`);
		expect(markup).not.toContain("<li>/home/sam/.config/timber-app</li>");
		expect(markup).toContain('<pre class="dialog-command">/home/sam/.local/share/com.codingm8s.timber-app/stable/uninstall --quiet --delete-data</pre>');
		expect(markup).toContain('<input type="checkbox"/>');
		expect(markup).toContain("/home/sam/.config/timber-app stays, so another install finds the same repositories.");
		// Focus starts on the button that changes nothing.
		expect(markup).toContain('<button type="button" class="button quiet" autofocus="">Cancel</button>');
		expect(markup).toContain('<button type="button" class="button danger">Uninstall and quit</button>');
		expect(markup).not.toContain("will be ended");
	});

	test("with the settings to forget, their folder is listed too", () => {
		const markup = render({ confirming: true, forgetSettings: true });
		expect(markup).toContain("<li>/home/sam/.config/timber-app</li>");
		expect(markup).toContain('<input type="checkbox" checked=""/>');
		expect(markup).toContain("is deleted once the app is removed");
	});

	test("running terminals are mentioned, because they end without another question", () => {
		expect(render({ confirming: true, liveTerminals: 2 })).toContain('<p class="about-text" role="note">2 terminals are running and will be ended.</p>');
	});

	test("while the uninstaller runs, nothing can be pressed or changed", () => {
		const markup = render({ confirming: true, run: { state: "running" } });
		expect(markup).toContain('aria-busy="true"');
		expect(markup).toContain('<button type="button" class="button quiet" autofocus="" disabled="">Cancel</button>');
		expect(markup).toContain('<button type="button" class="button danger" disabled="">Uninstalling</button>');
		expect(markup).toContain('<input type="checkbox" disabled=""/>');
	});

	test("a failure is shown with its message, and the buttons work again", () => {
		const markup = render({ confirming: true, run: { state: "failed", message: "The uninstaller ended with exit code 1: error: InvalidUninstallManifest" } });
		expect(markup).toContain('role="alert"');
		expect(markup).toContain("Could not uninstall");
		expect(markup).toContain("The uninstaller ended with exit code 1: error: InvalidUninstallManifest");
		expect(markup).toContain('<button type="button" class="button danger">Uninstall and quit</button>');
	});

	test("once the app is removed it says so and offers nothing more", () => {
		const markup = render({ confirming: true, run: { state: "done", settingsProblem: null } });
		expect(markup).toContain("Timber was removed. The app is quitting.");
		expect(markup).not.toContain("<button");
	});

	test("settings that could not be deleted are told, with where they are and a way to quit", () => {
		const markup = render({ confirming: true, forgetSettings: true, run: { state: "done", settingsProblem: "EACCES: permission denied" } });
		expect(markup).toContain("Timber was removed, but its settings were not");
		expect(markup).toContain("EACCES: permission denied");
		expect(markup).toContain("Delete /home/sam/.config/timber-app yourself");
		expect(markup).toContain('<button type="button" class="button primary">Quit</button>');
		expect(markup).not.toContain("Uninstall and quit");
	});
});

describe("uninstalling through the store and the mock engine", () => {
	test("the mock describes an installed copy and acts out the removal without removing anything", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		expect(await store.uninstallPlan()).toEqual(sampleUninstallPlan);
		expect(await store.uninstall({ forgetSettings: true })).toEqual({ outcome: "uninstalled", settingsProblem: null });
		expect(engine.uninstallRequests()).toEqual([{ forgetSettings: true }]);
	});

	test("the mock acts out each other ending", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		engine.endUninstalls("fails");
		expect(await store.uninstall({ forgetSettings: false })).toEqual({ outcome: "failed", message: "The uninstaller ended with exit code 1: error: InvalidUninstallManifest" });
		engine.endUninstalls("keeps-settings");
		expect(await store.uninstall({ forgetSettings: false })).toEqual({ outcome: "uninstalled", settingsProblem: null });
		expect((await store.uninstall({ forgetSettings: true })).outcome).toBe("uninstalled");
		expect(await store.uninstall({ forgetSettings: true })).toMatchObject({ settingsProblem: expect.stringContaining("/home/sam/.config/timber-app/settings.json") });
		engine.endUninstalls("unavailable");
		expect((await store.uninstallPlan()).available).toBe(false);
		expect((await store.uninstall({ forgetSettings: false })).outcome).toBe("unavailable");
		expect(() => engine.endUninstalls("explodes" as never)).toThrow("Unknown ending: explodes");
	});

	test("an engine that does not answer is a reason or a failure, never a crash", async () => {
		const engine = {
			...createMockEngine(),
			uninstallPlan: () => Promise.reject(new Error("no answer")),
			uninstall: () => Promise.reject(new Error("timed out")),
		};
		const store = createAppStore(engine);
		expect(await store.uninstallPlan()).toEqual({ available: false, reason: "Could not check whether this copy can be uninstalled: no answer" });
		expect(await store.uninstall({ forgetSettings: false })).toEqual({ outcome: "failed", message: "No answer came back from the uninstaller: timed out" });
	});
});
