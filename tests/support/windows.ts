import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * Loaded before the test files (see bunfig.toml). It changes nothing on
 * Linux or macOS.
 *
 * On Windows the temporary folder can be given in its short 8.3 form, such
 * as `C:\Users\RUNNER~1\AppData\Local\Temp` on GitHub's runners. Git and
 * Timber print the long form, and `realpathSync` keeps the short one, so a
 * test would compare two spellings of one folder. The long form is put in
 * TEMP and TMP, which `tmpdir()` reads.
 */
if (process.platform === "win32") {
	const long = realpathSync.native(tmpdir());
	process.env.TEMP = long;
	process.env.TMP = long;
}
