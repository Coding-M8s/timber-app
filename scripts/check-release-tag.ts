// Checks that a release tag names the version the build stamps into the app,
// which is the version in package.json. Used by .github/workflows/release.yml:
//   bun scripts/check-release-tag.ts v0.2.0
import manifest from "../package.json";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/** What is wrong with releasing `tag` from a package at `version`, or null when nothing is. */
export function releaseTagProblem(tag: string, version: string): string | null {
	if (!VERSION.test(version)) return `package.json has version "${version}", which is not a release version such as 1.2.3.`;
	if (tag === "") return `There is no tag. Expected v${version}.`;
	if (tag !== `v${version}`) return `The tag is ${tag}, but package.json has version ${version}. Expected the tag v${version}.`;
	return null;
}

if (import.meta.main) {
	const problem = releaseTagProblem(process.argv[2] ?? "", manifest.version);
	if (problem !== null) {
		console.error(problem);
		process.exit(1);
	}
	console.log(`The tag matches version ${manifest.version}.`);
}
