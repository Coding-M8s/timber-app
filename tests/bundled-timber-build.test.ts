import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TIMBER_PIN, timberTarget, vendorFolder } from "../src/shared/timber-pin";

const root = fileURLToPath(new URL("..", import.meta.url));

test("the build copies the fetched Timber into the app, even when Electrobun reads the config from another folder", () => {
	const elsewhere = mkdtempSync(join(tmpdir(), "electrobun-config-"));
	try {
		const config = join(root, "electrobun.config.ts");
		const read = Bun.spawnSync([process.execPath, "-e", `console.log(JSON.stringify((await import(${JSON.stringify(config)})).default.build.copy))`], { cwd: elsewhere, stdout: "pipe", stderr: "pipe" });
		expect(read.stderr.toString()).toBe("");
		const copy = JSON.parse(read.stdout.toString()) as Record<string, string>;
		const target = timberTarget(process.platform, process.arch);
		const vendored = target === null ? null : vendorFolder(TIMBER_PIN.version, target);
		if (vendored !== null && existsSync(join(root, vendored))) expect(copy[vendored]).toBe("timber");
		else expect(Object.values(copy)).not.toContain("timber");
	} finally {
		rmSync(elsewhere, { recursive: true, force: true });
	}
});
