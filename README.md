# Synapse

Sync config files, rules, and templates from a source location to multiple projects. Keep your AI instructions, editor configs, and templates in one place, then update once and sync everywhere.

## Install

```bash
npm install -g synapse-ai
```

## Quick Start

```bash
# Project A: initialize Synapse and add a few shared files
cd ~/project-a
synapse init

synapse add AGENTS.md
synapse add .editorconfig
synapse add .cursorrules
synapse doctor --yes

# Project B: initialize Synapse and sync those files in
cd ~/project-b
synapse init
synapse sync --yes

# Check status
synapse status

# Clean up stale project registrations later
synapse prune --dry-run
synapse prune --yes
```

This is the default model:

- `synapse init` creates a Synapse project in the current directory
- `synapse add <path>` stores that file or directory in the shared source layer
- `synapse remove <path>` removes that file or directory from the selected source layer
- `synapse doctor` runs AI-focused project checks and can scaffold editable checks on first run
- `synapse prune` removes stale registered projects whose path or `.synapse.json` is missing
- `synapse sync` pulls shared files into another initialized project

If you want to stop managing a file or directory from source storage later:

```bash
synapse remove .editorconfig
synapse remove .cursor --root apps/web
```

## Common Files To Sync

- `AGENTS.md`
- `.cursorrules`
- `.cursor/rules/*.md`
- `.editorconfig`
- `.prettierrc`
- `.gitignore`
- project templates and prompt files

## Scoped Example

Use scopes when some files should be different for different kinds of projects.

```bash
# Web React project
cd ~/web-app
synapse init --scope web,react
synapse add .cursorrules

# Shared files still go to the shared layer explicitly
synapse add AGENTS.md --shared

# Another web React project gets:
# - shared files like AGENTS.md
# - web-only, react-only, and web+react overrides
cd ~/another-web-app
synapse init --scope react+web
synapse sync --yes
```

## Monorepo Example

```bash
# From the repo root, initialize two separate synapse projects
synapse init --root apps/web --scope web
synapse init --root apps/web-consumer --scope web,react
synapse init --root apps/mobile --scope mobile

# Add a shared file, a web override, and a web+react override
synapse add AGENTS.md --root apps/web --shared
synapse add .cursor/rules/frontend.mdc --root apps/web --scope web
synapse add .cursor/rules/react.mdc --root apps/web --scope web,react

# Sync another initialized web project from anywhere
synapse sync --root apps/web-consumer --yes
```

In that setup:

- `AGENTS.md` is shared across every initialized project
- `apps/web/.cursor/rules/frontend.mdc` applies to every project whose scope includes `web`
- `apps/web/.cursor/rules/react.mdc` applies to projects whose scope includes both `web` and `react`
- `apps/mobile/.cursorrules` can be different by using scope `mobile`

## Commands

| Command                              | Description                                                                |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `synapse init`                       | Initialize the current directory as a synapse project                      |
| `synapse init --root <path>`         | Initialize another directory as a synapse project                          |
| `synapse init --scope <name[,name]>` | Set one or more scopes for project-specific source overrides               |
| `synapse link <path>`                | Register an existing synapse project globally                              |
| `synapse unlink`                     | Remove the current synapse project                                         |
| `synapse list`                       | List registered synapse projects                                           |
| `synapse prune`                      | Remove stale registered projects from global config                        |
| `synapse prune --dry-run`            | Preview stale project cleanup without changing config                      |
| `synapse prune --yes`                | Apply stale project cleanup without confirmation prompt                    |
| `synapse doctor`                     | Run built-in AI instruction checks for the current project                 |
| `synapse doctor --yes`               | Scaffold default editable checks in `.synapse/checks` on first run         |
| `synapse add <path>`                 | Add a file or directory to source storage, defaulting to the project scope |
| `synapse add <path> --shared`        | Add a file or directory to the shared source root                          |
| `synapse add <path> --scope <x>`     | Add a file or directory to a specific scope or scope combination           |
| `synapse remove <path>`              | Remove a file or directory from source storage                             |
| `synapse remove <path> --shared`     | Remove a file or directory from the shared source root                     |
| `synapse remove <path> --scope <x>`  | Remove a file or directory from a specific scope or scope combination      |
| `synapse sync`                       | Preview and sync tracked files from source to the current project          |
| `synapse sync <file>`                | Preview and sync one file                                                  |
| `synapse sync --dry-run`             | Show sync plan without applying changes                                    |
| `synapse sync --yes`                 | Apply sync without confirmation prompt                                     |
| `synapse sync --strategy <mode>`     | Set conflict strategy (`ask`, `theirs`, `ours`, `skip`)                    |
| `synapse status`                     | Show sync status of tracked files                                          |
| `synapse diff <file>`                | Show diff between source and project version                               |

## Status Symbols

| Symbol | Meaning                     |
| ------ | --------------------------- |
| ✓      | In sync                     |
| ⚠      | Out of sync (local changes) |
| ✗      | Missing in project          |

## How It Works

1. A synapse project is any directory containing `.synapse.json`
2. Commands operate on the nearest `.synapse.json` above your current directory, or on `--root <path>`
3. By default, `synapse add <path>` stores files in the shared source layer
4. Shared files live directly under `~/.synapse/source/`
5. Scoped files live under `~/.synapse/source/scopes/<scope>/`
6. Multiple scopes are canonicalized, so `web,react` and `react+web` both store as `react+web`
7. A project with `web,react` receives shared files plus files scoped to `web`, `react`, and `react+web`
8. More specific scope combinations override broader scopes when they contain the same relative file
9. Paths are preserved relative to the selected project root (for example `.cursor/rules.md`)
10. This means the same relative path can have different scoped versions, such as:

- shared: `source/AGENTS.md`
- scoped: `source/scopes/web/.cursorrules`
- scoped: `source/scopes/react+web/.cursorrules`
- scoped: `source/scopes/mobile/.cursorrules`

11. `synapse sync` shows a sync plan and asks for confirmation before applying changes
12. Before overwriting, backups are created in `~/.synapse/backups/`
13. SHA256 hashes detect conflicts between source and local versions

## Shared vs Scoped

- Shared is the default for unscoped projects
- Use shared files for conventions that should apply everywhere
- Use scopes for app-specific or team-specific overrides
- In a scoped project, `synapse add <path>` writes to that scope by default
- In a scoped project, `synapse add <path> --shared` writes to the shared layer instead
- A scoped project reads from shared plus every scoped source whose scopes are contained by the project scope
- A `web,react` project receives `web`, `react`, and `react+web` scoped files
- The `scopes/` directory inside the source store is reserved for Synapse internals
- Parent projects cannot add, diff, status, or sync files that belong to a nested Synapse project; run those commands from the nested root instead

## Doctor Checks

- `synapse doctor` runs built-in checks for AI instruction files like `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/*`
- On first run, `synapse doctor --yes` scaffolds editable check files in `.synapse/checks/`
- If `.synapse/checks/` exists, Synapse runs those custom checks instead of the built-in defaults

## Use Cases

- Keep `AGENTS.md` consistent across many repos
- Share editor configs like `.editorconfig` and `.prettierrc`
- Sync `.cursorrules` or `.cursor/rules/*.md` across related projects
- Distribute team conventions, starter files, and prompt templates

## License

MIT
