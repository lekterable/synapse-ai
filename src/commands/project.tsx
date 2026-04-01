import { stat } from 'fs/promises'
import { pathExists } from 'fs-extra'
import { render, Text, Box } from 'ink'
import chalk from 'chalk'
import { homedir } from 'os'
import { resolve } from 'path'
import { createConfigManager } from '../config'
import {
  isDoctorInitialized,
  markDoctorInitialized,
  runDoctorChecks,
  scaffoldDoctorChecks,
  type DoctorFinding,
} from '../doctor'
import {
  getMissingProjectErrorDetails,
  resolveInitProjectContext,
  resolveProjectContext,
} from '../project-context'
import { validateScopeName } from '../source'
import { confirm } from '../utils/confirm'
import { showError, showSuccess, showWarning } from '../utils/output'
import type { CommandHandler } from './types'

const MIN_COLUMN_WIDTH = 20

type ProjectStatus = 'active' | 'missing-config' | 'missing-path'

type ProjectListEntry = {
  status: ProjectStatus
  scope?: string
  lastSync?: string
}

const DOCTOR_LEVEL_SYMBOLS = {
  error: chalk.red('✗'),
  warning: chalk.yellow('⚠'),
  info: chalk.blue('ℹ'),
} as const

const ensureDirectory = async (
  directoryPath: string,
): Promise<boolean | undefined> => {
  const exists = await pathExists(directoryPath)

  if (!exists) {
    return undefined
  }

  const directoryStats = await stat(directoryPath).catch(() => undefined)
  return directoryStats?.isDirectory() === true
}

const ensureGlobalProject = (projectRoot: string): boolean => {
  const globalConfigManager = createConfigManager()
  const globalConfig = globalConfigManager.getGlobalConfig()

  if (globalConfig.projects.includes(projectRoot)) {
    return true
  }

  globalConfigManager.setGlobalConfig({
    projects: [...globalConfig.projects, projectRoot],
  })

  return false
}

const removeGlobalProject = (projectRoot: string): void => {
  const globalConfigManager = createConfigManager()
  const globalConfig = globalConfigManager.getGlobalConfig()

  globalConfigManager.setGlobalConfig({
    projects: globalConfig.projects.filter(
      (project) => project !== projectRoot,
    ),
  })
}

const formatProjectLabel = (
  projectRoot: string,
  scope: string | undefined,
): string => {
  return scope ? `${projectRoot} (scope: ${scope})` : projectRoot
}

const formatProjectPathForDisplay = (projectRoot: string): string => {
  const userHome = process.env.HOME || homedir()
  const normalizeComparablePath = (pathValue: string): string =>
    pathValue.replace(/^\/private(?=\/var\/)/, '')
  const normalizedProjectRoot = normalizeComparablePath(projectRoot)
  const normalizedUserHome = normalizeComparablePath(userHome)

  return normalizedProjectRoot.startsWith(normalizedUserHome)
    ? `~${normalizedProjectRoot.slice(normalizedUserHome.length)}`
    : projectRoot
}

const parseScopeFlag = (scopeFlag: string | undefined): string | undefined => {
  if (scopeFlag === undefined) {
    return undefined
  }

  return validateScopeName(scopeFlag)
}

const initHandler: CommandHandler = async (input, flags) => {
  if (input.length > 0) {
    showError({
      problem: 'Too many arguments for init command',
      reason: 'The init command does not accept positional arguments',
      solution: 'Usage: synapse init [--root <path>] [--scope <name>]',
    })
    return
  }

  let scope: string | undefined
  try {
    scope = parseScopeFlag(flags.scope)
  } catch (error) {
    showError({
      problem: 'Invalid scope name',
      reason: error instanceof Error ? error.message : String(error),
      solution:
        'Use letters, numbers, dots, hyphens, or underscores in scope names',
    })
    return
  }

  const { projectRoot, configManager } = resolveInitProjectContext(flags.root)
  const isDirectory = await ensureDirectory(projectRoot)

  if (isDirectory === undefined) {
    showError({
      problem: `Cannot initialize project: ${projectRoot}`,
      reason: 'The target directory does not exist',
      solution: 'Create the directory first, then run synapse init again',
    })
    return
  }

  if (!isDirectory) {
    showError({
      problem: `Cannot initialize project: ${projectRoot}`,
      reason: 'The target path is not a directory',
      solution:
        'Pass a directory path with --root, or run init inside a directory',
    })
    return
  }

  const alreadyInitialized = configManager.hasProjectMetadata()
  const existingMetadata = alreadyInitialized
    ? configManager.getProjectMetadata()
    : undefined
  const scopeChanged =
    flags.scope !== undefined && scope !== existingMetadata?.scope
  const nextScope = flags.scope !== undefined ? scope : existingMetadata?.scope

  if (!alreadyInitialized) {
    configManager.setProjectMetadata({
      version: 1,
      scope: nextScope,
    })
  } else if (scopeChanged) {
    configManager.setProjectMetadata({ scope })
  }

  const wasGloballyLinked = ensureGlobalProject(projectRoot)

  if (alreadyInitialized && !scopeChanged && wasGloballyLinked) {
    showWarning(
      `Project already initialized: ${formatProjectLabel(projectRoot, nextScope)}`,
    )
    return
  }

  showSuccess(
    `Project initialized at: ${formatProjectLabel(projectRoot, nextScope)}`,
  )
}

const linkHandler: CommandHandler = async (input) => {
  if (input.length === 0) {
    showError({
      problem: 'No path specified for link command',
      reason: 'The link command requires a directory path argument',
      solution: 'Usage: synapse link <path-to-project>',
    })
    return
  }

  if (input.length > 1) {
    showError({
      problem: 'Too many arguments for link command',
      reason: 'The link command accepts exactly one path',
      solution: 'Usage: synapse link <path-to-project>',
    })
    return
  }

  const pathToLink = resolve(input[0])
  const isDirectory = await ensureDirectory(pathToLink)

  if (isDirectory === undefined) {
    showError({
      problem: `Cannot link path: ${pathToLink}`,
      reason: 'The specified directory does not exist',
      solution: 'Check the path is correct and the directory exists',
    })
    return
  }

  if (!isDirectory) {
    showError({
      problem: `Cannot link path: ${pathToLink}`,
      reason: 'The specified path is not a directory',
      solution: 'Pass a project directory path to link',
    })
    return
  }

  const projectConfigManager = createConfigManager(pathToLink)
  if (!projectConfigManager.hasProjectMetadata()) {
    showError({
      problem: `Cannot link path: ${pathToLink}`,
      reason: 'The directory is not initialized as a synapse project',
      solution: 'Run "synapse init" in that directory first',
    })
    return
  }

  const globalConfigManager = createConfigManager()
  const globalConfig = globalConfigManager.getGlobalConfig()

  if (globalConfig.projects.includes(pathToLink)) {
    showWarning(`Path already linked: ${pathToLink}`)
    return
  }

  globalConfigManager.setGlobalConfig({
    projects: [...globalConfig.projects, pathToLink],
  })

  const metadata = projectConfigManager.getProjectMetadata()
  showSuccess(
    `Linked project: ${formatProjectLabel(pathToLink, metadata.scope)}`,
  )
}

const unlinkHandler: CommandHandler = async (input, flags) => {
  if (input.length > 0) {
    showError({
      problem: 'Too many arguments for unlink command',
      reason: 'The unlink command does not accept positional arguments',
      solution: 'Usage: synapse unlink [--root <path>]',
    })
    return
  }

  const context = resolveProjectContext(flags.root)

  if (!context) {
    showError(getMissingProjectErrorDetails(flags.root))
    return
  }

  context.configManager.deleteProjectMetadata()
  removeGlobalProject(context.projectRoot)
  showSuccess(`Removed project: ${context.projectRoot}`)
}

const getProjectStatus = async (
  projectRoot: string,
): Promise<ProjectListEntry> => {
  const exists = await pathExists(projectRoot)
  if (!exists) {
    return { status: 'missing-path' }
  }

  const projectConfig = createConfigManager(projectRoot)
  if (!projectConfig.hasProjectMetadata()) {
    return { status: 'missing-config' }
  }

  const metadata = projectConfig.getProjectMetadata()
  const lastSync = Object.values(metadata.syncedFiles).sort().at(-1)

  return {
    status: 'active',
    scope: metadata.scope,
    lastSync,
  }
}

const formatLastSync = (
  status: ProjectStatus,
  lastSync: string | undefined,
): string => {
  if (lastSync === undefined) {
    return status === 'active' ? 'never' : '-'
  }

  return lastSync.slice(0, 10)
}

const formatStatus = (status: ProjectStatus): string => {
  switch (status) {
    case 'active':
      return chalk.green('active')
    case 'missing-config':
      return chalk.yellow('missing config')
    case 'missing-path':
      return chalk.red('missing path')
  }
}

const renderDoctorFindings = (findings: DoctorFinding[]): void => {
  if (findings.length === 0) {
    showSuccess('No doctor findings.')
    return
  }

  console.log(chalk.bold('Doctor Findings'))
  findings.forEach((finding) => {
    console.log(`${DOCTOR_LEVEL_SYMBOLS[finding.level]} ${finding.message}`)

    if (finding.file) {
      console.log(`${chalk.dim('  File:')} ${finding.file}`)
    }

    if (finding.fix) {
      console.log(`${chalk.dim('  Fix:')} ${finding.fix}`)
    }
  })

  const errorCount = findings.filter(
    (finding) => finding.level === 'error',
  ).length
  const warningCount = findings.filter(
    (finding) => finding.level === 'warning',
  ).length
  const infoCount = findings.filter(
    (finding) => finding.level === 'info',
  ).length

  console.log(
    chalk.dim(
      `Summary: ${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info finding(s)`,
    ),
  )
}

const setupDoctorChecks = async (
  projectRoot: string,
  context: NonNullable<ReturnType<typeof resolveProjectContext>>,
  yes: boolean,
): Promise<void> => {
  if (isDoctorInitialized(context.metadata)) {
    return
  }

  if (yes) {
    await scaffoldDoctorChecks(projectRoot)
    markDoctorInitialized(context.configManager)
    showSuccess('Scaffolded default doctor checks in .synapse/checks')
    return
  }

  if (!process.stdin.isTTY) {
    showWarning(
      'First doctor run is using built-in checks only. Re-run with --yes to scaffold editable checks in .synapse/checks.',
    )
    return
  }

  const scaffoldDefaults = await confirm(
    "It's your first time running synapse doctor. Scaffold default checks in .synapse/checks?",
    true,
  )

  if (scaffoldDefaults) {
    await scaffoldDoctorChecks(projectRoot)
    showSuccess('Scaffolded default doctor checks in .synapse/checks')
  } else {
    showWarning(
      'Skipping check scaffolding for now. Built-in doctor checks will still run.',
    )
  }

  markDoctorInitialized(context.configManager)
}

const listHandler: CommandHandler = async (input) => {
  if (input.length > 0) {
    showError({
      problem: 'Too many arguments for list command',
      reason: 'The list command does not accept positional arguments',
      solution: 'Usage: synapse list',
    })
    return
  }

  const configManager = createConfigManager()
  const globalConfig = configManager.getGlobalConfig()
  const projects = globalConfig.projects

  if (projects.length === 0) {
    showWarning('No registered projects.')
    return
  }

  const projectStatuses = await Promise.all(
    projects.map(async (projectRoot) => ({
      path: projectRoot,
      displayPath: formatProjectPathForDisplay(projectRoot),
      ...(await getProjectStatus(projectRoot)),
    })),
  )

  const maxPathLength = Math.max(
    ...projectStatuses.map((project) => project.displayPath.length),
    MIN_COLUMN_WIDTH,
  )
  const padding = maxPathLength + 2
  const scopePadding = 16
  const lastSyncPadding = 14
  const separatorLength = padding + scopePadding + lastSyncPadding + 12

  render(
    <Box flexDirection="column">
      <Text>
        {chalk.bold('Path'.padEnd(padding))}
        {chalk.bold('Scope'.padEnd(scopePadding))}
        {chalk.bold('Last Sync'.padEnd(lastSyncPadding))}
        Status
      </Text>
      <Text>{'-'.repeat(separatorLength)}</Text>
      {projectStatuses.map((project) => (
        <Text key={project.path}>
          {project.displayPath.padEnd(padding)}
          {(project.scope || '-').padEnd(scopePadding)}
          {formatLastSync(project.status, project.lastSync).padEnd(
            lastSyncPadding,
          )}
          {formatStatus(project.status)}
        </Text>
      ))}
    </Box>,
  )
}

const doctorHandler: CommandHandler = async (input, flags) => {
  if (input.length > 0) {
    showError({
      problem: 'Too many arguments for doctor command',
      reason: 'The doctor command does not accept positional arguments',
      solution: 'Usage: synapse doctor [--root <path>] [--yes]',
    })
    return
  }

  const context = resolveProjectContext(flags.root)

  if (!context) {
    showError(getMissingProjectErrorDetails(flags.root))
    return
  }

  await setupDoctorChecks(context.projectRoot, context, flags.yes)
  const findings = await runDoctorChecks(
    context.projectRoot,
    context.configManager.getProjectMetadata(),
  )
  renderDoctorFindings(findings)
}

export const registerProjectCommands = (
  register: (name: string, handler: CommandHandler) => void,
): void => {
  register('init', initHandler)
  register('link', linkHandler)
  register('unlink', unlinkHandler)
  register('list', listHandler)
  register('doctor', doctorHandler)
}
