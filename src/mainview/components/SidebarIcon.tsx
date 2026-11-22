import { type ReactNode, useState } from "react";
import { type BundledIconName, type SidebarIcon, iconImageUrl } from "../../shared/sidebar-icons";

/** The drawing of each bundled icon, on a 16 by 16 grid, in lines of the text color. */
const GLYPHS: Record<BundledIconName, ReactNode> = {
	folder: <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />,
	briefcase: <><rect x="2" y="5" width="12" height="8" rx="1.5" /><path d="M6 5V3.5h4V5M2 8.5h12" /></>,
	home: <path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3v-3h2v3h3V6.5" />,
	star: <path d="m8 2.5 1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.2 4.6 13l.7-3.8-2.8-2.7 3.8-.5z" />,
	heart: <path d="M8 13s-5-3.1-5-6.6A2.6 2.6 0 0 1 8 5a2.6 2.6 0 0 1 5 1.4C13 9.9 8 13 8 13z" />,
	code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3l-2 10" />,
	book: <path d="M3 3.5h4a1 1 0 0 1 1 1V13a1 1 0 0 0-1-1H3zM13 3.5H9a1 1 0 0 0-1 1V13a1 1 0 0 1 1-1h4z" />,
	flask: <path d="M6.5 2.5h3M7 2.5v4L3.2 12a1 1 0 0 0 .8 1.5h8a1 1 0 0 0 .8-1.5L9 6.5v-4M5 10h6" />,
	globe: <><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.5 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10 5.7 8S6.4 4.1 8 2.5z" /></>,
	rocket: <path d="M9.5 2.5c2.5 0 4 1.5 4 4L9 11 5 7zM5 7 3 7.5 2 10l2.5-.5M9 11l-.5 2L6 14l.5-2.5M6.5 9.5 4 12" />,
	bug: <><rect x="5" y="5" width="6" height="8" rx="3" /><path d="M6 5.5 5 3.5M10 5.5l1-2M2.5 8.5H5M11 8.5h2.5M3 12l2-1M13 12l-2-1M8 7v6" /></>,
	box: <path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11zM2.5 5 8 7.5 13.5 5M8 7.5v6" />,
};

/** What each bundled icon is called, for the dialog's buttons and assistive technology. */
export const GLYPH_NAMES: Record<BundledIconName, string> = {
	folder: "Folder", briefcase: "Briefcase", home: "Home", star: "Star", heart: "Heart", code: "Code",
	book: "Book", flask: "Flask", globe: "Globe", rocket: "Rocket", bug: "Bug", box: "Box",
};

export function BundledGlyph({ name, size = 14 }: { name: BundledIconName; size?: number }) {
	return (
		<svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
			{GLYPHS[name]}
		</svg>
	);
}

/**
 * A repository's or group's icon, before its name. Only a picture: the name
 * beside it says what it is, so it is hidden from assistive technology. An
 * image the window cannot draw shows nothing rather than a broken picture.
 */
export function SidebarIconView({ icon, className = "sidebar-icon", size = 14 }: { icon: SidebarIcon | null; className?: string; size?: number }) {
	const [broken, setBroken] = useState<string | null>(null);
	if (!icon) return null;
	if (icon.kind === "bundled") return <span className={`${className} bundled`} aria-hidden="true"><BundledGlyph name={icon.name} size={size} /></span>;
	if (broken === icon.data) return null;
	return (
		<span className={`${className} image`} aria-hidden="true">
			<img src={iconImageUrl(icon)} alt="" width={size} height={size} draggable={false} onError={() => setBroken(icon.data)} />
		</span>
	);
}
