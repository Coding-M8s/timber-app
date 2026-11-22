import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Alias, type Plugin } from "vite";
import { FILE_ICONS_PATH, iconIds } from "./src/mainview/file-icons";

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

/**
 * The Files panel's icons (see src/mainview/file-icons.ts): the dev server
 * serves each SVG from the material-icon-theme package, and the build copies
 * them into dist/assets, so they travel with the app and each loads only
 * when a row shows it. They are files, never inlined in the bundle.
 */
function fileIcons(): Plugin {
	const packageRoot = resolve(projectRoot, "node_modules/material-icon-theme");
	const manifest = JSON.parse(readFileSync(resolve(packageRoot, "dist/material-icons.json"), "utf8")) as { iconDefinitions: Record<string, { iconPath: string }> };
	const ids = new Set(iconIds());
	const fileOf = (id: string): string | null => {
		const definition = ids.has(id) ? manifest.iconDefinitions[id] : undefined;
		return definition ? resolve(packageRoot, "dist", definition.iconPath) : null;
	};
	return {
		name: "timber-file-icons",
		configureServer(server) {
			server.middlewares.use(`/${FILE_ICONS_PATH}/`, (request, response, next) => {
				const match = /^\/([^/?]+)\.svg(?:\?.*)?$/.exec(request.url ?? "");
				const file = match ? fileOf(decodeURIComponent(match[1]!)) : null;
				if (file === null) return next();
				response.setHeader("Content-Type", "image/svg+xml");
				response.end(readFileSync(file));
			});
		},
		generateBundle() {
			for (const id of ids) {
				const file = fileOf(id);
				if (file === null) throw new Error(`The icon ${id} has no file in material-icon-theme.`);
				this.emitFile({ type: "asset", fileName: `${FILE_ICONS_PATH}/${id}.svg`, source: readFileSync(file) });
			}
		},
	};
}

export default defineConfig({
	plugins: [react(), fileIcons()],
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
