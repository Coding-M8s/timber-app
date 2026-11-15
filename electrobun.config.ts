import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Timber",
		// Placeholder identifier. Settle the real one before the first release.
		identifier: "com.codingm8s.timber",
		version: "0.0.1",
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
		},
		// Vite output changes on every interface build. Hot reload handles the view.
		watchIgnore: ["dist/**"],
		mac: { bundleCEF: false },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	},
} satisfies ElectrobunConfig;
