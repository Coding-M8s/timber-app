import type { FileChange, FileChangeTarget } from "../../shared/file-changes";
import { KIND_LABELS, KIND_LETTERS, kindTone } from "../changes-format";

/** A key for a changed file, unique in a list of changes. */
export const fileKey = (file: FileChangeTarget) => `${file.area}\0${file.path}\0${file.previousPath ?? ""}`;

/** The letter of a file's kind of change, such as M for modified, colored by it. */
export function KindLetter({ file }: { file: Pick<FileChange, "kind"> }) {
	return (
		<span className={`change-letter ${kindTone(file.kind)}`} title={KIND_LABELS[file.kind]} aria-hidden="true">
			{KIND_LETTERS[file.kind]}
		</span>
	);
}
