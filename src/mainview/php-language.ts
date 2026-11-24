import type { SyntaxNode, Tree } from "@lezer/common";
import { type Tag, styleTags, tags } from "@lezer/highlight";

/**
 * What Timber adds to PHP's coloring from `@codemirror/lang-php`, so PHP
 * reads like TypeScript: class and namespace names colored as types,
 * parameters as definitions, and `$this`, `self`, `static`, and `parent` as
 * keywords. Pure, so it is tested without an editor.
 */

/** Tags the grammar's own leave out, by where a node sits. */
export const phpTags = styleTags({
	"BaseClause/Name BaseClause/QualifiedName/Name ClassInterfaceClause/Name ClassInterfaceClause/QualifiedName/Name": tags.className,
	"NewExpression/Name NewExpression/QualifiedName/Name ScopedExpression/Name ScopedExpression/QualifiedName/Name": tags.className,
	"UseDeclaration/Name UseClause/Name NamespaceUseDeclaration/Name NamespaceUseDeclaration/QualifiedName/Name": tags.className,
	"InterfaceDeclaration/Name TraitDeclaration/Name EnumDeclaration/Name": tags.definition(tags.className),
	"NamespaceDefinition/QualifiedName/Name": tags.namespace,
	"Parameter/VariableName CatchDeclarator/VariableName FunctionStaticDeclaration/VariableDeclarator/VariableName": tags.definition(tags.variableName),
	"PropertyDeclaration/VariableDeclarator/VariableName": tags.definition(tags.propertyName),
	// The grammar colors the object of `$user->name` as a property; TypeScript leaves it a variable.
	"MemberExpression/VariableName": tags.variableName,
});

/** A token's tag, which its node's place alone cannot tell. */
export interface TokenTag {
	from: number;
	to: number;
	tag: Tag;
}

const CLASS_WORDS = new Set(["self", "static", "parent"]);

/**
 * The tokens between `from` and `to` whose tag comes from their text or
 * their neighbors: `$this`, and `self`, `static`, and `parent` before `::` or
 * after `new`, as keywords; and the variables after `as` in a `foreach`, as
 * definitions.
 */
export function phpTokenTags(tree: Tree, read: (from: number, to: number) => string, from = 0, to = tree.length): TokenTag[] {
	const found: TokenTag[] = [];
	tree.iterate({
		from,
		to,
		enter(node) {
			const parent = node.node.parent?.name;
			if (node.name === "VariableName") {
				if (read(node.from, node.to) === "$this") found.push({ from: node.from, to: node.to, tag: tags.self });
				else if (parent === "ForSpec" ? afterAs(node.node) : parent === "Pair" && node.node.parent?.parent?.name === "ForSpec") {
					found.push({ from: node.from, to: node.to, tag: tags.definition(tags.variableName) });
				}
			} else if (node.name === "Name" && (parent === "ScopedExpression" || parent === "NewExpression") && CLASS_WORDS.has(read(node.from, node.to).toLowerCase())) {
				found.push({ from: node.from, to: node.to, tag: tags.self });
			}
		},
	});
	return found;
}

function afterAs(node: SyntaxNode): boolean {
	for (let sibling = node.prevSibling; sibling !== null; sibling = sibling.prevSibling) {
		if (sibling.name === "as") return true;
	}
	return false;
}

/**
 * Whether one side of a hunk of a PHP file is PHP code rather than the page
 * around it. Most hunks, such as the inside of a method, have no `<?php`, and
 * PHP's parser would read them as HTML. The first tag decides: `<?php` or
 * `<?=` opens code, so what comes before it is the page; `?>` closes code, so
 * what comes before it is code. With neither, text that starts with an HTML
 * tag is the page, and anything else is code. Known limit: a hunk of a
 * class's body with no method around it is read as top-level code, so a
 * typed property such as `private string $name;` misses some colors.
 */
export function isPhpCode(text: string): boolean {
	const tag = /<\?(?:php\b|=)|\?>/i.exec(text);
	if (tag !== null) return tag[0] === "?>";
	return !/^\s*<[A-Za-z!/]/.test(text);
}
