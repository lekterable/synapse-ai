import { readdir, rm, stat } from 'fs/promises'
import { mkdirp, pathExists } from 'fs-extra'
import { dirname, join, relative, resolve } from 'path'
import { homedir } from 'os'
import { type ConfigManager } from './config'
import { normalizeRelativePath, resolveWithin } from './utils/paths'

export const SCOPES_DIRECTORY = 'scopes'

export type SourceFileLocation = {
  file: string
  path: string
  scope?: string
}

const getSourcePath = (configManager: ConfigManager): string => {
  try {
    return configManager.getSourcePath()
  } catch {
    return resolve(homedir(), '.synapse', 'source')
  }
}

const createDirectories = async (basePath: string): Promise<void> => {
  await Promise.all([
    mkdirp(basePath, { mode: 0o755 }),
    mkdirp(join(basePath, SCOPES_DIRECTORY), { mode: 0o755 }),
  ])
}

const listSourceFiles = async (
  rootDir: string,
  currentDir: string = rootDir,
  skipScopesAtRoot: boolean = false,
): Promise<string[]> => {
  if (!(await pathExists(rootDir))) {
    return []
  }

  const entries = await readdir(currentDir, { withFileTypes: true })
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      if (
        skipScopesAtRoot &&
        currentDir === rootDir &&
        entry.name === SCOPES_DIRECTORY
      ) {
        return []
      }

      const absolutePath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        return listSourceFiles(rootDir, absolutePath)
      }

      if (!entry.isFile()) {
        return []
      }

      const relativePath = normalizeRelativePath(
        relative(rootDir, absolutePath),
      )
      return relativePath ? [relativePath] : []
    }),
  )

  return nestedFiles.flat().sort((a, b) => a.localeCompare(b))
}

const removeEmptyParentDirectories = async (
  startPath: string,
  stopPath: string,
): Promise<void> => {
  const parentPath = resolve(startPath)
  const normalizedStopPath = resolve(stopPath)

  if (parentPath === normalizedStopPath) {
    return
  }

  const entries = await readdir(parentPath)
  if (entries.length > 0) {
    return
  }

  await rm(parentPath, { recursive: false, force: true })
  await removeEmptyParentDirectories(dirname(parentPath), normalizedStopPath)
}

const normalizeScope = (scope: string): string => {
  const trimmedScope = scope.trim()

  if (!/^[A-Za-z0-9._-]+$/.test(trimmedScope)) {
    throw new Error(
      'Scope names may only contain letters, numbers, dots, hyphens, and underscores',
    )
  }

  return trimmedScope
}

const assertAllowedSourceRelativePath = (relativeFilePath: string): string => {
  const normalizedPath = normalizeRelativePath(relativeFilePath)

  if (
    !normalizedPath ||
    normalizedPath === SCOPES_DIRECTORY ||
    normalizedPath.startsWith(`${SCOPES_DIRECTORY}/`)
  ) {
    throw new Error(`Path uses reserved source namespace: ${relativeFilePath}`)
  }

  return normalizedPath
}

export const validateScopeName = (scope: string): string => {
  return normalizeScope(scope)
}

export const resolveSharedSourcePath = (
  sourceRoot: string,
  relativeFilePath: string,
): string => {
  return resolveWithin(
    sourceRoot,
    assertAllowedSourceRelativePath(relativeFilePath),
  )
}

export const resolveScopedSourcePath = (
  sourceRoot: string,
  scope: string,
  relativeFilePath: string,
): string => {
  return resolveWithin(
    sourceRoot,
    join(
      SCOPES_DIRECTORY,
      normalizeScope(scope),
      assertAllowedSourceRelativePath(relativeFilePath),
    ),
  )
}

export const resolveTargetSourcePath = (
  sourceRoot: string,
  relativeFilePath: string,
  scope: string | undefined,
): string => {
  return scope
    ? resolveScopedSourcePath(sourceRoot, scope, relativeFilePath)
    : resolveSharedSourcePath(sourceRoot, relativeFilePath)
}

const getScopeRootPath = (
  sourceRoot: string,
  scope: string | undefined,
): string => {
  return scope
    ? resolveWithin(sourceRoot, join(SCOPES_DIRECTORY, normalizeScope(scope)))
    : sourceRoot
}

export const resolveEffectiveSourceFile = async (
  sourceRoot: string,
  relativeFilePath: string,
  scope: string | undefined,
): Promise<SourceFileLocation | undefined> => {
  const normalizedPath = assertAllowedSourceRelativePath(relativeFilePath)
  const scopedPath = scope
    ? resolveScopedSourcePath(sourceRoot, scope, normalizedPath)
    : undefined

  if (scopedPath && (await pathExists(scopedPath))) {
    return {
      file: normalizedPath,
      path: scopedPath,
      scope,
    }
  }

  const sharedPath = resolveSharedSourcePath(sourceRoot, normalizedPath)
  return (await pathExists(sharedPath))
    ? {
        file: normalizedPath,
        path: sharedPath,
      }
    : undefined
}

export const listEffectiveSourceFiles = async (
  sourceRoot: string,
  scope: string | undefined,
): Promise<SourceFileLocation[]> => {
  const sharedFiles = await listSourceFiles(sourceRoot, sourceRoot, true)
  const sharedEntries = sharedFiles.map(
    (file) =>
      [
        file,
        { file, path: resolveSharedSourcePath(sourceRoot, file) },
      ] as const,
  )

  const scopedFiles = scope
    ? await listSourceFiles(
        resolveWithin(
          sourceRoot,
          join(SCOPES_DIRECTORY, normalizeScope(scope)),
        ),
      )
    : []
  const scopedEntries = scope
    ? scopedFiles.map(
        (file) =>
          [
            file,
            {
              file,
              path: resolveScopedSourcePath(sourceRoot, scope, file),
              scope,
            },
          ] as const,
      )
    : []

  return [...new Map([...sharedEntries, ...scopedEntries]).values()].sort(
    (a, b) => a.file.localeCompare(b.file),
  )
}

export const removeSourcePath = async (
  sourceRoot: string,
  relativeFilePath: string,
  scope: string | undefined,
): Promise<number | undefined> => {
  const targetPath = resolveTargetSourcePath(
    sourceRoot,
    relativeFilePath,
    scope,
  )

  if (!(await pathExists(targetPath))) {
    return undefined
  }

  const targetStats = await stat(targetPath)
  const fileCount = targetStats.isDirectory()
    ? (await listSourceFiles(targetPath)).length
    : 1

  await rm(targetPath, { recursive: true, force: false })
  await removeEmptyParentDirectories(
    resolve(targetPath, '..'),
    getScopeRootPath(sourceRoot, scope),
  )

  return fileCount
}

export const ensureSourceDir = async (
  configManager: ConfigManager,
): Promise<string> => {
  const sourcePath = getSourcePath(configManager)
  await createDirectories(sourcePath)
  return sourcePath
}
