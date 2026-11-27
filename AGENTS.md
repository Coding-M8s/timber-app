# Timber app development guidance

This is the desktop app for Timber: TypeScript on Bun, an Electrobun shell, and a React interface. Read docs/architecture.md and docs/design.md before changing behavior.

- Keep README.md short, tidy, and useful: quick start, everyday commands, and links. Put detailed explanations in focused docs and link to them instead of expanding the README.
- The interface talks only to the `Engine` contract in src/shared/engine.ts. Add a capability there first, then implement it in the Bun main process and in the mock engine, with tests. Keep src/shared/rpc.ts in step.
- Prefer small modules and plain functions. Keep parsing and formatting pure so they can be tested without a window.
- Do not use em dashes (U+2014) in code, interface text, comments, tests, or documentation. Use plain punctuation. Check for this character in every code review.
- Installed Git and its worktree metadata are the source of truth. Invoke Git using executable plus argument arrays; never interpolate user input into shell commands.
- Never reimplement Timber's safety rules here. Creating, rebasing, and removing worktrees goes through Timber. Read-only queries may call Git directly.
- Every action that runs a Timber command shows that command before it runs.
- Only a small built-in text editor, for quick fixes to one file: typing, undo and redo, search, save, coloring by language, matching and closing brackets, and toggling a line comment, on CodeMirror's packages. No language servers, plugins, completion, linting, replace, or project-wide features; people open a worktree in their own editor for real work. Keep it small and fast rather than growing it into an IDE.
- Test Git behavior with meaningful temporary real repositories, and assert that read-only queries leave files and refs intact.
- Keep secrets out of repository config, logs, tickets, and commits.
- No platform is verified yet. Claim support for an operating system only after actual testing on it.
- Work in independent ticket branches and PRs with one implementer and one reviewer.
- Record exact verification commands and observed results. Do not claim a passing desktop build before it has been run.
- Verify a change with the test files that cover it (`bun run test <files>`) plus `bun run typecheck`, not the full suite. CI runs every test; fix what it finds on the PR.

## Commit hygiene

- Never add AI coauthor trailers or AI-generated authorship signatures to commits, PR descriptions, or other authorship metadata. This includes Claude, Codex, ChatGPT, Copilot, Cursor, Gemini, Grok, and similar assistants. Preserve legitimate human coauthors.
- Keep Superpowers plans, specs, ledgers, and execution artifacts local. Never commit `.superpowers/` or `docs/superpowers/`, including with `git add -f`.
- Treat commits as potentially public from day one. Do not commit credentials, private keys, real environment files, customer data, or private operational details in code, fixtures, plans, logs, or documentation.
- Commit shared product contracts and contributor documentation intentionally; review staged changes before committing. Ignore rules do not remove files from existing history.
