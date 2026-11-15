import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Alias } from "vite";

const projectRoot = import.meta.dirname;
const devkitRoot = resolve(projectRoot, ".hutch/devkit");

function exactImport(specifier: string): RegExp {
	return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

/**
 * `electrobun prepare` projects the Electrobun SDK into .hutch/devkit, and its
 * package.json export map says where each `electrobun/...` import lives.
 * Without the devkit (browser-only work, CI) the desktop bridge resolves to a
 * stub, so the interface still builds and runs against the mock engine.
 */
function electrobunAliases(): Alias[] {
	const manifestPath = resolve(devkitRoot, "package.json");
	if (!existsSync(manifestPath)) {
		return [{
			find: exactImport("electrobun/view"),
			replacement: resolve(projectRoot, "src/mainview/engine/electrobun-view.stub.ts"),
		}];
	}
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { exports?: Record<string, unknown> };
	return Object.entries(manifest.exports ?? {}).flatMap(([subpath, target]) => {
		if (typeof target !== "string" || !target.startsWith("./api/")) return [];
		const specifier = subpath === "." ? "electrobun" : `electrobun/${subpath.slice(2)}`;
		return [{ find: exactImport(specifier), replacement: resolve(devkitRoot, target) }];
	});
}

export default defineConfig({
	plugins: [react()],
	resolve: { alias: electrobunAliases() },
	root: "src/mainview",
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
