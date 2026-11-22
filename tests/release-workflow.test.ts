import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseTagProblem } from "../scripts/check-release-tag";

const root = fileURLToPath(new URL("..", import.meta.url));
const checker = join(root, "scripts/check-release-tag.ts");

interface Step { uses?: string; run?: string; name?: string; shell?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string> }
interface Job { "runs-on": string; needs?: string[]; if?: string; permissions?: Record<string, string>; strategy?: { "fail-fast"?: boolean; matrix?: Record<string, unknown> }; steps: Step[] }
interface Workflow { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> }

function workflow(name: string): Workflow {
	// A Windows checkout may have CRLF line endings.
	const text = readFileSync(join(root, ".github/workflows", name), "utf8").replaceAll("\r\n", "\n");
	return Bun.YAML.parse(text) as Workflow;
}

const release = workflow("release.yml");
const builds = ["build-linux", "build-windows"] as const;

function runs(job: Job): string[] {
	return job.steps.flatMap(step => step.run === undefined ? [] : [step.run.trim()]);
}

test("the release tag must be v and the version in package.json", () => {
	expect(releaseTagProblem("v0.2.0", "0.2.0")).toBeNull();
	expect(releaseTagProblem("v1.0.0-beta.1", "1.0.0-beta.1")).toBeNull();
	expect(releaseTagProblem("v0.2.1", "0.2.0")).toContain("0.2.0");
	expect(releaseTagProblem("0.2.0", "0.2.0")).toContain("v0.2.0");
	expect(releaseTagProblem("", "0.2.0")).toContain("no tag");
	expect(releaseTagProblem("v0.2", "0.2")).toContain("version");
});

test("the tag check exits with 1 and names the mismatch, and 0 on a match", () => {
	const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
	const check = (tag: string) => Bun.spawnSync([process.execPath, checker, tag], { cwd: root, stdout: "pipe", stderr: "pipe" });
	const good = check(`v${version}`);
	expect(good.exitCode).toBe(0);
	const bad = check("v999.0.0");
	expect(bad.exitCode).toBe(1);
	expect(bad.stderr.toString()).toContain(version);
});

test("a version tag starts the release, and changes to the workflow, version, or dependencies build without releasing", () => {
	expect(release.on.push).toEqual({ tags: ["v*"] });
	expect(release.on.pull_request).toEqual({
		paths: [".github/workflows/release.yml", "scripts/check-release-tag.ts", "scripts/fetch-timber.ts", "scripts/bundled-timber-copy.ts", "electrobun.config.ts", "timber-pin.json", "package.json", "bun.lock"],
	});
	expect(release.jobs.release!.if).toBe("startsWith(github.ref, 'refs/tags/v')");
});

test("each platform builds on its own runner, after the checks", () => {
	expect(release.jobs["build-linux"]!["runs-on"]).toStartWith("ubuntu-");
	expect(release.jobs["build-windows"]!["runs-on"]).toStartWith("windows-");
	for (const name of builds) {
		const steps = runs(release.jobs[name]!);
		const at = (command: string) => steps.findIndex(run => run.startsWith(command));
		expect(at("bun install --frozen-lockfile")).toBe(0);
		expect(at("bun scripts/check-release-tag.ts")).toBeGreaterThan(at("bun install"));
		for (const check of ["bun run typecheck", "bun run test"]) {
			expect(at(check)).toBeGreaterThan(at("bun install"));
			expect(at(check)).toBeLessThan(at("bun run build"));
		}
	}
});

test("the tag check reads the tag from the environment through bash on every platform", () => {
	// On Windows a run step is PowerShell by default, where "$TAG" is an empty
	// PowerShell variable, not the environment variable.
	for (const name of builds) {
		const check = release.jobs[name]!.steps.find(step => step.run?.startsWith("bun scripts/check-release-tag.ts"));
		expect(check?.run?.trim()).toBe('bun scripts/check-release-tag.ts "$TAG"');
		expect(check?.shell).toBe("bash");
		expect(check?.env).toEqual({ TAG: "${{ github.ref_name }}" });
	}
});

test("the release waits for both builds, and only it may write", () => {
	expect(release.permissions).toEqual({ contents: "read" });
	expect(release.jobs.release!.needs).toEqual([...builds]);
	expect(release.jobs.release!.permissions).toEqual({ contents: "write" });
	for (const name of builds) expect(release.jobs[name]!.permissions).toBeUndefined();
});

/** What each platform's build makes for a release: its installer, and what installed apps update from. */
const releaseFiles = {
	"build-linux": ["linux-x64-Timber-Setup.tar.gz", "stable-linux-x64-Timber.tar.zst", "stable-linux-x64-update.json", "stable-linux-x64-update-v2.json"],
	"build-windows": ["win-x64-Timber-Setup.zip", "stable-win-x64-Timber.tar.zst", "stable-win-x64-update.json", "stable-win-x64-update-v2.json"],
} as const;

test("each build checks for and uploads its installer and update files, and fails when one is missing", () => {
	for (const name of builds) {
		const steps = release.jobs[name]!.steps;
		const upload = steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
		expect(upload?.with?.["if-no-files-found"]).toBe("error");
		expect(String(upload?.with?.path).trim().split("\n")).toEqual(releaseFiles[name].map(file => `artifacts/${file}`));
		// The upload fails only when none is there, so each update file is looked for first.
		const check = steps.find(step => step.name === "Check the update files");
		expect(check?.run?.trim()).toBe(`ls -l ${releaseFiles[name].slice(1).map(file => `artifacts/${file}`).join(" ")}`);
		expect(steps.indexOf(check!)).toBeLessThan(steps.indexOf(upload!));
	}
});

test("the release is a draft with the installers, the update files, and their checksums", () => {
	const job = release.jobs.release!;
	const files = [releaseFiles["build-linux"][0], releaseFiles["build-windows"][0], ...releaseFiles["build-linux"].slice(1), ...releaseFiles["build-windows"].slice(1)];
	const sums = job.steps.find(step => step.name === "Write the checksums")!;
	expect(sums.run?.trim()).toBe("sha256sum $FILES > SHA256SUMS.txt");
	expect(sums.env?.FILES?.trim().split(/\s+/)).toEqual(files);
	const create = job.steps.find(step => step.name === "Create the draft release")!;
	expect(create.env?.FILES?.trim().split(/\s+/)).toEqual(files);
	expect(create.run).toContain("gh release create \"$TAG\" --draft --verify-tag");
	expect(create.run).toContain("$FILES SHA256SUMS.txt");
	// The tag reaches the script through the environment, never pasted into it.
	expect(runs(job).join("\n")).not.toContain("${{");
});

test("installed apps look for updates in the newest published release, and download whole bundles", () => {
	// Read as text: the configuration imports Electrobun's types, which only the desktop typecheck has.
	const config = readFileSync(join(root, "electrobun.config.ts"), "utf8");
	expect(config).toContain('baseUrl: "https://github.com/Coding-M8s/timber-app/releases/latest/download",');
	expect(config).toContain("generatePatch: false,");
});

test("every action in every workflow is pinned to a commit", () => {
	for (const name of ["ci.yml", "release.yml"]) {
		for (const job of Object.values(workflow(name).jobs)) {
			for (const step of job.steps) {
				if (step.uses !== undefined) expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
			}
		}
	}
});

test("CI and the release test with the Timber the app bundles", () => {
	const installs = (name: string) => Object.values(workflow(name).jobs)
		.flatMap(job => job.steps)
		.filter(step => step.name === "Install Timber");
	for (const name of ["ci.yml", "release.yml"]) {
		const steps = installs(name);
		expect(steps).toHaveLength(1);
		expect(steps[0]!.run?.trim()).toBe("bun scripts/fetch-timber.ts --add-to-path");
		expect(steps[0]!.env?.TIMBER_VERSION).toBeUndefined();
	}
});

test("CI runs the tests in three parallel shards with Timber installed, and check passes only when every shard and the build did", () => {
	const ci = workflow("ci.yml");
	const scripts = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
	expect(scripts.test).toBe("bun test --parallel=4 --timeout=30000 --timings tests/timings.json");
	expect(scripts["test:serial"]).toBe("bun test --timeout=30000");

	const shards = ci.jobs.test!;
	expect(shards.strategy).toEqual({ "fail-fast": false, matrix: { shard: [1, 2, 3] } });
	const steps = runs(shards);
	const at = (command: string) => steps.findIndex(run => run.startsWith(command));
	expect(at("bun run test --shard=${{ matrix.shard }}/3")).toBe(steps.length - 1);
	expect(at("bun scripts/fetch-timber.ts --add-to-path")).toBeGreaterThan(at("bun install"));
	expect(at("bun scripts/fetch-timber.ts --add-to-path")).toBeLessThan(at("bun run test"));
	expect(runs(ci.jobs.build!)).toEqual(["bun install --frozen-lockfile", "bun run typecheck", "bun run build:web"]);

	// The main ruleset requires "check" and "typecheck-desktop" by name.
	expect(ci.jobs["typecheck-desktop"]).toBeDefined();
	const check = ci.jobs.check!;
	expect(check.needs).toEqual(["test", "build"]);
	expect(check.if).toBe("always()");
	expect(check.steps[0]!.env).toEqual({ RESULTS: "${{ join(needs.*.result, ' ') }}" });
	expect(check.steps[0]!.run).toContain('test "$result" = success || { echo "A required CI job finished with: $result" >&2; exit 1; }');
	expect(runs(ci.jobs["test-windows"]!)).toContain("bun run test");
});

test("every desktop build fetches and checks the pinned Timber before it builds", () => {
	const scripts = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
	for (const name of ["build", "build:canary"]) {
		const steps = scripts[name]!.split(" && ");
		expect(steps).toContain("bun scripts/fetch-timber.ts");
		// First: `electrobun prepare` already reads electrobun.config.ts, which looks for the fetched Timber.
		expect(steps[0]).toBe("bun scripts/fetch-timber.ts");
	}
	expect(release.on.pull_request).toMatchObject({ paths: expect.arrayContaining(["timber-pin.json", "scripts/fetch-timber.ts", "scripts/bundled-timber-copy.ts"]) });
});

test("a release build fails rather than ship without its Timber", () => {
	for (const name of builds) {
		const build = release.jobs[name]!.steps.filter(step => step.run?.trim() === "bun run build");
		expect(build).toHaveLength(1);
		expect(build[0]!.env?.TIMBER_APP_REQUIRE_BUNDLED_TIMBER).toBe("1");
	}
});
