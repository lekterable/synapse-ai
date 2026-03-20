import { stat } from 'fs/promises'
import { pathExists } from 'fs-extra'
import { isAbsolute, resolve } from 'path'
import type { ConfigManager } from './config'
import {
  backupFile,
  copyFileAtomic,
  getFileHash,
  isIgnored,
  listDirectoryFiles,
} from './file-manager'
import {
  ensureSourceDir,
  listEffectiveSourceFiles,
  resolveEffectiveSourceFile,
  resolveSharedSourcePath,
  resolveTargetSourcePath,
} from './source'
import {
  isSubPath,
  normalizeRelativePath,
  toProjectRelativePath,
} from './utils/paths'
import {
  ensureProjectOwnsPath,
  NestedProjectOwnershipError,
} from './utils/project-root'

export type FileStatus = 'in-sync' | 'out-of-sync' | 'missing' | 'new'
export type ConflictStrategy = 'ask' | 'theirs' | 'ours' | 'skip'
export type SyncPlanReason =
  | 'in-sync'
  | 'missing-in-project'
  | 'changed'
  | 'conflict'
  | 'ignored'
  | 'missing-in-source'

export type FileStatusInfo = {
  file: string
  status: FileStatus
  lastSync?: string
}

export type SyncPlanItem = {
  file: string
  sourceFilePath: string
  projectFilePath: string
  reason: SyncPlanReason
  needsSync: boolean
  hasConflict: boolean
  projectExists: boolean
}

type SyncAccumulator = {
  count: number
  syncedFiles: Record<string, string>
  fileHashes: Record<string, string>
}

type AddFileOptions = {
  fileBasePath?: string
  targetScope?: string
}

type AddTarget = {
  relativeFilePath: string
  projectFilePath: string
  destPath: string
}

const getMetadataEntry = (
  record: Record<string, string>,
  relativePath: string,
): string | undefined => {
  return record[relativePath]
}

const resolveProjectFilePath = (
  projectRoot: string,
  relativeFilePath: string,
): { file: string; projectFilePath: string } => {
  const file = normalizeRelativePath(relativeFilePath)

  if (!file || file.startsWith('../')) {
    throw new Error(`Invalid relative file path: ${relativeFilePath}`)
  }

  return {
    file,
    projectFilePath: ensureProjectOwnsPath(projectRoot, file),
  }
}

const buildSyncPlanItem = async (
  projectRoot: string,
  sourceRoot: string,
  scope: string | undefined,
  relativeFilePath: string,
  configManager: ConfigManager,
  metadata: ReturnType<ConfigManager['getProjectMetadata']>,
): Promise<SyncPlanItem> => {
  const { file, projectFilePath } = resolveProjectFilePath(
    projectRoot,
    relativeFilePath,
  )
  const sourceFile = await resolveEffectiveSourceFile(sourceRoot, file, scope)
  const sourceFilePath =
    sourceFile?.path ?? resolveSharedSourcePath(sourceRoot, file)
  const projectExists = await pathExists(projectFilePath)

  if (!sourceFile) {
    return {
      file,
      sourceFilePath,
      projectFilePath,
      reason: 'missing-in-source',
      needsSync: false,
      hasConflict: false,
      projectExists,
    }
  }

  if (await isIgnored(projectFilePath, projectRoot, configManager)) {
    return {
      file,
      sourceFilePath: sourceFile.path,
      projectFilePath,
      reason: 'ignored',
      needsSync: false,
      hasConflict: false,
      projectExists,
    }
  }

  const sourceHash = await getFileHash(sourceFile.path)

  if (!projectExists) {
    return {
      file,
      sourceFilePath: sourceFile.path,
      projectFilePath,
      reason: 'missing-in-project',
      needsSync: true,
      hasConflict: false,
      projectExists: false,
    }
  }

  const projectHash = await getFileHash(projectFilePath)
  if (projectHash === sourceHash) {
    return {
      file,
      sourceFilePath: sourceFile.path,
      projectFilePath,
      reason: 'in-sync',
      needsSync: false,
      hasConflict: false,
      projectExists: true,
    }
  }

  const storedHash = getMetadataEntry(metadata.fileHashes, file)
  const hasConflict =
    storedHash !== undefined &&
    projectHash !== storedHash &&
    sourceHash !== storedHash &&
    projectHash !== sourceHash

  return {
    file,
    sourceFilePath: sourceFile.path,
    projectFilePath,
    reason: hasConflict ? 'conflict' : 'changed',
    needsSync: true,
    hasConflict,
    projectExists: true,
  }
}

export const getStatusColor = (status: FileStatus): string => {
  switch (status) {
    case 'in-sync':
      return '✓'
    case 'out-of-sync':
      return '⚠'
    case 'missing':
      return '✗'
    case 'new':
      return '➕'
  }
}

export const buildSyncPlan = async (
  projectRoot: string,
  configManager: ConfigManager,
  targetFile?: string,
  fileBasePath: string = projectRoot,
): Promise<SyncPlanItem[]> => {
  const sourceRoot = await ensureSourceDir(configManager)
  const metadata = configManager.getProjectMetadata()
  const targetFiles = targetFile
    ? [toProjectRelativePath(projectRoot, targetFile, fileBasePath)]
    : (await listEffectiveSourceFiles(sourceRoot, metadata.scope)).map(
        ({ file }) => file,
      )

  return Promise.all(
    targetFiles.map((targetRelativePath) =>
      buildSyncPlanItem(
        projectRoot,
        sourceRoot,
        metadata.scope,
        targetRelativePath,
        configManager,
        metadata,
      ),
    ),
  )
}

const logSyncError = (item: SyncPlanItem, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Failed to sync ${item.file}: ${message}`)

  if (process.env.DEBUG) {
    console.error(error)
  }
}

const applySyncPlanItem = async (
  accumulator: SyncAccumulator,
  item: SyncPlanItem,
  dryRun: boolean,
  backupEnabled: boolean,
  backupPath: string,
): Promise<SyncAccumulator> => {
  if (!item.needsSync) {
    return accumulator
  }

  if (dryRun) {
    return {
      ...accumulator,
      count: accumulator.count + 1,
    }
  }

  try {
    if (backupEnabled && item.projectExists) {
      await backupFile(item.projectFilePath, backupPath)
    }

    await copyFileAtomic(item.sourceFilePath, item.projectFilePath)
    const hash = await getFileHash(item.projectFilePath)
    const stats = await stat(item.projectFilePath)

    return {
      count: accumulator.count + 1,
      syncedFiles: {
        ...accumulator.syncedFiles,
        [item.file]: stats.mtime.toISOString(),
      },
      fileHashes: {
        ...accumulator.fileHashes,
        [item.file]: hash,
      },
    }
  } catch (error) {
    logSyncError(item, error)
    return accumulator
  }
}

const getDetectedStatus = (
  storedHash: string | undefined,
  projectHash: string,
  sourceHash: string,
): FileStatus => {
  if (!storedHash) {
    return 'new'
  }

  return projectHash === sourceHash && projectHash === storedHash
    ? 'in-sync'
    : 'out-of-sync'
}

export const applySyncPlan = async (
  plan: SyncPlanItem[],
  configManager: ConfigManager,
  dryRun: boolean = false,
): Promise<number> => {
  const metadata = configManager.getProjectMetadata()
  const globalConfig = configManager.getGlobalConfig()
  const initialAccumulator: SyncAccumulator = {
    count: 0,
    syncedFiles: { ...metadata.syncedFiles },
    fileHashes: { ...metadata.fileHashes },
  }
  const result = await plan.reduce<Promise<SyncAccumulator>>(
    async (accumulatorPromise, item) =>
      applySyncPlanItem(
        await accumulatorPromise,
        item,
        dryRun,
        globalConfig.backupEnabled,
        globalConfig.backupPath,
      ),
    Promise.resolve(initialAccumulator),
  )

  if (!dryRun) {
    configManager.setProjectMetadata({
      syncedFiles: result.syncedFiles,
      fileHashes: result.fileHashes,
    })
  }

  return result.count
}

export const addFile = async (
  path: string,
  projectRoot: string,
  configManager: ConfigManager,
  options: AddFileOptions = {},
): Promise<number | undefined> => {
  const metadata = configManager.getProjectMetadata()
  const sourceRoot = await ensureSourceDir(configManager)
  const fileBasePath = options.fileBasePath ?? projectRoot

  try {
    const resolvedInputPath = isAbsolute(path)
      ? path
      : resolve(fileBasePath, path)

    if (!isSubPath(projectRoot, resolvedInputPath)) {
      throw new Error(`File is outside the project root: ${path}`)
    }

    if (!(await pathExists(resolvedInputPath))) {
      return undefined
    }

    const inputStats = await stat(resolvedInputPath)
    const targetFiles = inputStats.isDirectory()
      ? await listDirectoryFiles(resolvedInputPath, projectRoot, configManager)
      : inputStats.isFile()
        ? [resolvedInputPath]
        : []

    const addTargets: AddTarget[] = targetFiles.map((projectFilePath) => {
      const relativeFilePath = toProjectRelativePath(
        projectRoot,
        projectFilePath,
      )

      return {
        relativeFilePath,
        projectFilePath: ensureProjectOwnsPath(projectRoot, relativeFilePath),
        destPath: resolveTargetSourcePath(
          sourceRoot,
          relativeFilePath,
          options.targetScope,
        ),
      }
    })

    if (addTargets.length === 0) {
      return undefined
    }

    const copiedTargets = await Promise.all(
      addTargets.map(
        async ({ relativeFilePath, projectFilePath, destPath }) => {
          await copyFileAtomic(projectFilePath, destPath)
          const [hash, projectStats] = await Promise.all([
            getFileHash(destPath),
            stat(projectFilePath),
          ])

          return {
            relativeFilePath,
            hash,
            lastSync: projectStats.mtime.toISOString(),
          }
        },
      ),
    )

    configManager.setProjectMetadata({
      syncedFiles: copiedTargets.reduce<Record<string, string>>(
        (syncedFiles, { relativeFilePath, lastSync }) => ({
          ...syncedFiles,
          [relativeFilePath]: lastSync,
        }),
        { ...metadata.syncedFiles },
      ),
      fileHashes: copiedTargets.reduce<Record<string, string>>(
        (fileHashes, { relativeFilePath, hash }) => ({
          ...fileHashes,
          [relativeFilePath]: hash,
        }),
        { ...metadata.fileHashes },
      ),
    })

    return copiedTargets.length
  } catch (error) {
    if (error instanceof NestedProjectOwnershipError) {
      throw error
    }

    return undefined
  }
}

export const detectConflicts = async (
  projectRoot: string,
  configManager: ConfigManager,
): Promise<FileStatusInfo[]> => {
  const sourceRoot = await ensureSourceDir(configManager)
  const metadata = configManager.getProjectMetadata()
  const sourceFiles = await listEffectiveSourceFiles(sourceRoot, metadata.scope)
  const statuses = await Promise.all(
    sourceFiles.map(
      async ({
        file,
        path: sourceFilePath,
      }): Promise<FileStatusInfo | undefined> => {
        const { projectFilePath } = resolveProjectFilePath(projectRoot, file)

        if (await isIgnored(projectFilePath, projectRoot, configManager)) {
          return undefined
        }

        const projectExists = await pathExists(projectFilePath)
        const lastSync = getMetadataEntry(metadata.syncedFiles, file)

        if (!projectExists) {
          return {
            file,
            status: 'missing',
            lastSync,
          }
        }

        const [projectHash, sourceHash] = await Promise.all([
          getFileHash(projectFilePath),
          getFileHash(sourceFilePath),
        ])
        const storedHash = getMetadataEntry(metadata.fileHashes, file)

        return {
          file,
          status: getDetectedStatus(storedHash, projectHash, sourceHash),
          lastSync,
        }
      },
    ),
  )

  return statuses
    .filter((status): status is FileStatusInfo => status !== undefined)
    .sort((a, b) => a.file.localeCompare(b.file))
}
