/**
 * How WebKitGTK hands finished frames to the window on Linux: through
 * DMA-BUF, its default, or by copying them through shared memory. Which is
 * smoother depends on the machine, so it is a setting. Everything here is pure.
 */

/** The person's choice: decide by the graphics found, or always on, or always off. */
export const DMABUF_CHOICES = ["auto", "on", "off"] as const;
export type DmabufChoice = typeof DMABUF_CHOICES[number];

/** The variable WebKitGTK reads when it starts. "1" turns the DMA-BUF renderer off. */
export const DMABUF_VARIABLE = "WEBKIT_DISABLE_DMABUF_RENDERER";

/** The PCI vendor id of Intel, as Linux writes it in /sys/class/drm/renderD and then a number, /device/vendor. */
export const INTEL_VENDOR = "0x8086";

export function readDmabufChoice(value: unknown): DmabufChoice | undefined {
	return DMABUF_CHOICES.includes(value as DmabufChoice) ? value as DmabufChoice : undefined;
}

/** What the app did about the renderer when it started. */
export type RenderingStatus =
	/** Not Linux: WebKitGTK is not used, so there is nothing to choose. */
	| { applies: false }
	| {
		applies: true;
		/** Whether the DMA-BUF renderer is on in this run. */
		dmabuf: boolean;
		/** What decided it: the environment variable set before start, the saved choice, or Auto by the graphics found. */
		decidedBy: "variable" | "choice" | "auto";
		/** The choice that was saved when the app started. */
		choice: DmabufChoice;
	};

/**
 * What Auto picks for these graphics devices, given by PCI vendor id. Off
 * only when every device is Intel: there the DMA-BUF renderer lagged, and
 * copying was smooth. With any other device, or none found, WebKitGTK's own
 * default stays, which was smooth on a machine with Intel and NVIDIA graphics.
 */
export function autoDmabuf(vendors: readonly string[]): boolean {
	const intelOnly = vendors.length > 0 && vendors.every(vendor => vendor.trim().toLowerCase() === INTEL_VENDOR);
	return !intelOnly;
}

/**
 * Decide the renderer at start, and the variables to set for it. A value of
 * the variable already in the environment wins, even an empty one, so it can
 * still be tried from a terminal. Then the saved choice, and for Auto the
 * graphics devices, read only when needed.
 */
export function decideRendering(
	platform: NodeJS.Platform,
	environment: Record<string, string | undefined>,
	choice: DmabufChoice,
	vendors: () => readonly string[],
): { status: RenderingStatus; variables: Record<string, string> } {
	if (platform !== "linux") return { status: { applies: false }, variables: {} };
	const preset = environment[DMABUF_VARIABLE];
	if (preset !== undefined) {
		// WebKitGTK turns the renderer off for any value but "0", an empty one included.
		return { status: { applies: true, dmabuf: preset === "0", decidedBy: "variable", choice }, variables: {} };
	}
	const dmabuf = choice === "auto" ? autoDmabuf(vendors()) : choice === "on";
	const status: RenderingStatus = { applies: true, dmabuf, decidedBy: choice === "auto" ? "auto" : "choice", choice };
	return { status, variables: dmabuf ? {} : { [DMABUF_VARIABLE]: "1" } };
}
