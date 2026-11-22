import { describe, expect, test } from "bun:test";
import { carryAlert } from "../src/bun/alert-actions";
import type { ShowOptions } from "../src/bun/desktop-notices";
import type { PlayOptions } from "../src/bun/sounds";
import type { SoundChoice } from "../src/shared/sound-setting";
import type { StatusNotice } from "../src/shared/status-notices";

describe("carrying out an alert in the main process", () => {
	const notice: StatusNotice = { session: "s", title: "Codex is done", body: "In feature: Done" };
	const bell: SoundChoice = { kind: "custom", path: "/home/me/sounds/bell.ogg" };
	const setUp = () => {
		const shown: { notice: StatusNotice; options: ShowOptions }[] = [];
		const withdrawn: string[] = [];
		const played: { choice: SoundChoice; options: PlayOptions | undefined }[] = [];
		const notices = { show: (notice: StatusNotice, options: ShowOptions) => void shown.push({ notice, options }), withdraw: (session: string) => void withdrawn.push(session) };
		const sounds = { play: async (choice: SoundChoice, options?: PlayOptions) => (played.push({ choice, options }), { outcome: "played" as const }) };
		return { shown, withdrawn, played, notices, sounds };
	};

	test("plays the sound chosen for the status, and asks the server to keep quiet only then", () => {
		const { shown, played, notices, sounds } = setUp();
		carryAlert({ kind: "show", notice, sound: bell }, notices, sounds);
		carryAlert({ kind: "show", notice, sound: null }, notices, sounds);
		carryAlert({ kind: "sound", session: "t", sound: { kind: "bundled", name: "knock" } }, notices, sounds);
		expect(shown.map(each => each.options)).toEqual([{ withSound: true }, { withSound: false }]);
		// An automatic sound whose own file is gone falls back to the chime.
		expect(played).toEqual([{ choice: bell, options: { fallBackToChime: true } }, { choice: { kind: "bundled", name: "knock" }, options: { fallBackToChime: true } }]);
	});

	test("a withdrawal plays nothing", () => {
		const { withdrawn, played, shown, notices, sounds } = setUp();
		carryAlert({ kind: "withdraw", session: "s" }, notices, sounds);
		expect(withdrawn).toEqual(["s"]);
		expect(shown).toEqual([]);
		expect(played).toEqual([]);
	});
});
