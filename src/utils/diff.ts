import { open, readFile } from 'fs/promises'
import chalk from 'chalk'
import { diffLines } from 'diff'
import { pathExists } from 'fs-extra'

const isTextFile = async (filePath: string): Promise<boolean> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(filePath, 'r')
    const probe = Buffer.alloc(8000)
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0)
    return !probe.subarray(0, bytesRead).includes(0)
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => {})
  }
}

export const diffFiles = async (
  sourcePath: string,
  projectPath: string,
): Promise<string | undefined> => {
  const sourceExists = await pathExists(sourcePath)
  const projectExists = await pathExists(projectPath)

  if (!sourceExists && !projectExists) {
    return undefined
  }

  if (!sourceExists) {
    return 'Source file does not exist'
  }

  if (!projectExists) {
    return 'Project file does not exist'
  }

  if (!(await isTextFile(sourcePath)) || !(await isTextFile(projectPath))) {
    return 'Binary files differ'
  }

  const sourceContent = await readFile(sourcePath, 'utf-8')
  const projectContent = await readFile(projectPath, 'utf-8')

  const changes = diffLines(sourceContent, projectContent)

  const [firstChange] = changes

  if (
    changes.length === 1 &&
    firstChange !== undefined &&
    !firstChange.added &&
    !firstChange.removed
  ) {
    return undefined
  }

  return changes
    .map((change) =>
      change.added
        ? chalk.green('+' + change.value)
        : change.removed
          ? chalk.red('-' + change.value)
          : ' ' + change.value,
    )
    .join('')
}
