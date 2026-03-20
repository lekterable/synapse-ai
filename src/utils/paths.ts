import { isAbsolute, normalize, relative, resolve } from 'path'

const toPortablePath = (inputPath: string): string =>
  inputPath.split('\\').join('/')

export const isSubPath = (basePath: string, targetPath: string): boolean => {
  const normalizedBase = resolve(basePath)
  const normalizedTarget = resolve(targetPath)
  const relativePath = relative(normalizedBase, normalizedTarget)

  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

export const normalizeRelativePath = (inputPath: string): string => {
  const normalized = normalize(inputPath).replace(/^\.([/\\]|$)/, '')
  return toPortablePath(normalized).replace(/^\/+/, '')
}

export const resolveWithin = (basePath: string, targetPath: string): string => {
  const resolvedTarget = resolve(basePath, targetPath)
  if (!isSubPath(basePath, resolvedTarget)) {
    throw new Error(`Path escapes base directory: ${targetPath}`)
  }
  return resolvedTarget
}

export const toProjectRelativePath = (
  projectRoot: string,
  inputPath: string,
  basePath: string = projectRoot,
): string => {
  const resolvedPath = isAbsolute(inputPath)
    ? inputPath
    : resolve(basePath, inputPath)

  if (!isSubPath(projectRoot, resolvedPath)) {
    throw new Error(`File is outside the project root: ${inputPath}`)
  }

  const relativePath = relative(resolve(projectRoot), resolvedPath)
  const normalizedRelativePath = normalizeRelativePath(relativePath)

  if (
    normalizedRelativePath === '' ||
    normalizedRelativePath === '.' ||
    normalizedRelativePath === '..' ||
    normalizedRelativePath.startsWith('../')
  ) {
    throw new Error(`Invalid project-relative file path: ${inputPath}`)
  }

  return normalizedRelativePath
}
