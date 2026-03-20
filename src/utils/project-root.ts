import { existsSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { normalizeRelativePath, resolveWithin } from './paths'

export const PROJECT_METADATA_FILENAME = '.synapse.json'

export class NestedProjectOwnershipError extends Error {
  constructor(
    projectRoot: string,
    relativeFilePath: string,
    nestedRoot: string,
  ) {
    const nestedRootLabel = normalizeRelativePath(
      relative(projectRoot, nestedRoot),
    )

    super(
      `File "${relativeFilePath}" belongs to nested synapse project "${nestedRootLabel}"`,
    )
    this.name = 'NestedProjectOwnershipError'
  }
}

const hasProjectMetadata = (projectRoot: string): boolean =>
  existsSync(join(projectRoot, PROJECT_METADATA_FILENAME))

const findParentWithMetadata = (currentPath: string): string | undefined => {
  const resolvedPath = resolve(currentPath)

  if (hasProjectMetadata(resolvedPath)) {
    return resolvedPath
  }

  const parentPath = dirname(resolvedPath)
  return parentPath === resolvedPath
    ? undefined
    : findParentWithMetadata(parentPath)
}

export const findNearestProjectRoot = (
  startPath: string,
): string | undefined => {
  return findParentWithMetadata(startPath)
}

export const resolveInitProjectRoot = (
  rootFlag: string | undefined,
  cwd: string = process.cwd(),
): string => {
  return resolve(cwd, rootFlag || '.')
}

export const resolveProjectRoot = (
  rootFlag: string | undefined,
  cwd: string = process.cwd(),
): string | undefined => {
  return rootFlag
    ? findNearestProjectRoot(resolve(cwd, rootFlag)) === resolve(cwd, rootFlag)
      ? resolve(cwd, rootFlag)
      : undefined
    : findNearestProjectRoot(cwd)
}

export const isProjectInitialized = (projectRoot: string): boolean => {
  return hasProjectMetadata(projectRoot)
}

const getAncestorDirectories = (
  projectRoot: string,
  targetPath: string,
): string[] => {
  const relativeTargetDir = normalizeRelativePath(
    relative(resolve(projectRoot), dirname(resolve(targetPath))),
  )
  const segments = relativeTargetDir ? relativeTargetDir.split('/') : []

  return segments.reduce<string[]>(
    (directories, _, index) => [
      ...directories,
      resolve(projectRoot, segments.slice(0, index + 1).join('/')),
    ],
    [],
  )
}

export const findNestedProjectRootForPath = (
  projectRoot: string,
  targetPath: string,
): string | undefined => {
  return getAncestorDirectories(projectRoot, targetPath).find(
    hasProjectMetadata,
  )
}

export const ensureProjectOwnsPath = (
  projectRoot: string,
  relativeFilePath: string,
): string => {
  const projectFilePath = resolveWithin(projectRoot, relativeFilePath)
  const nestedProjectRoot = findNestedProjectRootForPath(
    projectRoot,
    projectFilePath,
  )

  if (nestedProjectRoot) {
    throw new NestedProjectOwnershipError(
      projectRoot,
      relativeFilePath,
      nestedProjectRoot,
    )
  }

  return projectFilePath
}
