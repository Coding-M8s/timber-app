# Contributing to the Timber app

Bug reports, platform reports, and focused pull requests are welcome.

## Before you start

- Report bugs and propose features through
  [GitHub issues](https://github.com/Coding-M8s/timber-app/issues/new/choose).
  Problems with the Timber CLI itself belong in
  [Timber's issues](https://github.com/Coding-M8s/timber/issues).
- Report security problems privately; see [SECURITY.md](SECURITY.md).
- Open an issue before a pull request that changes behavior, so the scope can
  be agreed first. Small fixes and documentation corrections can go straight to
  a pull request.
- Some things are out of scope: a built-in code editor, and reimplementing
  Timber's worktree rules in the app.

## Licensing of contributions

The app is source-available under the
[MIT License plus Commons Clause v1.0](LICENSE), not an OSI-approved open-source
license. By submitting a contribution you confirm that you have the right to
submit it and agree that it is licensed under those same terms.

## Set up

Follow the [quick start](README.md#quick-start). Then:

```bash
bun run typecheck
bun run test
```

`bun run dev:web` shows the interface in a browser with sample data and is the
fastest way to work on it. To catch AI attribution before it lands in a commit,
turn on the repository's commit hook once per clone:

```bash
git config core.hooksPath .githooks
```

## Running tests

```bash
bun run test                          # every file, in parallel workers
bun run test tests/terminals.test.ts  # one file, or a few
bun run test:serial                   # one process, for debugging
```

`bun run test` is `bun test --parallel --timeout=30000 --timings
tests/timings.json`. Bun starts one worker per CPU core, and each test file
gets a fresh global, module registry, and environment. The tests in one file
still run one after another. So a test file must not depend on another: make
its own temporary folders with `mkdtemp`, listen on port 0, and wait for what
it can observe rather than for a fixed time. Do not add `--concurrent` or
`--no-isolate`: tests change environment variables and mocks.

Every test may take 30 seconds, not Bun's default 5, because a test that
starts Git, Timber, or a browser can be slow on a machine busy with other
files. Bun ignores a `timeout` key in `bunfig.toml`, so the flag is in
`package.json`. A file that calls `setDefaultTimeout` sets its own.

CI runs the Linux tests as three shards (`bun run test --shard=N/3`) on
separate runners, with the build in a job of its own. `tests/timings.json`
holds each file's measured duration, so Bun balances the shards by time and
starts the slowest files first. A file missing from it still runs. Refresh it
when files are added, removed, or get much slower or faster, with four
workers, as CI's runners have:

```bash
bun test --parallel=4 --timeout=30000 --timings tests/timings.json --update-timings
```

## Making changes

Read [AGENTS.md](AGENTS.md), the [architecture](docs/architecture.md), and the
[design](docs/design.md) before you change behavior. The rules there apply to
every contributor. The ones that most often matter in review:

- Keep changes small: one topic per branch and pull request.
- The interface talks only to the `Engine` contract in `src/shared/engine.ts`.
  Add a capability there first, then implement it in the Bun process and in
  the mock engine, with tests.
- Creating, rebasing, and removing worktrees goes through Timber, and every
  action that runs a Timber command shows that command first.
- Invoke Git with an executable plus an argument array. Never build shell
  commands from user input.
- Test Git changes against real temporary repositories, and check that
  read-only queries leave files and refs intact.
- Do not use the em dash character (U+2014) anywhere. Use plain punctuation.
- Keep secrets, real environment files, and private details out of code,
  fixtures, logs, and commits.
- Keep `README.md` short. Put detail in a focused document under `docs/`.

## Commits and pull requests

- Do not add AI coauthor trailers or AI authorship signatures to commits or pull
  request descriptions. Reviewers check for them. Check a message locally with
  `bun run check:attribution --message-file <path>`.
- In the pull request, list the exact verification commands you ran and what
  they printed. Do not claim a platform works unless you tested it.
- Run `bun run typecheck` and `bun run test` before you push.
