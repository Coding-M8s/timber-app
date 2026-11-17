import type { ElectrobunConfig } from "electrobun";
import { APP_DESCRIPTION, APP_IDENTIFIER, APP_NAME, APP_VERSION } from "./src/shared/app-info";

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
		},
		// Vite output changes on every interface build. Hot reload handles the view.
		watchIgnore: ["dist/**"],
		// Made from the logo by `bun run icons`.
		mac: { bundleCEF: false, icons: "icons/icon.iconset" },
		linux: { bundleCEF: false, icon: "icons/icon.png" },
		win: { bundleCEF: false, icon: "icons/icon.ico" },
	},
} satisfies ElectrobunConfig;
