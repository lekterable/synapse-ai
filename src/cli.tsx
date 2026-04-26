#!/usr/bin/env node

import meow from 'meow'
import { getCommandHandler, registerCommand } from './commands'
import type { CliFlags } from './commands/types'
import { registerProjectCommands } from './commands/project'
import { registerSyncCommands } from './commands/sync'
import { showVersion, showError } from './utils/output'

registerProjectCommands(registerCommand)
registerSyncCommands(registerCommand)

const cli = meow(
  `
	Usage
	  $ synapse <command> [options]

	Commands
	  init             Initialize synapse in the current directory or root
	  link <path>      Link an existing synapse project in global config
	  unlink           Remove current synapse project
	  list             List registered synapse projects
	  prune            Remove stale registered projects
	  doctor           Run AI instruction checks for the current project
	  add <path>       Add a project file or directory to source storage
	  remove <path>    Remove a file or directory from source storage
	  sync [file]      Sync all tracked files or one file from source
	  status           Show sync status of tracked files
	  diff <file>      Show diff between source and project version

	Options
	  --help, -h              Show help
	  --version, -v           Show version
	  --dry-run, -d           Preview changes without applying them
	  --yes, -y               Skip confirmation prompt in sync
	  --strategy, -s <mode>   Conflict strategy: ask | theirs | ours | skip
	  --root, -r <path>       Operate on a specific synapse project root
	  --scope <name[,name]>   Set or target source scopes
	  --shared                Write added files to the shared source root

	Examples
	  $ synapse init
	  $ synapse init --root apps/web --scope web,react
	  $ synapse add .cursor
	  $ synapse add AGENTS.md --shared
	  $ synapse remove .cursor --root apps/web
	  $ synapse doctor --yes
	  $ synapse sync
	  $ synapse sync --root apps/web --strategy theirs --yes
`,
  {
    importMeta: import.meta,
    flags: {
      help: {
        type: 'boolean',
        shortFlag: 'h',
      },
      version: {
        type: 'boolean',
        shortFlag: 'v',
      },
      dryRun: {
        type: 'boolean',
        shortFlag: 'd',
      },
      yes: {
        type: 'boolean',
        shortFlag: 'y',
      },
      strategy: {
        type: 'string',
        shortFlag: 's',
        default: 'ask',
      },
      root: {
        type: 'string',
        shortFlag: 'r',
      },
      scope: {
        type: 'string',
      },
      shared: {
        type: 'boolean',
      },
    },
  },
)

const parseCliFlags = (flags: Record<string, unknown>): CliFlags => {
  return {
    help: flags.help === true,
    version: flags.version === true,
    dryRun: flags.dryRun === true,
    yes: flags.yes === true,
    strategy: typeof flags.strategy === 'string' ? flags.strategy : 'ask',
    root: typeof flags.root === 'string' ? flags.root : undefined,
    scope: typeof flags.scope === 'string' ? flags.scope : undefined,
    shared: flags.shared === true,
  }
}

const handleCommand = async (): Promise<void> => {
  const parsedFlags = parseCliFlags(cli.flags)

  if (parsedFlags.help) {
    cli.showHelp()
    return
  }

  if (parsedFlags.version) {
    showVersion(cli.pkg.version || '0.0.1')
    return
  }

  const [command, ...input] = cli.input

  if (!command) {
    cli.showHelp()
    return
  }

  const handler = getCommandHandler(command)

  if (!handler) {
    showError({
      problem: `Unknown command: ${command}`,
      reason: 'The command is not recognized by synapse',
      solution: 'Run "synapse --help" to see available commands',
    })
    return
  }

  try {
    await handler(input, parsedFlags)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    showError({
      problem: 'Command execution failed',
      reason: errorMessage,
      solution: 'Check the command arguments and try again, or run with --help',
    })
  }
}

handleCommand().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error)
  showError({
    problem: 'Fatal error occurred',
    reason: errorMessage,
    solution: 'This may be a bug. Please report with the error message above.',
  })
})
