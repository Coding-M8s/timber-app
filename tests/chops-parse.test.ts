import { describe, expect, test } from "bun:test";
import {
	CHOP_LIMIT, CHOP_TEXT_LIMIT, type Chop, type PersonalChop, chopProblem, mergeChops, parseChopsFile, readPersonalChops, salvagePersonalChops, samePersonalChops,
	writePersonalChops,
} from "../src/shared/chops";
import {
	addChopDraft, chopAgentOptions, chopDraftsOf, chopScopeOptions, chopsDraftModel, describeChopsFile, editChopDraft, removeChopDraft,
} from "../src/mainview/chop-format";
import { defaultPreferences, readPreferences, writePreferences } from "../src/shared/preferences";

const REPO = "/work/app";
const command = (name: string, text = "bun test"): Chop => ({ name, kind: "command", text, description: "", agent: null });
const prompt = (name: string, text = "Review the diff", agent: string | null = null): Chop => ({ name, kind: "prompt", text, description: "", agent });
const mine = (chop: Chop, repository: string | null = null): PersonalChop => ({ ...chop, repository, sound: null });
const file = (chops: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, chops, ...extra });

describe("one chop", () => {
	test("can be saved with a clean name, a kind, and text", () => {
		expect(chopProblem(command("Test"), [])).toBeNull();
		expect(chopProblem(prompt("Review", "Line one\n\tLine two", "Claude Code"), [])).toBeNull();
	});

	test("says what is wrong with it", () => {
		expect(chopProblem(command(""), [])).toBe("Give the chop a name.");
		expect(chopProblem(command(" Test"), [])).toContain("extra spaces");
		expect(chopProblem(command("x".repeat(41)), [])).toContain("40 characters");
		expect(chopProblem(command("test"), ["Test"])).toBe(`Another chop is already called "test".`);
		expect(chopProblem(command("\u00e9t\u00e9"), ["e\u0301te\u0301"])).toContain("already called");
		expect(chopProblem(command("Test", "  \n "), [])).toBe("Type the command.");
		expect(chopProblem(prompt("Review", ""), [])).toBe("Type the prompt.");
		expect(chopProblem(command("Test", "x".repeat(CHOP_TEXT_LIMIT + 1)), [])).toContain(`${CHOP_TEXT_LIMIT} characters`);
		expect(chopProblem({ ...command("Test"), agent: "Codex" }, [])).toContain("Only a prompt goes to an agent");
		expect(chopProblem(prompt("Review", "go", " Codex"), [])).toContain("not one an agent can have");
		expect(chopProblem({ ...command("Test"), description: "two\nlines" }, [])).toContain("one line");
		expect(chopProblem({ ...command("Test"), kind: "script" as never }, [])).toBe("The kind must be command or prompt.");
	});

	test("refuses text that could end a bracketed paste early or hide what it says", () => {
		for (const text of ["echo \u001b[201~ rm -rf ~", "bell\u0007", "a\rb", "del\u007f", "c1\u009b", "evil\u202ename", "isolate\u2066x", "zero\u200bwidth", "tag\u{e0041}", "line\u2028sep", "lone\ud800"]) {
			expect(chopProblem(command("Test", text), [])).not.toBeNull();
		}
		expect(chopProblem(command("Test", "tabs\tand\nlines are fine"), [])).toBeNull();
		expect(chopProblem(command("Test", "emoji \u{1f468}\u200d\u{1f4bb} are fine"), [])).toBeNull();
		expect(chopProblem({ ...command("Test"), description: "tag\u{e0041}" }, [])).not.toBeNull();
	});

	test("an agent no one has is still a valid prompt", () => {
		expect(chopProblem(prompt("Review", "go", "Some agent from another machine"), [])).toBeNull();
	});
});

describe("the personal chops preference", () => {
	test("round-trips through the settings file, leaving out empty optional fields", () => {
		const chops = [mine(command("Test")), mine({ ...prompt("Review", "go", "Codex"), description: "Ask for a review" }, REPO)];
		const written = writePersonalChops(chops);
		expect(written).toEqual([
			{ name: "Test", kind: "command", text: "bun test" },
			{ name: "Review", kind: "prompt", text: "go", description: "Ask for a review", agent: "Codex", repository: REPO },
		]);
		expect(readPersonalChops(JSON.parse(JSON.stringify(written)))).toEqual(chops);
		expect(readPreferences(writePreferences({ ...defaultPreferences(), chops })).chops).toEqual(chops);
	});

	test("is empty until some are saved", () => {
		expect(defaultPreferences().chops).toEqual([]);
	});

	test("names must differ within a repository, or within every repository, but may repeat across them", () => {
		expect(readPersonalChops([mine(command("Test")), mine(command("Test"), REPO), mine(command("Test"), "/work/other")])).toHaveLength(3);
		expect(readPersonalChops([mine(command("Test"), REPO), mine(command("test"), REPO)])).toBeUndefined();
		expect(readPersonalChops([mine(command("Test")), mine(command("TEST"))])).toBeUndefined();
	});

	test("a save is taken whole or not at all", () => {
		expect(readPersonalChops([mine(command("Test")), { name: "Bad", kind: "command", text: "" }])).toBeUndefined();
		expect(readPersonalChops([mine(command("Test")), { ...mine(command("x")), repository: "" }])).toBeUndefined();
		expect(readPersonalChops(Array.from({ length: CHOP_LIMIT + 1 }, (_, index) => mine(command(`C${index}`))))).toBeUndefined();
		expect(readPersonalChops("nope")).toBeUndefined();
	});

	test("a damaged entry in the settings file costs only itself", () => {
		const value = [mine(command("Test")), { name: "Bad", kind: "command", text: "" }, mine(prompt("Review"))];
		expect(salvagePersonalChops(value)).toEqual([mine(command("Test")), mine(prompt("Review"))]);
		expect(readPreferences({ chops: value }).chops).toEqual([mine(command("Test")), mine(prompt("Review"))]);
		expect(readPreferences({ chops: "nope" }).chops).toEqual([]);
	});

	test("Windows line endings are kept as \\n", () => {
		expect(readPersonalChops([{ name: "Two", kind: "command", text: "one\r\ntwo" }])?.[0]?.text).toBe("one\ntwo");
	});

	test("are compared field by field and in order", () => {
		const one = [mine(command("A")), mine(command("B"))];
		expect(samePersonalChops(one, [mine(command("A")), mine(command("B"))])).toBe(true);
		expect(samePersonalChops(one, [mine(command("B")), mine(command("A"))])).toBe(false);
		expect(samePersonalChops(one, [mine(command("A")), mine(command("B"), REPO)])).toBe(false);
	});
});

describe("the repository file", () => {
	test("reads every chop, with optional fields filled in and unknown keys passed over", () => {
		const text = `\ufeff${file([
			{ name: "Test", kind: "command", text: "bun test", future: true },
			{ name: "Review", kind: "prompt", text: "Review this\r\nplease", description: "A review", agent: "Claude Code" },
		], { newer: 2 })}`;
		expect(parseChopsFile(text)).toEqual({ ok: true, chops: [command("Test"), { ...prompt("Review", "Review this\nplease", "Claude Code"), description: "A review" }] });
		expect(parseChopsFile(file([]))).toEqual({ ok: true, chops: [] });
	});

	test("is read whole or not at all, with a reason that names the entry", () => {
		expect(parseChopsFile("{ nope")).toEqual({ ok: false, message: "It is not JSON." });
		expect(parseChopsFile("[]")).toMatchObject({ ok: false });
		expect(parseChopsFile(JSON.stringify({ version: 2, chops: [] }))).toEqual({ ok: false, message: `Its "version" is not 1.` });
		expect(parseChopsFile(JSON.stringify({ version: 1 }))).toEqual({ ok: false, message: `Its "chops" is not a list.` });
		expect(parseChopsFile(file([command("Test"), { name: "Lint", kind: "script", text: "x" }]))).toEqual({ ok: false, message: `Chop 2 ("Lint"): The kind must be "command" or "prompt".` });
		expect(parseChopsFile(file([command("Test"), command("test")]))).toEqual({ ok: false, message: `Chop 2 ("test"): Another chop is already called "test".` });
		expect(parseChopsFile(file([{ ...command("Test"), agent: "Codex" }]))).toMatchObject({ ok: false, message: expect.stringContaining("Only a prompt") });
		expect(parseChopsFile(file([command("Test", "echo \u001b[201~")]))).toMatchObject({ ok: false, message: expect.stringContaining("control or invisible character") });
		expect(parseChopsFile(file(Array.from({ length: CHOP_LIMIT + 1 }, (_, index) => command(`C${index}`))))).toMatchObject({ ok: false });
	});

	test("a reason never quotes what the file holds", () => {
		const secret = "Host secret.example.com IdentityFile ~/.ssh/key";
		const reading = parseChopsFile(secret);
		expect(reading).toEqual({ ok: false, message: "It is not JSON." });
		const long = parseChopsFile(file([{ name: "x".repeat(50_000), kind: "command", text: "x" }]));
		expect(long.ok === false && long.message.length).toBeLessThan(200);
		const escape = parseChopsFile(file([{ name: "Review", kind: "prompt", text: "x", agent: "a\u001b]0;x\u0007" }]));
		expect(escape.ok === false && escape.message).not.toContain("\u001b");
		expect(escape.ok === false && escape.message).not.toContain("]0;x");
	});
});

describe("merging", () => {
	const fileChops = [command("Test", "bun test"), command("Lint", "bun run lint"), prompt("Review")];

	test("a personal chop overrides the file's chop with the same name, ignoring case", () => {
		const merged = mergeChops([mine(command("test", "bun test --watch"))], REPO, fileChops);
		expect(merged.chops.map(chop => [chop.name, chop.source])).toEqual([["test", "personal-every"], ["Lint", "repository-file"], ["Review", "repository-file"]]);
		expect(merged.overridden).toEqual([{ ...command("Test", "bun test"), source: "repository-file", sound: null, by: "personal-every" }]);
	});

	test("a personal chop for this repository wins over one for every repository, which is then left out", () => {
		const merged = mergeChops([mine(command("Test", "every")), mine(command("Test", "here"), REPO)], REPO, fileChops);
		expect(merged.chops.filter(chop => chop.name === "Test")).toEqual([{ ...command("Test", "here"), source: "personal-repository", sound: null }]);
		expect(merged.overridden).toEqual([{ ...command("Test", "bun test"), source: "repository-file", sound: null, by: "personal-repository" }]);
	});

	test("lists personal chops for this repository, then for every repository, then the file's, and leaves out other repositories", () => {
		const merged = mergeChops([mine(command("Every")), mine(command("Other"), "/work/other"), mine(command("Here"), REPO)], REPO, [command("Shared")]);
		expect(merged.chops.map(chop => chop.name)).toEqual(["Here", "Every", "Shared"]);
		expect(merged.overridden).toEqual([]);
	});

	test("with no file, only personal chops are listed", () => {
		expect(mergeChops([mine(command("Test"))], REPO, [])).toEqual({ chops: [{ ...command("Test"), source: "personal-every", sound: null }], overridden: [] });
	});
});

describe("the rows of Settings, Chops", () => {
	test("save what was typed, with names cleaned and the agent only for a prompt", () => {
		let drafts = addChopDraft([]);
		const key = drafts[0]!.key;
		drafts = editChopDraft(drafts, key, { name: "  Review   it ", kind: "prompt", text: "go", description: " Ask ", agent: "Codex", repository: REPO, sound: null });
		expect(chopsDraftModel(drafts, [])).toMatchObject({ canSave: true, chops: [{ name: "Review it", kind: "prompt", text: "go", description: "Ask", agent: "Codex", repository: REPO, sound: null }] });
		drafts = editChopDraft(drafts, key, { kind: "command" });
		expect(chopsDraftModel(drafts, []).chops[0]!.agent).toBeNull();
	});

	test("cannot be saved with a problem, when nothing changed, or past the limit", () => {
		const saved = [mine(command("Test"))];
		expect(chopsDraftModel(chopDraftsOf(saved), saved).canSave).toBe(false);
		const blank = addChopDraft(chopDraftsOf(saved));
		expect(chopsDraftModel(blank, saved)).toMatchObject({ canSave: false, rows: [{ problem: null }, { problem: "Give the chop a name." }] });
		const twice = editChopDraft(blank, blank[1]!.key, { name: "test", text: "x" });
		expect(chopsDraftModel(twice, saved).rows[1]!.problem).toContain("already called");
		const elsewhere = editChopDraft(twice, blank[1]!.key, { repository: REPO });
		expect(chopsDraftModel(elsewhere, saved).canSave).toBe(true);
		const many = Array.from({ length: CHOP_LIMIT + 1 }, (_, index) => mine(command(`C${index}`)));
		expect(chopsDraftModel(chopDraftsOf(many), []).error).toContain(`${CHOP_LIMIT} chops at most`);
		expect(chopsDraftModel(removeChopDraft(blank, blank[1]!.key), saved).canSave).toBe(false);
	});

	test("keep a repository that left the list, and an agent no one has, as choices for the row that names them", () => {
		const repositories = [{ path: REPO, name: "app" }];
		expect(chopScopeOptions(repositories, null)).toEqual([{ value: "", label: "Every repository" }, { value: REPO, label: "app" }]);
		expect(chopScopeOptions(repositories, "/work/gone").at(-1)).toEqual({ value: "/work/gone", label: "/work/gone (not in the list)" });
		expect(chopAgentOptions([{ name: "Codex" }], "Aider")).toEqual([{ value: "", label: "First saved agent" }, { value: "Codex", label: "Codex" }, { value: "Aider", label: "Aider (no such agent)" }]);
	});

	test("say nothing when the file was read, a hint when it is missing, and the reason when it is damaged", () => {
		const path = "/work/app/.timber/chops.json";
		expect(describeChopsFile({ state: "read" }, path)).toBeNull();
		expect(describeChopsFile({ state: "missing" }, path)).toMatchObject({ tone: "hint" });
		expect(describeChopsFile({ state: "damaged", message: "It is not JSON." }, path)).toEqual({ tone: "problem", text: `The app could not use ${path}: It is not JSON. Your own chops still work.` });
	});
});
