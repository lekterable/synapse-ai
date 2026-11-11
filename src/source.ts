import { existsSync, readdirSync } from 'node:fs'
import { lstat, readdir, readlink, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import { mkdirp, pathExists } from 'fs-extra'
import type { ConfigManager } from './config'
import { normalizeRelativePath, resolveWithin } from './utils/paths'

export const SCOPES_DIRECTORY = 'scopes'
export const BLOCKS_DIRECTORY = 'blocks'
const RESERVED_SOURCE_DIRECTORIES = [
  SCOPES_DIRECTORY,
  BLOCKS_DIRECTORY,
] as const

const isReservedSourceDirectoryName = (name: string): boolean =>
  (RESERVED_SOURCE_DIRECTORIES as readonly string[]).includes(name)

const isReservedSourceRelativePath = (relativeFilePath: string): boolean => {
  const normalizedPath = normalizeRelativePath(relativeFilePath)

  return RESERVED_SOURCE_DIRECTORIES.some(
    (directory) =>
      normalizedPath === directory ||
      normalizedPath.startsWith(`${directory}/`),
  )
}

export const reservedSourceNamespaceHint = RESERVED_SOURCE_DIRECTORIES.map(
  (directory) => `"${directory}/"`,
).join(' or ')

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

// A link syncs only when it is relative, stays inside the layer it is synced from and points at
// something that layer syncs too, so it resolves to the same file in every project.
const isSyncableLink = async (
  absolutePath: string,
  relativePath: string,
  skipReservedAtRoot: boolean,
): Promise<boolean> => {
  const target = await readlink(absolutePath)
  const resolved = normalizeRelativePath(
    posix.join(posix.dirname(relativePath), target.split('\\').join('/')),
  )
  const syncable =
    !isAbsolute(target) &&
    resolved !== '' &&
    resolved !== '..' &&
    !resolved.startsWith('../') &&
    !(skipReservedAtRoot && isReservedSourceRelativePath(resolved)) &&
    (await pathExists(absolutePath))

  if (!syncable) {
    console.warn(
      `Skipping ${relativePath}: a synced symlink must be relative and point at an existing file or folder in the same source layer`,
    )
  }

  return syncable
}

const listSourceFiles = async (
  rootDir: string,
  currentDir: string = rootDir,
  skipReservedAtRoot: boolean = false,
): Promise<string[]> => {
  if (!(await pathExists(rootDir))) {
    return []
  }

  const entries = await readdir(currentDir, { withFileTypes: true })
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      if (
        skipReservedAtRoot &&
        currentDir === rootDir &&
        isReservedSourceDirectoryName(entry.name)
      ) {
        return []
      }

      const absolutePath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        return listSourceFiles(rootDir, absolutePath, skipReservedAtRoot)
      }

      const relativePath = normalizeRelativePath(
        relative(rootDir, absolutePath),
      )

      if (entry.isSymbolicLink()) {
        return (await isSyncableLink(
          absolutePath,
          relativePath,
          skipReservedAtRoot,
        ))
          ? [relativePath]
          : []
      }

      if (!entry.isFile()) {
        return []
      }

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

const parseScopeParts = (scope: string): string[] => {
  const scopeParts = scope
    .split(/[,+]/)
    .map((scopePart) => scopePart.trim().toLowerCase())
    .filter(Boolean)

  if (
    scopeParts.length === 0 ||
    scopeParts.some((scopePart) => !/^[a-z0-9._-]+$/.test(scopePart))
  ) {
    throw new Error(
      'Scope names may only contain letters, numbers, dots, hyphens, underscores, commas, and plus signs',
    )
  }

  return [...new Set(scopeParts)].sort((a, b) => a.localeCompare(b))
}

const normalizeScope = (scope: string): string => {
  return parseScopeParts(scope).join('+')
}

const isScopeSubset = (sourceScope: string, projectScope: string): boolean => {
  const projectScopes = new Set(parseScopeParts(projectScope))

  return parseScopeParts(sourceScope).every((scope) => projectScopes.has(scope))
}

const assertAllowedSourceRelativePath = (relativeFilePath: string): string => {
  const normalizedPath = normalizeRelativePath(relativeFilePath)

  if (!normalizedPath || isReservedSourceRelativePath(normalizedPath)) {
    throw new Error(`Path uses reserved source namespace: ${relativeFilePath}`)
  }

  return normalizedPath
}

export const validateScopeName = (scope: string): string => {
  return normalizeScope(scope)
}

export const formatScopeForDisplay = (scope: string): string => {
  return parseScopeParts(scope).join(', ')
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

// Source scope keys contained by the project scope, broadest first.
export const matchingScopeKeys = (
  sourceRoot: string,
  projectScope: string | undefined,
): string[] => {
  const scopesRoot = resolveWithin(sourceRoot, SCOPES_DIRECTORY)

  if (!projectScope || !existsSync(scopesRoot)) {
    return []
  }

  return [
    ...new Set(
      readdirSync(scopesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => normalizeScope(entry.name)),
    ),
  ]
    .filter((scope) => isScopeSubset(scope, projectScope))
    .sort((leftScope, rightScope) => {
      const specificity =
        parseScopeParts(leftScope).length - parseScopeParts(rightScope).length

      return specificity === 0
        ? leftScope.localeCompare(rightScope)
        : specificity
    })
}

export const resolveEffectiveSourceFile = async (
  sourceRoot: string,
  relativeFilePath: string,
  scope: string | undefined,
): Promise<SourceFileLocation | undefined> => {
  const normalizedPath = assertAllowedSourceRelativePath(relativeFilePath)

  const scopeKeys = matchingScopeKeys(sourceRoot, scope)
  const scopedSourceFile = await [...scopeKeys]
    .reverse()
    .reduce<Promise<SourceFileLocation | undefined>>(
      async (matchedFilePromise, scopeKey) => {
        const matchedFile = await matchedFilePromise

        if (matchedFile) {
          return matchedFile
        }

        const scopedPath = resolveScopedSourcePath(
          sourceRoot,
          scopeKey,
          normalizedPath,
        )

        return (await pathExists(scopedPath))
          ? {
              file: normalizedPath,
              path: scopedPath,
              scope: scopeKey,
            }
          : undefined
      },
      Promise.resolve(undefined),
    )

  if (scopedSourceFile) {
    return scopedSourceFile
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

  const scopeKeys = matchingScopeKeys(sourceRoot, scope)
  const scopedEntries = (
    await Promise.all(
      scopeKeys.map(async (scopeKey) =>
        (
          await listSourceFiles(
            resolveWithin(sourceRoot, join(SCOPES_DIRECTORY, scopeKey)),
            undefined,
            true,
          )
        ).map(
          (file) =>
            [
              file,
              {
                file,
                path: resolveScopedSourcePath(sourceRoot, scopeKey, file),
                scope: scopeKey,
              },
            ] as const,
        ),
      ),
    )
  ).flat()

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

  const targetStats = await lstat(targetPath).catch(() => undefined)
  if (!targetStats) {
    return undefined
  }

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
