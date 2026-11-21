// What electrobun.config.ts copies for the bundled Timber: the folder that
// scripts/fetch-timber.ts filled for the pinned version and this platform,
// into the app as `timber`. See docs/architecture.md, "The bundled Timber".
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type TimberPin, timberTarget, vendorFolder } from "../src/shared/timber-pin";

/** Set by the release workflow, so a release can never be built without its Timber. */
export const REQUIRE_BUNDLED_TIMBER_VARIABLE = "TIMBER_APP_REQUIRE_BUNDLED_TIMBER";

/**
 * The copy entry for the bundled Timber, or none when the platform has no
 * Timber binary or the folder was never fetched. `root` is the repository,
 * named outright because Electrobun reads the config from a folder of its
 * own. With `required`, a missing Timber is an error instead.
 */
export function bundledTimberCopy(pin: TimberPin, root: string, platform: string, arch: string, required: boolean): Record<string, string> {
	const target = timberTarget(platform, arch);
	if (target === null) {
		if (required) throw new Error(`${REQUIRE_BUNDLED_TIMBER_VARIABLE} is set, but Timber publishes no binary for ${platform}-${arch}.`);
		return {};
	}
	const folder = vendorFolder(pin.version, target);
	if (existsSync(join(root, folder))) return { [folder]: "timber" };
	if (required) throw new Error(`${REQUIRE_BUNDLED_TIMBER_VARIABLE} is set, but ${folder} is missing. Run bun scripts/fetch-timber.ts first.`);
	return {};
}
