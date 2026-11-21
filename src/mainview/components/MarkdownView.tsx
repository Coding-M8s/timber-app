import { type KeyboardEvent, type MouseEvent, type ReactNode, useMemo, useRef } from "react";
import type { Token, Tokens } from "marked";
import { type MarkdownLink, decodeEntities, headingIds, markdownLink, markdownTokens, plainText } from "../markdown-format";

interface Actions {
	/** A web address, for the person's browser. */
	onOpenLink(url: string): void;
	/** A file of the same worktree, relative to it. */
	onOpenFile(path: string): void;
}

export interface Context extends Actions {
	/** The file shown, relative to the worktree, which relative links are read from. */
	path: string;
	nextHeadingId: (text: string) => string;
	scrollTo: (id: string) => void;
}

/**
 * A Markdown file, rendered. Every part becomes a React element: no HTML
 * from the file is put into the page, so HTML in it shows as text and
 * nothing in it runs. Links are never followed by the page itself: a click
 * opens a web page in the browser, another file of the worktree in the File
 * tab, or scrolls to a heading; any other link is shown and not followed.
 * Images are not loaded; their description shows in their place.
 */
export function MarkdownView({ text, path, onOpenLink, onOpenFile }: { text: string; path: string } & Actions) {
	const root = useRef<HTMLDivElement>(null);
	const tokens = useMemo(() => markdownTokens(text), [text]);
	const scrollTo = (id: string) => {
		const target = root.current?.querySelector(`[id="${CSS.escape(id)}"]`);
		if (target instanceof HTMLElement) {
			target.scrollIntoView({ block: "start" });
			target.focus({ preventScroll: true });
		}
	};
	const context: Context = { path, onOpenLink, onOpenFile, nextHeadingId: headingIds(), scrollTo };
	return <div ref={root} className="markdown-body">{blocks(tokens, context)}</div>;
}

function blocks(tokens: readonly Token[], context: Context): ReactNode[] {
	return tokens.map((token, index) => block(token, index, context));
}

function block(token: Token, key: number, context: Context): ReactNode {
	switch (token.type) {
		case "space":
		case "def":
			return null;
		case "heading": {
			const heading = token as Tokens.Heading;
			const Tag = `h${Math.min(Math.max(heading.depth, 1), 6)}` as "h1";
			return <Tag key={key} id={context.nextHeadingId(plainText(heading.tokens))} tabIndex={-1}>{inline(heading.tokens, context)}</Tag>;
		}
		case "paragraph":
			return <p key={key}>{inline((token as Tokens.Paragraph).tokens, context)}</p>;
		case "text": {
			// Text straight in a list item of a tight list.
			const text = token as Tokens.Text;
			return <span key={key}>{text.tokens ? inline(text.tokens, context) : decodeEntities(text.text)}</span>;
		}
		case "code": {
			const code = token as Tokens.Code;
			const language = code.lang?.trim().split(/\s+/)[0] ?? "";
			return <pre key={key} className="markdown-code" data-language={language || undefined}><code>{code.text}</code></pre>;
		}
		case "blockquote":
			return <blockquote key={key}>{blocks((token as Tokens.Blockquote).tokens, context)}</blockquote>;
		case "hr":
			return <hr key={key} />;
		case "list": {
			const list = token as Tokens.List;
			const items = list.items.map((item, index) => (
				<li key={index} className={item.task ? "markdown-task" : undefined}>{blocks(item.tokens, context)}</li>
			));
			return list.ordered
				? <ol key={key} start={typeof list.start === "number" && list.start !== 1 ? list.start : undefined}>{items}</ol>
				: <ul key={key}>{items}</ul>;
		}
		case "checkbox":
			return checkbox(token as Tokens.Checkbox, key);
		case "table": {
			const table = token as Tokens.Table;
			const cell = (data: Tokens.TableCell, index: number, Tag: "th" | "td") => (
				<Tag key={index} style={data.align ? { textAlign: data.align } : undefined}>{inline(data.tokens, context)}</Tag>
			);
			return (
				<div key={key} className="markdown-table">
					<table>
						<thead><tr>{table.header.map((data, index) => cell(data, index, "th"))}</tr></thead>
						<tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((data, column) => cell(data, column, "td"))}</tr>)}</tbody>
					</table>
				</div>
			);
		}
		case "html":
			// HTML written in the file, shown as the text it is.
			return <pre key={key} className="markdown-html">{(token as Tokens.HTML).text}</pre>;
		default:
			return "tokens" in token && Array.isArray(token.tokens)
				? <div key={key}>{inline(token.tokens, context)}</div>
				: <p key={key}>{String(token.raw ?? "")}</p>;
	}
}

function checkbox(token: Tokens.Checkbox, key: number): ReactNode {
	return <input key={key} type="checkbox" className="markdown-checkbox" checked={token.checked} disabled readOnly aria-label={token.checked ? "Done" : "Not done"} />;
}

function inline(tokens: readonly Token[] | undefined, context: Context): ReactNode[] {
	return (tokens ?? []).map((token, key) => {
		switch (token.type) {
			case "text": {
				const text = token as Tokens.Text;
				return text.tokens ? <span key={key}>{inline(text.tokens, context)}</span> : decodeEntities(text.text);
			}
			case "escape":
				return decodeEntities((token as Tokens.Escape).text);
			case "strong":
				return <strong key={key}>{inline((token as Tokens.Strong).tokens, context)}</strong>;
			case "em":
				return <em key={key}>{inline((token as Tokens.Em).tokens, context)}</em>;
			case "del":
				return <del key={key}>{inline((token as Tokens.Del).tokens, context)}</del>;
			case "codespan":
				return <code key={key}>{(token as Tokens.Codespan).text}</code>;
			case "br":
				return <br key={key} />;
			case "checkbox":
				return checkbox(token as Tokens.Checkbox, key);
			case "link": {
				const link = token as Tokens.Link;
				return <MarkdownAnchor key={key} target={markdownLink(link.href, context.path)} href={link.href} context={context}>{inline(link.tokens, context)}</MarkdownAnchor>;
			}
			case "image": {
				// Never loaded: no request leaves the app for a file's images. A web image can be opened in the browser.
				const image = token as Tokens.Image;
				const description = plainText(image.tokens) || image.href;
				const target = markdownLink(image.href, context.path);
				const label = <span className="markdown-image">Image: {description}</span>;
				return target.kind === "web" || target.kind === "file"
					? <MarkdownAnchor key={key} target={target} href={image.href} context={context}>{label}</MarkdownAnchor>
					: <span key={key}>{label}</span>;
			}
			case "html":
				// HTML written in the file, shown as the text it is.
				return <code key={key} className="markdown-html">{(token as Tokens.Tag).text}</code>;
			default:
				return "tokens" in token && Array.isArray(token.tokens) ? <span key={key}>{inline(token.tokens, context)}</span> : String(token.raw ?? "");
		}
	});
}

const LINK_TITLES: Record<MarkdownLink["kind"], (target: MarkdownLink, href: string) => string> = {
	web: target => `Open ${(target as { url: string }).url} in the browser`,
	file: target => `Open ${(target as { path: string }).path} here`,
	heading: () => "Go to this heading",
	none: (_target, href) => `${href} is not opened from here`,
};

/**
 * A link of the file. It has no `href`, so the page itself can never follow
 * it, whatever button or key is used: a click or Enter does what `target`
 * says, and a link that is not followed is plain text with its address in
 * its tooltip.
 */
export function MarkdownAnchor({ target, href, context, children }: { target: MarkdownLink; href: string; context: Context; children: ReactNode }) {
	const title = LINK_TITLES[target.kind](target, href);
	if (target.kind === "none") return <span className="markdown-link-off" title={title}>{children}</span>;
	const follow = () => {
		if (target.kind === "web") context.onOpenLink(target.url);
		else if (target.kind === "file") context.onOpenFile(target.path);
		else context.scrollTo(target.id);
	};
	const onClick = (event: MouseEvent) => {
		event.preventDefault();
		follow();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		follow();
	};
	return <a className="markdown-link" role="link" tabIndex={0} title={title} onClick={onClick} onKeyDown={onKeyDown}>{children}</a>;
}
