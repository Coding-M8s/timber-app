import type { FileChange } from "../../shared/file-changes";
import { KIND_LABELS, KIND_LETTERS, fileKey, kindTone } from "../changes-format";

export { fileKey };

/** The letter of a file's kind of change, such as M for modified, colored by it. */
export function KindLetter({ file }: { file: Pick<FileChange, "kind"> }) {
	return (
		<span className={`change-letter ${kindTone(file.kind)}`} title={KIND_LABELS[file.kind]} aria-hidden="true">
			{KIND_LETTERS[file.kind]}
		</span>
	);
}
