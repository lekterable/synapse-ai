import { copyFile, mkdir, stat, readFile, readdir, rm } from 'fs/promises'
import { move, pathExists } from 'fs-extra'
import { join, dirname, basename, relative, resolve } from 'path'
import { createHash } from 'crypto'
import { minimatch } from 'minimatch'
import type { ConfigManager } from './config'

const DIRECTORY_IGNORED_PATTERNS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
]

const DEFAULT_IGNORED_PATTERNS = [
  ...DIRECTORY_IGNORED_PATTERNS.flatMap((directory) => [
    `${directory}/**`,
    `**/${directory}/**`,
  ]),
  '*.log',
  '.DS_Store',
]

const CONFIG_FILE_PATTERNS = [
  '.cursorrules',
  '.cursorignore',
  '.cursor/**',
  '.taskmaster/**',
  '.synapse.json',
  '.superset/**',
  '.vscode/**',
  '.idea/**',
  '.editorconfig',
  '.prettierrc*',
  '.eslintrc*',
  '.stylelintrc*',
  'tsconfig.json',
  'jsconfig.json',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.npmignore',
  '.gitignore',
  '.env.example',
  '.env.local.example',
]

const ensureDirectory = async (filePath: string): Promise<void> => {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })
}

export const copyFileAtomic = async (
  src: string,
  dest: string,
): Promise<void> => {
  await ensureDirectory(dest)
  const tmpPath = `${dest}.tmp`

  try {
    await copyFile(src, tmpPath)
    await move(tmpPath, dest, { overwrite: true })
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

export const backupFile = async (
  filePath: string,
  backupDir: string,
): Promise<string> => {
  await mkdir(backupDir, { recursive: true })

  const timestamp = Date.now()
  const fileName = basename(filePath)
  const backupPath = join(backupDir, `${timestamp}-${fileName}`)

  await copyFile(filePath, backupPath)
  return backupPath
}

export const getFileHash = async (filePath: string): Promise<string> => {
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

const matchesPattern = (
  filePath: string,
  pattern: string,
  projectRoot: string,
): boolean => {
  const relativePath = relative(projectRoot, filePath)
  return minimatch(relativePath, pattern, { dot: true })
}

export const isIgnored = async (
  filePath: string,
  projectRoot: string,
  configManager: ConfigManager,
): Promise<boolean> => {
  const globalConfig = configManager.getGlobalConfig()
  const allPatterns = [
    ...DEFAULT_IGNORED_PATTERNS,
    ...globalConfig.ignoredPatterns,
  ]

  return allPatterns.some((pattern) =>
    matchesPattern(filePath, pattern, projectRoot),
  )
}

const isConfigFile = (filePath: string, projectRoot: string): boolean => {
  const relativePath = relative(projectRoot, filePath)

  return CONFIG_FILE_PATTERNS.some((pattern) =>
    minimatch(relativePath, pattern, { dot: true }),
  )
}

const scanDirectory = async (
  dir: string,
  projectRoot: string,
  configManager: ConfigManager,
  shouldIncludeFile: (filePath: string, projectRoot: string) => boolean,
): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const nestedResults = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(dir, entry.name)

        if (await isIgnored(fullPath, projectRoot, configManager)) {
          return []
        }

        if (entry.isDirectory()) {
          return scanDirectory(
            fullPath,
            projectRoot,
            configManager,
            shouldIncludeFile,
          )
        }

        return entry.isFile() && shouldIncludeFile(fullPath, projectRoot)
          ? [fullPath]
          : []
      }),
    )

    return nestedResults.flat()
  } catch {
    // Ignore unreadable directories (permissions, broken links) during scan.
    return []
  }
}

export const listProjectFiles = async (
  projectRoot: string,
  configManager: ConfigManager,
): Promise<string[]> => {
  const resolvedRoot = resolve(projectRoot)
  const files = await scanDirectory(
    resolvedRoot,
    resolvedRoot,
    configManager,
    isConfigFile,
  )
  return files.sort()
}

export const listDirectoryFiles = async (
  directoryPath: string,
  projectRoot: string,
  configManager: ConfigManager,
): Promise<string[]> => {
  const resolvedDirectory = resolve(directoryPath)
  const files = await scanDirectory(
    resolvedDirectory,
    resolve(projectRoot),
    configManager,
    () => true,
  )
  return files.sort()
}
