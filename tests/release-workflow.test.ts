import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseTagProblem } from "../scripts/check-release-tag";

const root = fileURLToPath(new URL("..", import.meta.url));
const checker = join(root, "scripts/check-release-tag.ts");

interface Step { uses?: string; run?: string; name?: string; with?: Record<string, unknown>; env?: Record<string, string> }
interface Job { "runs-on": string; needs?: string[]; if?: string; permissions?: Record<string, string>; steps: Step[] }
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

test("a version tag starts the release, and changes to the workflow build without releasing", () => {
	expect(release.on.push).toEqual({ tags: ["v*"] });
	expect(release.on.pull_request).toEqual({ paths: [".github/workflows/release.yml", "scripts/check-release-tag.ts"] });
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
		for (const check of ["bun run typecheck", "bun test"]) {
			expect(at(check)).toBeGreaterThan(at("bun install"));
			expect(at(check)).toBeLessThan(at("bun run build"));
		}
	}
});

test("the release waits for both builds, and only it may write", () => {
	expect(release.permissions).toEqual({ contents: "read" });
	expect(release.jobs.release!.needs).toEqual([...builds]);
	expect(release.jobs.release!.permissions).toEqual({ contents: "write" });
	for (const name of builds) expect(release.jobs[name]!.permissions).toBeUndefined();
});

test("each build uploads its installer and fails when the file is missing", () => {
	const uploads = Object.fromEntries(builds.map(name => {
		const upload = release.jobs[name]!.steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
		expect(upload?.with?.["if-no-files-found"]).toBe("error");
		return [name, upload?.with?.path];
	}));
	expect(uploads).toEqual({
		"build-linux": "artifacts/linux-x64-Timber-Setup.tar.gz",
		"build-windows": "artifacts/win-x64-Timber-Setup.zip",
	});
});

test("the release is a draft with both installers and their checksums", () => {
	const script = runs(release.jobs.release!).join("\n");
	expect(script).toContain("sha256sum linux-x64-Timber-Setup.tar.gz win-x64-Timber-Setup.zip > SHA256SUMS.txt");
	expect(script).toContain("gh release create \"$TAG\" --draft --verify-tag");
	expect(script).toContain("linux-x64-Timber-Setup.tar.gz win-x64-Timber-Setup.zip SHA256SUMS.txt");
	// The tag reaches the script through the environment, never pasted into it.
	expect(script).not.toContain("${{");
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

test("CI and the release install the same Timber", () => {
	const timber = (name: string) => Object.values(workflow(name).jobs)
		.flatMap(job => job.steps)
		.flatMap(step => step.env?.TIMBER_VERSION === undefined ? [] : [step.env.TIMBER_VERSION]);
	const ci = timber("ci.yml");
	expect(ci.length).toBe(1);
	expect(timber("release.yml")).toEqual(ci);
});
