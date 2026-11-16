import { type ReactNode, type SubmitEvent, useId, useState } from "react";
import type { Preferences } from "../../../shared/preferences";
import { useStore } from "../../store/react";

/** Where saving a section stands. A failure keeps what was chosen on screen, so Save can be tried again. */
export type SectionSave =
	| { state: "idle" }
	| { state: "saving" }
	| { state: "saved" }
	| { state: "failed"; message: string };

/**
 * Saving one section's preferences through the store: only the preferences
 * the section names, so it never undoes another section's. The store changes
 * what is on screen only once the save worked.
 */
export function useSectionSave() {
	const store = useStore();
	const [save, setSave] = useState<SectionSave>({ state: "idle" });
	const run = async (change: Partial<Preferences>): Promise<boolean> => {
		if (save.state === "saving") return false;
		setSave({ state: "saving" });
		const result = await store.savePreferences(change);
		setSave(result.outcome === "saved" ? { state: "saved" } : { state: "failed", message: result.message });
		return result.outcome === "saved";
	};
	// Choosing something new puts the last outcome away, so "Saved" never stands beside an unsaved choice.
	const reset = () => {
		if (save.state === "saved" || save.state === "failed") setSave({ state: "idle" });
	};
	return { save, run, reset };
}

interface SettingsSectionProps {
	title: string;
	/** One or two sentences on what the section changes and where it is kept. */
	description: string;
	save: SectionSave;
	/** False while nothing differs from what is saved, or while what is chosen cannot be saved. */
	canSave: boolean;
	onSave: () => void;
	children: ReactNode;
}

/** One section of the Settings dialog: its fields, and a Save of its own, as the design asks. */
export function SettingsSection({ title, description, save, canSave, onSave, children }: SettingsSectionProps) {
	const titleId = useId();
	const saving = save.state === "saving";
	const submit = (event: SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!saving && canSave) onSave();
	};
	return (
		<form className="settings-section" aria-labelledby={titleId} aria-busy={saving} onSubmit={submit}>
			<h3 id={titleId} className="settings-section-title">{title}</h3>
			<p className="settings-section-text">{description}</p>
			<fieldset className="dialog-fields" disabled={saving}>{children}</fieldset>
			{save.state === "failed" && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">Could not save</p>
					<p className="sidebar-error-text">{save.message}</p>
					<p className="sidebar-error-text">Nothing changed. What you chose is still here to save again.</p>
				</div>
			)}
			<div className="settings-section-foot">
				<p className="settings-section-status" role="status">{save.state === "saved" ? "Saved" : ""}</p>
				<button type="submit" className="button primary" disabled={saving || !canSave}>
					{saving ? "Saving" : "Save"}
				</button>
			</div>
		</form>
	);
}
