import { type ReactNode, useId } from "react";
import { type AboutRow, aboutRows } from "../../about-format";
import logoUrl from "../../assets/logo.png";
import { useAppState } from "../../store/react";
import { UninstallPanel } from "./UninstallPanel";
import { AppUpdatePanel } from "../AppUpdate";

/** The About section as drawn from its data, so it can be tested without a window. `updates` shows under Updates, `uninstall` under Uninstall. */
export function AboutSectionView({ rows, updates, uninstall }: { rows: readonly AboutRow[]; updates?: ReactNode; uninstall?: ReactNode }) {
	const titleId = useId();
	return (
		<section className="settings-section" aria-labelledby={titleId}>
			<header className="settings-section-head">
				<h3 id={titleId} className="settings-section-title">About</h3>
			</header>
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
			{updates !== undefined && (
				<>
					<h4 className="about-subtitle">Updates</h4>
					{updates}
				</>
			)}
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
			<p className="about-text">
				The Timber that comes with the app is copyright Coding-M8s, under the MIT License with the Commons Clause condition. The libraries built into it keep their own licenses, listed in its third-party notices.
			</p>
			<p className="about-text">The full texts are in the licenses folder inside the installed app, and Timber's beside it in the timber folder.</p>
			{uninstall !== undefined && (
				<>
					<h4 className="about-subtitle">Uninstall</h4>
					{uninstall}
				</>
			)}
		</section>
	);
}

/** The app's version, the Timber in use, updating the app, the licenses of what the app bundles, and uninstalling. Nothing here is saved. */
export function AboutSection() {
	const state = useAppState();
	return <AboutSectionView rows={aboutRows(state.appVersion, state.timber)} updates={<AppUpdatePanel />} uninstall={<UninstallPanel />} />;
}
