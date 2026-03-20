import { render, Text, Box } from 'ink'
import chalk from 'chalk'
import { homedir } from 'os'
import {
  getCommandFileBasePath,
  getMissingProjectErrorDetails,
  resolveProjectContext,
} from '../project-context'
import {
  addFile,
  applySyncPlan,
  buildSyncPlan,
  detectConflicts,
  getStatusColor,
  type ConflictStrategy,
  type FileStatus,
  type SyncPlanItem,
  type SyncPlanReason,
} from '../sync-engine'
import {
  ensureSourceDir,
  resolveEffectiveSourceFile,
  validateScopeName,
} from '../source'
import { diffFiles } from '../utils/diff'
import { confirm } from '../utils/confirm'
import { toProjectRelativePath } from '../utils/paths'
import {
  ensureProjectOwnsPath,
  NestedProjectOwnershipError,
} from '../utils/project-root'
import { showError, showSuccess, showWarning } from '../utils/output'
import type { CommandHandler } from './types'

const CONFLICT_STRATEGIES: ConflictStrategy[] = [
  'ask',
  'theirs',
  'ours',
  'skip',
]

type ConflictResolution = {
  selected: SyncPlanItem[]
  skipped: SyncPlanItem[]
}

const REASON_LABELS: Record<SyncPlanReason, string> = {
  'in-sync': chalk.green('in sync'),
  'missing-in-project': chalk.blue('missing in project'),
  changed: chalk.yellow('changed'),
  conflict: chalk.red('conflict'),
  ignored: chalk.dim('ignored'),
  'missing-in-source': chalk.red('missing in source'),
}

const getReasonLabel = (reason: SyncPlanReason): string => REASON_LABELS[reason]

const showSkippedConflictWarning = (count: number): void => {
  if (count > 0) {
    showWarning(`Skipped ${count} conflict file(s).`)
  }
}

const renderPlan = (plan: SyncPlanItem[]): void => {
  if (plan.length === 0) {
    return
  }

  const maxFileLength = Math.max(...plan.map((item) => item.file.length), 20)
  const padding = maxFileLength + 2

  console.log(
    [
      chalk.bold('Sync Plan'),
      `${chalk.bold('File'.padEnd(padding))}State`,
      '-'.repeat(padding + 20),
      ...plan.map(
        (item) => `${item.file.padEnd(padding)}${getReasonLabel(item.reason)}`,
      ),
    ].join('\n'),
  )
}

const parseStrategy = (value: unknown): ConflictStrategy => {
  if (typeof value !== 'string') {
    return 'ask'
  }

  if (CONFLICT_STRATEGIES.includes(value as ConflictStrategy)) {
    return value as ConflictStrategy
  }

  throw new Error(`Invalid --strategy value: ${value}`)
}

const resolveConflictSelection = async (
  conflicts: SyncPlanItem[],
  strategy: ConflictStrategy,
  dryRun: boolean,
): Promise<ConflictResolution> => {
  if (strategy === 'theirs') {
    return { selected: conflicts, skipped: [] }
  }

  if (strategy === 'ours' || strategy === 'skip') {
    return { selected: [], skipped: conflicts }
  }

  if (dryRun || conflicts.length === 0) {
    return { selected: conflicts, skipped: [] }
  }

  if (!process.stdin.isTTY) {
    showError({
      problem: 'Interactive conflict resolution is unavailable',
      reason: 'Conflict strategy "ask" requires a TTY prompt for each conflict',
      solution:
        'Use --yes with --strategy theirs, or choose --strategy ours/skip',
    })
  }

  return conflicts.reduce<Promise<ConflictResolution>>(
    async (resolutionPromise, conflictItem) => {
      const resolution = await resolutionPromise
      const overwrite = await confirm(
        `Conflict in ${conflictItem.file}. Overwrite local changes with source version?`,
        false,
      )

      return overwrite
        ? {
            selected: [...resolution.selected, conflictItem],
            skipped: resolution.skipped,
          }
        : {
            selected: resolution.selected,
            skipped: [...resolution.skipped, conflictItem],
          }
    },
    Promise.resolve({ selected: [], skipped: [] }),
  )
}

const resolveRequiredProjectContext = (
  rootFlag: string | undefined,
): NonNullable<ReturnType<typeof resolveProjectContext>> => {
  const context = resolveProjectContext(rootFlag)

  if (!context) {
    showError(getMissingProjectErrorDetails(rootFlag))
  }

  return context!
}

const parseAddTargetScope = (
  metadataScope: string | undefined,
  flags: { scope?: string; shared: boolean },
): string | undefined => {
  if (flags.shared && flags.scope) {
    throw new Error('Use either --shared or --scope, but not both')
  }

  if (flags.shared) {
    return undefined
  }

  return flags.scope ? validateScopeName(flags.scope) : metadataScope
}

const formatStatus = (status: FileStatus): string => {
  const symbol = getStatusColor(status)
  const colors: Record<FileStatus, (text: string) => string> = {
    'in-sync': chalk.green,
    'out-of-sync': chalk.yellow,
    missing: chalk.red,
    new: chalk.blue,
  }
  return colors[status](symbol)
}

const formatDisplayPath = (filePath: string): string => {
  return filePath.startsWith(userHome)
    ? filePath.replace(userHome, '~')
    : filePath
}

const showNestedProjectOwnershipError = (
  problem: string,
  error: NestedProjectOwnershipError,
): never => {
  return showError({
    problem,
    reason: error.message,
    solution:
      'Run the command from the nested project root, or use --root <nested-project> instead',
  })
}

const syncHandler: CommandHandler = async (input, flags) => {
  if (input.length > 1) {
    showError({
      problem: 'Too many arguments for sync command',
      reason: 'Sync accepts either no file argument or exactly one file path',
      solution: 'Usage: synapse sync [file-path]',
    })
    return
  }

  const dryRun = flags.dryRun === true
  const yes = flags.yes === true

  let strategy: ConflictStrategy
  try {
    strategy = parseStrategy(flags.strategy)
  } catch (error) {
    showError({
      problem: 'Invalid conflict strategy',
      reason: error instanceof Error ? error.message : String(error),
      solution: 'Use one of: ask, theirs, ours, skip',
    })
    return
  }

  const effectiveStrategy: ConflictStrategy =
    strategy === 'ask' && yes ? 'theirs' : strategy
  const targetFile = input[0]
  const context = resolveRequiredProjectContext(flags.root)
  const { projectRoot, configManager } = context

  let plan: SyncPlanItem[]
  try {
    plan = await buildSyncPlan(
      projectRoot,
      configManager,
      targetFile,
      getCommandFileBasePath(projectRoot, flags.root),
    )
  } catch (error) {
    if (error instanceof NestedProjectOwnershipError) {
      showNestedProjectOwnershipError(
        'Cannot sync across nested synapse project boundary',
        error,
      )
    }

    showError({
      problem: 'Cannot build sync plan',
      reason: error instanceof Error ? error.message : String(error),
      solution:
        'Use a file path inside the selected project root and avoid the reserved "scopes/" namespace',
    })
    return
  }

  const missingInSource = plan.find(
    (item) => item.reason === 'missing-in-source',
  )
  if (missingInSource) {
    showError({
      problem: `Cannot sync file: ${missingInSource.file}`,
      reason: 'The file does not exist in source directory',
      solution: `Run "synapse add ${missingInSource.file}" to add it to source first`,
    })
    return
  }

  if (plan.length === 0) {
    showWarning('No source files found for this project.')
    return
  }

  renderPlan(plan)

  const actionable = plan.filter((item) => item.needsSync)
  if (actionable.length === 0) {
    showWarning('All tracked files are already in sync.')
    return
  }

  const conflicts = actionable.filter((item) => item.hasConflict)
  const nonConflicts = actionable.filter((item) => !item.hasConflict)
  const conflictResolution = await resolveConflictSelection(
    conflicts,
    effectiveStrategy,
    dryRun,
  )
  const selected = [...nonConflicts, ...conflictResolution.selected]
  const skippedConflicts = conflictResolution.skipped

  if (selected.length === 0) {
    showWarning('No files selected for sync.')
    showSkippedConflictWarning(skippedConflicts.length)
    return
  }

  if (dryRun) {
    showWarning(`Would sync ${selected.length} file(s).`)
    if (skippedConflicts.length > 0) {
      showWarning(`Would skip ${skippedConflicts.length} conflict file(s).`)
    }
    return
  }

  if (!yes) {
    if (!process.stdin.isTTY) {
      showError({
        problem: 'Confirmation requires interactive terminal',
        reason: 'Sync now prompts for confirmation before applying changes',
        solution:
          'Re-run with --yes to apply without prompt, or use --dry-run to preview',
      })
      return
    }

    const proceed = await confirm(
      `Apply sync for ${selected.length} file(s)?`,
      false,
    )
    if (!proceed) {
      showWarning('Sync cancelled.')
      return
    }
  }

  const count = await applySyncPlan(selected, configManager, false)

  if (count > 0) {
    showSuccess(`Synced ${count} file(s).`)
  } else {
    showWarning('No files were synced due to errors.')
  }

  if (count < selected.length) {
    showWarning(`Failed to sync ${selected.length - count} file(s).`)
  }

  showSkippedConflictWarning(skippedConflicts.length)
}

const addHandler: CommandHandler = async (input, flags) => {
  if (input.length === 0) {
    showError({
      problem: 'No path specified for add command',
      reason: 'The add command requires a file or directory path argument',
      solution: 'Usage: synapse add <path>',
    })
    return
  }

  if (input.length > 1) {
    showError({
      problem: 'Too many arguments for add command',
      reason: 'The add command accepts exactly one file or directory path',
      solution: 'Usage: synapse add <path>',
    })
    return
  }

  const context = resolveRequiredProjectContext(flags.root)
  const { projectRoot, configManager, metadata } = context
  const file = input[0]

  let targetScope: string | undefined
  try {
    targetScope = parseAddTargetScope(metadata.scope, flags)
  } catch (error) {
    showError({
      problem: 'Invalid add target',
      reason: error instanceof Error ? error.message : String(error),
      solution:
        'Use --shared for shared files, or --scope <name> for one scope',
    })
    return
  }

  let addedCount: number | undefined
  try {
    addedCount = await addFile(file, projectRoot, configManager, {
      fileBasePath: getCommandFileBasePath(projectRoot, flags.root),
      targetScope,
    })
  } catch (error) {
    if (error instanceof NestedProjectOwnershipError) {
      showNestedProjectOwnershipError(
        'Cannot add path from nested synapse project boundary',
        error,
      )
    }

    throw error
  }

  if (addedCount) {
    const targetLabel = targetScope ? `scope: ${targetScope}` : 'shared'
    showSuccess(
      `Added ${addedCount} file(s) to source (${targetLabel}): ${file}`,
    )
  } else {
    showError({
      problem: `Cannot add path: ${file}`,
      reason:
        'Path may not exist, may be outside the selected project root, may be fully ignored, or may use the reserved "scopes/" namespace',
      solution:
        'Ensure the path exists inside the selected project, contains addable files, and use --shared or --scope appropriately',
    })
  }
}

const statusHandler: CommandHandler = async (input, flags) => {
  if (input.length > 0) {
    showError({
      problem: 'Too many arguments for status command',
      reason: 'The status command does not accept positional arguments',
      solution: 'Usage: synapse status [--root <path>]',
    })
    return
  }

  const context = resolveRequiredProjectContext(flags.root)
  let statuses: Awaited<ReturnType<typeof detectConflicts>>
  try {
    statuses = await detectConflicts(context.projectRoot, context.configManager)
  } catch (error) {
    if (error instanceof NestedProjectOwnershipError) {
      showNestedProjectOwnershipError(
        'Cannot read status across nested synapse project boundary',
        error,
      )
    }

    throw error
  }

  if (statuses.length === 0) {
    showWarning('No source files found for this project.')
    return
  }

  const maxFileLength = Math.max(
    ...statuses.map((status) => status.file.length),
    20,
  )
  const padding = maxFileLength + 2
  const separatorLength = padding + 20

  render(
    <Box flexDirection="column">
      <Text>
        {chalk.bold('File'.padEnd(padding))}Status{chalk.bold('  Last Sync')}
      </Text>
      <Text>{'-'.repeat(separatorLength)}</Text>
      {statuses.map((status) => (
        <Text key={status.file}>
          {status.file.padEnd(padding)}
          {formatStatus(status.status)}
          {status.lastSync
            ? `  ${new Date(status.lastSync).toLocaleDateString()}`
            : '  Never'}
        </Text>
      ))}
    </Box>,
  )
}

const diffHandler: CommandHandler = async (input, flags) => {
  if (input.length === 0) {
    showError({
      problem: 'No file specified for diff command',
      reason: 'The diff command requires a file path argument',
      solution: 'Usage: synapse diff <file-path>',
    })
    return
  }

  if (input.length > 1) {
    showError({
      problem: 'Too many arguments for diff command',
      reason: 'The diff command accepts exactly one file path',
      solution: 'Usage: synapse diff <file-path>',
    })
    return
  }

  const context = resolveRequiredProjectContext(flags.root)
  const { projectRoot, configManager, metadata } = context
  const file = input[0]
  const sourceRoot = await ensureSourceDir(configManager)

  let relativePath: string
  try {
    relativePath = toProjectRelativePath(
      projectRoot,
      file,
      getCommandFileBasePath(projectRoot, flags.root),
    )
  } catch (error) {
    showError({
      problem: `Cannot diff file: ${file}`,
      reason: error instanceof Error ? error.message : String(error),
      solution:
        'Use a file path inside the selected project root and avoid the reserved "scopes/" namespace',
    })
    return
  }

  const sourceFile = await resolveEffectiveSourceFile(
    sourceRoot,
    relativePath,
    metadata.scope,
  )

  if (!sourceFile) {
    showError({
      problem: `Cannot diff file: ${relativePath}`,
      reason: 'The file does not exist in source directory',
      solution: `Run "synapse add ${relativePath}" to add it to source first`,
    })
    return
  }

  let projectFilePath: string
  try {
    projectFilePath = ensureProjectOwnsPath(projectRoot, relativePath)
  } catch (error) {
    if (error instanceof NestedProjectOwnershipError) {
      showNestedProjectOwnershipError(
        'Cannot diff across nested synapse project boundary',
        error,
      )
    }

    throw error
  }
  const diff = await diffFiles(sourceFile.path, projectFilePath)

  if (diff === undefined) {
    showSuccess('Files are identical')
  } else if (
    diff === 'Source file does not exist' ||
    diff === 'Project file does not exist' ||
    diff === 'Binary files differ'
  ) {
    showWarning(diff)
  } else {
    render(
      <Box flexDirection="column">
        <Text>{chalk.bold(`Diff: ${relativePath}`)}</Text>
        <Text>
          {chalk.dim(`--- Source: ${formatDisplayPath(sourceFile.path)}`)}
        </Text>
        <Text>
          {chalk.dim(`+++ Project: ${formatDisplayPath(projectFilePath)}`)}
        </Text>
        <Text></Text>
        <Text>{diff}</Text>
      </Box>,
    )
  }
}

export const registerSyncCommands = (
  register: (name: string, handler: CommandHandler) => void,
): void => {
  register('sync', syncHandler)
  register('add', addHandler)
  register('status', statusHandler)
  register('diff', diffHandler)
}
const userHome = homedir()
