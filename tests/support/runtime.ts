/** Whether the tests run on Windows. */
export const windows = process.platform === "win32";

/** Wait until `check` holds, for at most `milliseconds`, and say whether it held. */
export async function until(check: () => boolean | Promise<boolean>, milliseconds = 5000): Promise<boolean> {
	const end = Date.now() + milliseconds;
	while (Date.now() < end) {
		if (await check()) return true;
		await Bun.sleep(20);
	}
	return check();
}
