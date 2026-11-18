import { type ReactNode, useId } from "react";
import { type AboutRow, aboutRows } from "../../about-format";
import logoUrl from "../../assets/logo.png";
import { useAppState } from "../../store/react";
import { UninstallPanel } from "./UninstallPanel";

/** The About section as drawn from its data, so it can be tested without a window. `uninstall` is what shows under Uninstall. */
export function AboutSectionView({ rows, uninstall }: { rows: readonly AboutRow[]; uninstall?: ReactNode }) {
	const titleId = useId();
	return (
		<section className="settings-section" aria-labelledby={titleId}>
			<h3 id={titleId} className="settings-section-title">About</h3>
			<div className="about-head">
				<img className="about-logo" src={logoUrl} alt="" width={48} height={48} />
				<dl className="about-rows">
					{rows.map(row => (
						<div key={row.label} className="about-row">
							<dt className="about-label">{row.label}</dt>
							<dd className="about-value">
								<span className={row.mono ? "mono" : undefined}>{row.value}</span>
								{row.note !== null && <span className="about-note mono">{row.note}</span>}
							</dd>
						</div>
					))}
				</dl>
			</div>
			<h4 className="about-subtitle">Licenses</h4>
			<p className="about-text">
				The app is set in Geist and Geist Mono, copyright Vercel in collaboration with basement.studio, used under the SIL Open Font License 1.1. Both typefaces are built in, so nothing is fetched from the network.
			</p>
			<p className="about-text">
				The Catppuccin, Gruvbox, Nord, and Solarized themes use those palettes' colors under the MIT License, copyright their authors.
			</p>
			<p className="about-text">
				The Timber logo is copyright Coding-M8s, all rights reserved. The license of the app's code does not cover it.
			</p>
			<p className="about-text">The full texts are in the licenses folder inside the installed app.</p>
			{uninstall !== undefined && (
				<>
					<h4 className="about-subtitle">Uninstall</h4>
					{uninstall}
				</>
			)}
		</section>
	);
}

/** The app's version, the Timber in use, the licenses of what the app bundles, and uninstalling. Nothing here is saved. */
export function AboutSection() {
	const state = useAppState();
	return <AboutSectionView rows={aboutRows(state.appVersion, state.timber)} uninstall={<UninstallPanel />} />;
}
