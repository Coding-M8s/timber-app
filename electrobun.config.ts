import type { ElectrobunConfig } from "electrobun";
import { fileURLToPath } from "node:url";
import { APP_DESCRIPTION, APP_IDENTIFIER, APP_NAME, APP_VERSION } from "./src/shared/app-info";
import { TIMBER_PIN } from "./src/shared/timber-pin";
import { REQUIRE_BUNDLED_TIMBER_VARIABLE, bundledTimberCopy } from "./scripts/bundled-timber-copy";

/**
 * On Windows, node-pty and the ConPTY it ships run the terminal sessions
 * (src/bun/pseudo-terminal.ts). The main process requires it at run time, so
 * only what Windows needs is copied beside the bundle, where that require
 * finds it: its JavaScript, and the prebuilt files for this machine's
 * architecture without their debug symbols.
 */
const NODE_PTY = "node_modules/node-pty";
const PREBUILT = `prebuilds/win32-${process.arch}`;
const nodePty: Record<string, string> = process.platform !== "win32" ? {} : Object.fromEntries(
	["package.json", "lib", `${PREBUILT}/conpty.node`, `${PREBUILT}/conpty_console_list.node`, `${PREBUILT}/conpty`]
		.map(path => [`${NODE_PTY}/${path}`, `bun/${NODE_PTY}/${path}`]),
);

/**
 * The pinned Timber, with its license and notices, goes into the app as
 * `timber`, beside the main process's `bun` folder, where
 * `bundledTimberFolder` (src/bun/timber.ts) looks. `bun run build` fetches
 * and checks it first (scripts/fetch-timber.ts), and stops when a checksum
 * does not match. A development build that never fetched it has none, and
 * uses the timber on PATH; a release build sets
 * TIMBER_APP_REQUIRE_BUNDLED_TIMBER, which makes a missing one an error.
 * Only the folder of the pinned version counts, so one left from an earlier
 * pin is never copied.
 */
const timber = bundledTimberCopy(
	TIMBER_PIN,
	fileURLToPath(new URL(".", import.meta.url)),
	process.platform,
	process.arch,
	process.env[REQUIRE_BUNDLED_TIMBER_VARIABLE] === "1",
);

export default {
	app: {
		name: APP_NAME,
		// Final. It names the install folder and where updates look, so it must not change after a release.
		identifier: APP_IDENTIFIER,
		// Written once, in package.json.
		version: APP_VERSION,
		description: APP_DESCRIPTION,
	},
	build: {
		mainProcess: "bun",
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		// Vite builds the interface into dist/, and Electrobun copies it into the bundle.
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			// The licenses of the bundled fonts and of the logo travel with every build.
			licenses: "licenses",
			...nodePty,
			...timber,
		},
		// Vite output changes on every interface build. Hot reload handles the view.
		watchIgnore: ["dist/**"],
		// Made from the logo by `bun run icons`.
		mac: { bundleCEF: false, icons: "icons/icon.iconset" },
		linux: { bundleCEF: false, icon: "icons/icon.png" },
		win: { bundleCEF: false, icon: "icons/icon.ico" },
	},
} satisfies ElectrobunConfig;
