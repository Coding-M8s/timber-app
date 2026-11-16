/**
 * A command typed as one line, such as the editor setting `code --new-window`,
 * split into an executable and its arguments. Pure: nothing here runs a
 * process or reads the environment.
 *
 * The rules are deliberately few, so that what is typed is what runs:
 *
 * - Spaces, tabs, line breaks (CR and LF), and no-break spaces separate
 *   words.
 * - Single or double quotes group text with spaces into one word. Inside
 *   them every character is itself; there is no escape character.
 * - A backslash is an ordinary character, never an escape.
 * - Nothing is expanded: no variables, no `~`, no wildcards, no `;` or `|`.
 * - A quote that is never closed is an error.
 */

export type CommandLineReading =
	| { ok: true; words: string[] }
	| { ok: false; message: string };

const WHITESPACE = /[ \t\r\n\u00A0]/;

export function splitCommandLine(text: string): CommandLineReading {
	const words: string[] = [];
	// Null between words. A string, possibly empty, once a word has started: `""` is an empty word.
	let word: string | null = null;
	let quote: "'" | "\"" | null = null;
	let quoteStart = 0;

	for (let index = 0; index < text.length; index++) {
		const character = text[index]!;
		if (quote !== null) {
			if (character === quote) quote = null;
			else word += character;
			continue;
		}
		if (character === "'" || character === "\"") {
			quote = character;
			quoteStart = index;
			word ??= "";
		} else if (WHITESPACE.test(character)) {
			if (word !== null) words.push(word);
			word = null;
		} else {
			word = (word ?? "") + character;
		}
	}

	if (quote !== null) {
		return { ok: false, message: `The ${quote === "'" ? "single" : "double"} quote at character ${quoteStart + 1} is never closed.` };
	}
	if (word !== null) words.push(word);
	return { ok: true, words };
}

const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * One word for showing in a command line, quoted as a POSIX shell would need.
 * For reading only: commands are always run from the argument array.
 */
export function quoteWord(word: string): string {
	return PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** An executable and its arguments as one line of text, for showing before it runs. */
export function describeCommandLine(words: readonly string[]): string {
	return words.map(quoteWord).join(" ");
}
