import { type Token, Lexer } from "marked";
import { webLink } from "../shared/terminal";
import { isCompletePath, normalCompletePath, worktreeRelativePath } from "../shared/worktree-files";

/**
 * The Markdown reader's rules. Pure, so they can be tested without a window.
 *
 * A Markdown file is only ever turned into data here (`markdownTokens`) and
 * then into React elements (see components/MarkdownView.tsx). No HTML string
 * from the file reaches the page: HTML written in the file shows as text, and
 * nothing in the file can run a script, load a page, or load an image.
 */

/** The parts of a Markdown text, as GitHub reads it: tables, task lists, struck text, and bare web addresses included. */
export function markdownTokens(text: string): Token[] {
	return Lexer.lex(text, { gfm: true, breaks: false });
}

/** Where a link in a Markdown file leads, and so what a click on it does. */
export type MarkdownLink =
	/** A web page, opened in the person's browser. */
	| { kind: "web"; url: string }
	/** Another file, opened in the File tab. Relative to the worktree, or a complete path when read from a file outside it. */
	| { kind: "file"; path: string }
	/** A heading of the same file, scrolled to. */
	| { kind: "heading"; id: string }
	/** Anything else, such as `javascript:`, `file:`, or `mailto:`, or a path out of the worktree. Not followed. */
	| { kind: "none" };

/**
 * Where a link's address leads, read from the file at `from` (relative to
 * the worktree, or a complete path for a file outside it). Only web
 * addresses, files of the same worktree, and headings of the same file are
 * followed; everything else is shown and not followed. From a file outside
 * the worktree, a path leads beside that file, as a complete path, which
 * opens read-only.
 */
export function markdownLink(href: string, from: string): MarkdownLink {
	const address = href.trim();
	if (address === "") return { kind: "none" };
	if (address.startsWith("#")) return address.length > 1 ? { kind: "heading", id: headingId(decoded(address.slice(1))) } : { kind: "none" };
	const web = webLink(address);
	if (web !== null) return { kind: "web", url: web };
	// Any other scheme, and an address that names a host (`//host/page`), is not a file of this worktree.
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(address) || address.startsWith("//") || address.startsWith("\\\\")) return { kind: "none" };
	const bare = decoded(address.replace(/[?#].*$/, ""));
	if (bare === "") return { kind: "none" };
	if (isCompletePath(from)) {
		const complete = isCompletePath(bare) ? normalCompletePath(bare) : normalCompletePath(`${from.slice(0, Math.max(from.lastIndexOf("/"), from.lastIndexOf("\\")))}/${bare}`);
		return complete === null ? { kind: "none" } : { kind: "file", path: complete };
	}
	const folder = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
	// A path starting with / is from the top of the worktree, as GitHub reads it in a repository.
	const joined = bare.startsWith("/") ? bare.replace(/^\/+/, "") : folder === "" ? bare : `${folder}/${bare}`;
	const path = worktreeRelativePath("", joined);
	return path === null ? { kind: "none" } : { kind: "file", path };
}

const decoded = (text: string) => {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
};

/**
 * The id a heading's text gets, as GitHub makes it: lower case, spaces as
 * hyphens, and other punctuation dropped. Prefixed, so it never matches an
 * id of the app itself.
 */
export function headingId(text: string): string {
	const slug = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
	return `markdown-${slug}`;
}

/** Ids for headings in order, where a repeated one gets -1, -2, and so on, as GitHub does. */
export function headingIds(): (text: string) => string {
	const seen = new Map<string, number>();
	return text => {
		const id = headingId(text);
		const count = seen.get(id) ?? 0;
		seen.set(id, count + 1);
		return count === 0 ? id : `${id}-${count}`;
	};
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", copy: "©", reg: "®", hellip: "…" };

/**
 * Text with the character references a browser would read in it written as
 * characters, as `&amp;` for `&`. The reader shows text, never HTML, so it
 * reads them itself. Unknown names stay as they are.
 */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, name: string) => {
		if (name.startsWith("#")) {
			const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
			return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�";
		}
		return NAMED[name.toLowerCase()] ?? whole;
	});
}

/** The plain text of some parts, as a heading's id and an image's description are made from. */
export function plainText(tokens: readonly Token[] | undefined): string {
	if (!tokens) return "";
	return tokens.map(token => {
		if ("tokens" in token && Array.isArray(token.tokens) && token.type !== "codespan") return plainText(token.tokens);
		if (token.type === "codespan") return String(token.text ?? "");
		if (token.type === "text" || token.type === "escape") return decodeEntities(String(token.text ?? ""));
		return "";
	}).join("");
}
