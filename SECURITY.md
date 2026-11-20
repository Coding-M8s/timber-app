# Security policy

## Supported versions

The app has no published release yet. Security fixes go into `main`. Once
releases exist, fixes go into the latest release only.

## Report a vulnerability

Report privately through GitHub:
[open a private security advisory](https://github.com/Coding-M8s/timber-app/security/advisories/new).
Do not open a public issue or pull request for a suspected vulnerability.

A problem in the Timber CLI itself belongs in
[Timber's security policy](https://github.com/Coding-M8s/timber/blob/main/SECURITY.md).

Include:

- The app commit or version, and how you run it (`bun run dev`, a local build,
  or an installed build).
- The Timber version (`timber --version`) and `git --version`.
- Operating system and architecture.
- The steps needed to reproduce the problem.
- What an attacker gains, and what access they need first.

Remove tokens, credentials, and private repository content from the report.
Maintainers work on Timber in their spare time and aim to acknowledge reports
within seven days.

## What counts

The app runs with your account's permissions. It runs Timber and Git, starts
terminals and coding agents, and reads Timber's settings, including where
issue tracker credentials are kept. Reports in these areas are especially
useful:

- Running a command the person did not choose or was not shown first,
  including through branch names, issue titles, file names, or other text
  from a repository or tracker.
- Changing files, branches, or refs from a view that is meant to be read-only,
  such as the Changes tab or the background fetch.
- Showing or logging stored credentials, or sending them anywhere.
- The interface reaching the Bun process through anything other than the
  documented `Engine` contract.

These are expected behavior, not vulnerabilities:

- Agents, terminals, editors, and hooks run as trusted programs with your
  permissions. A repository's Timber configuration is trusted shell code;
  read it before using Timber in that repository.
- Local builds are unsigned.
