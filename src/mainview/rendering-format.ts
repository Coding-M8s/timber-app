import type { DmabufChoice, RenderingStatus } from "../shared/rendering";

export const DMABUF_CHOICE_LABELS: Record<DmabufChoice, string> = {
	auto: "Auto",
	on: "On",
	off: "Off",
};

/**
 * The line under the choice: what this run uses and why, and when a change
 * takes effect. `saved` is the choice saved now, which may differ from the
 * one the app started with.
 */
export function describeRendering(status: RenderingStatus | null, saved: DmabufChoice): string {
	if (status === null) return "Takes effect the next time the app starts.";
	if (!status.applies) return "Only used on Linux, where the app draws with WebKitGTK. It has no effect here.";
	const now = status.dmabuf ? "on" : "off";
	if (status.decidedBy === "variable") {
		return `Now: ${now}, because WEBKIT_DISABLE_DMABUF_RENDERER was set when the app started. That variable wins over this setting.`;
	}
	const why = status.decidedBy === "auto"
		? (status.dmabuf ? "Auto kept WebKitGTK's default" : "Auto found Intel graphics only")
		: "as chosen";
	const pending = saved !== status.choice ? " Restart the app to use the saved choice." : " A change takes effect the next time the app starts.";
	return `Now: ${now}, ${why}.${pending}`;
}
