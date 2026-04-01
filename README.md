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
```

This is the default model:

- `synapse init` creates a Synapse project in the current directory
- `synapse add <path>` stores that file or directory in the shared source layer
- `synapse remove <path>` removes that file or directory from the selected source layer
- `synapse doctor` runs AI-focused project checks and can scaffold editable checks on first run
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
# Web project
cd ~/web-app
synapse init --scope web
synapse add .cursorrules

# Shared files still go to the shared layer explicitly
synapse add AGENTS.md --shared

# Another web project gets both:
# - shared files like AGENTS.md
# - web-only overrides like .cursorrules
cd ~/another-web-app
synapse init --scope web
synapse sync --yes
```

## Monorepo Example

```bash
# From the repo root, initialize two separate synapse projects
synapse init --root apps/web --scope web
synapse init --root apps/web-consumer --scope web
synapse init --root apps/mobile --scope mobile

# Add a shared file and a web-only override
synapse add AGENTS.md --root apps/web --shared
synapse add .cursorrules --root apps/web

# Sync another initialized web project from anywhere
synapse sync --root apps/web-consumer --yes
```

In that setup:

- `AGENTS.md` is shared across every initialized project
- `apps/web/.cursorrules` is only for projects with scope `web`
- `apps/mobile/.cursorrules` can be different by using scope `mobile`

## Commands

| Command                             | Description                                                                |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `synapse init`                      | Initialize the current directory as a synapse project                      |
| `synapse init --root <path>`        | Initialize another directory as a synapse project                          |
| `synapse init --scope <name>`       | Set a scope for project-specific source overrides                          |
| `synapse link <path>`               | Register an existing synapse project globally                              |
| `synapse unlink`                    | Remove the current synapse project                                         |
| `synapse list`                      | List registered synapse projects                                           |
| `synapse doctor`                    | Run built-in AI instruction checks for the current project                 |
| `synapse doctor --yes`              | Scaffold default editable checks in `.synapse/checks` on first run         |
| `synapse add <path>`                | Add a file or directory to source storage, defaulting to the project scope |
| `synapse add <path> --shared`       | Add a file or directory to the shared source root                          |
| `synapse add <path> --scope <x>`    | Add a file or directory to a specific scope                                |
| `synapse remove <path>`             | Remove a file or directory from source storage                             |
| `synapse remove <path> --shared`    | Remove a file or directory from the shared source root                     |
| `synapse remove <path> --scope <x>` | Remove a file or directory from a specific scope                           |
| `synapse sync`                      | Preview and sync tracked files from source to the current project          |
| `synapse sync <file>`               | Preview and sync one file                                                  |
| `synapse sync --dry-run`            | Show sync plan without applying changes                                    |
| `synapse sync --yes`                | Apply sync without confirmation prompt                                     |
| `synapse sync --strategy <mode>`    | Set conflict strategy (`ask`, `theirs`, `ours`, `skip`)                    |
| `synapse status`                    | Show sync status of tracked files                                          |
| `synapse diff <file>`               | Show diff between source and project version                               |

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
6. Scoped projects resolve files in this order: scoped override first, then shared fallback
7. Paths are preserved relative to the selected project root (for example `.cursor/rules.md`)
8. This means the same relative path can have different scoped versions, such as:
   - shared: `source/AGENTS.md`
   - scoped: `source/scopes/web/.cursorrules`
   - scoped: `source/scopes/mobile/.cursorrules`
9. `synapse sync` shows a sync plan and asks for confirmation before applying changes
10. Before overwriting, backups are created in `~/.synapse/backups/`
11. SHA256 hashes detect conflicts between source and local versions

## Shared vs Scoped

- Shared is the default for unscoped projects
- Use shared files for conventions that should apply everywhere
- Use scopes for app-specific or team-specific overrides
- In a scoped project, `synapse add <path>` writes to that scope by default
- In a scoped project, `synapse add <path> --shared` writes to the shared layer instead
- A scoped project reads from both layers: `source/scopes/<scope>/...` overrides `source/...`
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
