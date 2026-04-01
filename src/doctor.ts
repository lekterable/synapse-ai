import { readdir, readFile, stat, writeFile } from 'fs/promises'
import { mkdirp, pathExists } from 'fs-extra'
import { join, relative } from 'path'
import { pathToFileURL } from 'url'
import type { ConfigManager, ProjectMetadata } from './config'

export type DoctorFindingLevel = 'error' | 'warning' | 'info'

export type DoctorFinding = {
  level: DoctorFindingLevel
  code: string
  file?: string
  message: string
  fix?: string
}

type DoctorContext = {
  projectRoot: string
  metadata: ProjectMetadata
  hasFile: (relativePath: string) => Promise<boolean>
  readTextFile: (relativePath: string) => Promise<string | undefined>
  listFiles: (relativeDir?: string) => Promise<string[]>
}

type DoctorChecker = {
  id: string
  fileName: string
  run: (context: DoctorContext) => Promise<DoctorFinding[]>
  scaffoldContent: string
}

type CustomDoctorModule = {
  default?: (
    context: DoctorContext,
  ) => Promise<DoctorFinding[] | DoctorFinding[]>
}

export const DOCTOR_CHECKS_DIRECTORY = join('.synapse', 'checks')

const buildDoctorContext = (
  projectRoot: string,
  metadata: ProjectMetadata,
): DoctorContext => {
  const toRelativePath = (absolutePath: string): string =>
    relative(projectRoot, absolutePath).split('\\').join('/')

  const listFiles = async (relativeDir: string = '.'): Promise<string[]> => {
    const startPath = join(projectRoot, relativeDir)

    if (!(await pathExists(startPath))) {
      return []
    }

    const startStats = await stat(startPath)
    if (!startStats.isDirectory()) {
      return []
    }

    const walk = async (directoryPath: string): Promise<string[]> => {
      const entries = await readdir(directoryPath, { withFileTypes: true })
      const nestedFiles = await Promise.all(
        entries.map(async (entry) => {
          const absolutePath = join(directoryPath, entry.name)

          if (entry.isDirectory()) {
            return walk(absolutePath)
          }

          return entry.isFile() ? [toRelativePath(absolutePath)] : []
        }),
      )

      return nestedFiles.flat()
    }

    return walk(startPath)
  }

  const hasFile = async (relativePath: string): Promise<boolean> =>
    pathExists(join(projectRoot, relativePath))

  const readTextFile = async (
    relativePath: string,
  ): Promise<string | undefined> => {
    const absolutePath = join(projectRoot, relativePath)

    if (!(await pathExists(absolutePath))) {
      return undefined
    }

    return readFile(absolutePath, 'utf-8')
  }

  return {
    projectRoot,
    metadata,
    hasFile,
    readTextFile,
    listFiles,
  }
}

const deprecatedCursorRulesChecker: DoctorChecker = {
  id: 'deprecated-cursor-rules',
  fileName: 'deprecated-cursor-rules.js',
  run: async ({ hasFile }) => {
    if (!(await hasFile('.cursorrules'))) {
      return []
    }

    return [
      {
        level: 'warning',
        code: 'deprecated-cursor-rules',
        file: '.cursorrules',
        message: 'Legacy Cursor rules file detected',
        fix: 'Move rules into .cursor/rules/*.mdc instead of using .cursorrules',
      },
    ]
  },
  scaffoldContent: `export default async function run({ hasFile }) {
  if (!(await hasFile('.cursorrules'))) {
    return []
  }

  return [
    {
      level: 'warning',
      code: 'deprecated-cursor-rules',
      file: '.cursorrules',
      message: 'Legacy Cursor rules file detected',
      fix: 'Move rules into .cursor/rules/*.mdc instead of using .cursorrules',
    },
  ]
}
`,
}

const emptyInstructionFilesChecker: DoctorChecker = {
  id: 'empty-instruction-files',
  fileName: 'empty-instruction-files.js',
  run: async ({ hasFile, listFiles, readTextFile }) => {
    const directCandidates = [
      'AGENTS.md',
      'CLAUDE.md',
      '.github/copilot-instructions.md',
    ]
    const cursorCandidates = (await listFiles('.cursor/rules')).filter(
      (file) => file.endsWith('.md') || file.endsWith('.mdc'),
    )
    const candidates = [...directCandidates, ...cursorCandidates]
    const contents = await Promise.all(
      candidates.map(async (file) => ({
        file,
        exists: cursorCandidates.includes(file) ? true : await hasFile(file),
        content: await readTextFile(file),
      })),
    )

    return contents.flatMap(({ file, exists, content }) =>
      exists && content !== undefined && content.trim() === ''
        ? [
            {
              level: 'warning' as const,
              code: 'empty-instruction-file',
              file,
              message: 'AI instruction file is empty',
              fix: 'Add instructions to the file or remove it if it is no longer needed',
            },
          ]
        : [],
    )
  },
  scaffoldContent: `export default async function run({ hasFile, listFiles, readTextFile }) {
  const directCandidates = [
    'AGENTS.md',
    'CLAUDE.md',
    '.github/copilot-instructions.md',
  ]
  const cursorCandidates = (await listFiles('.cursor/rules')).filter((file) =>
    file.endsWith('.md') || file.endsWith('.mdc'),
  )
  const candidates = [...directCandidates, ...cursorCandidates]
  const contents = await Promise.all(
    candidates.map(async (file) => ({
      file,
      exists: cursorCandidates.includes(file) ? true : await hasFile(file),
      content: await readTextFile(file),
    })),
  )

  return contents.flatMap(({ file, exists, content }) =>
    exists && content !== undefined && content.trim() === ''
      ? [
          {
            level: 'warning',
            code: 'empty-instruction-file',
            file,
            message: 'AI instruction file is empty',
            fix: 'Add instructions to the file or remove it if it is no longer needed',
          },
        ]
      : [],
  )
}
`,
}

const missingInstructionFilesChecker: DoctorChecker = {
  id: 'missing-ai-instruction-files',
  fileName: 'missing-ai-instruction-files.js',
  run: async ({ hasFile, listFiles }) => {
    const hasKnownInstructionFile =
      (await hasFile('AGENTS.md')) ||
      (await hasFile('CLAUDE.md')) ||
      (await hasFile('.github/copilot-instructions.md')) ||
      (await listFiles('.cursor/rules')).some(
        (file) => file.endsWith('.md') || file.endsWith('.mdc'),
      )

    return hasKnownInstructionFile
      ? []
      : [
          {
            level: 'info',
            code: 'missing-ai-instruction-files',
            message: 'No AI instruction files were found in this project',
            fix: 'Add AGENTS.md, CLAUDE.md, or .cursor/rules files to make Synapse more useful here',
          },
        ]
  },
  scaffoldContent: `export default async function run({ hasFile, listFiles }) {
  const hasKnownInstructionFile =
    (await hasFile('AGENTS.md')) ||
    (await hasFile('CLAUDE.md')) ||
    (await hasFile('.github/copilot-instructions.md')) ||
    (await listFiles('.cursor/rules')).some(
      (file) => file.endsWith('.md') || file.endsWith('.mdc'),
    )

  return hasKnownInstructionFile
    ? []
    : [
        {
          level: 'info',
          code: 'missing-ai-instruction-files',
          message: 'No AI instruction files were found in this project',
          fix: 'Add AGENTS.md, CLAUDE.md, or .cursor/rules files to make Synapse more useful here',
        },
      ]
}
`,
}

const BUILT_IN_CHECKERS: DoctorChecker[] = [
  deprecatedCursorRulesChecker,
  emptyInstructionFilesChecker,
  missingInstructionFilesChecker,
]

const getDoctorChecksPath = (projectRoot: string): string =>
  join(projectRoot, DOCTOR_CHECKS_DIRECTORY)

const listCustomCheckerPaths = async (
  projectRoot: string,
): Promise<string[]> => {
  const checksPath = getDoctorChecksPath(projectRoot)

  if (!(await pathExists(checksPath))) {
    return []
  }

  const entries = await readdir(checksPath, { withFileTypes: true })
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith('.js') ||
          entry.name.endsWith('.mjs') ||
          entry.name.endsWith('.cjs')),
    )
    .map((entry) => join(checksPath, entry.name))
    .sort((a, b) => a.localeCompare(b))
}

const runCustomChecker = async (
  checkerPath: string,
  context: DoctorContext,
): Promise<DoctorFinding[]> => {
  const importedModule = (await import(
    pathToFileURL(checkerPath).href
  )) as CustomDoctorModule

  if (typeof importedModule.default !== 'function') {
    throw new Error(
      `Custom doctor check does not export a default function: ${checkerPath}`,
    )
  }

  const findings = await importedModule.default(context)
  return Array.isArray(findings) ? findings : []
}

export const scaffoldDoctorChecks = async (
  projectRoot: string,
): Promise<void> => {
  const checksPath = getDoctorChecksPath(projectRoot)
  await mkdirp(checksPath)

  await Promise.all(
    BUILT_IN_CHECKERS.map((checker) =>
      writeFile(
        join(checksPath, checker.fileName),
        checker.scaffoldContent,
        'utf-8',
      ),
    ),
  )
}

export const runDoctorChecks = async (
  projectRoot: string,
  metadata: ProjectMetadata,
): Promise<DoctorFinding[]> => {
  const context = buildDoctorContext(projectRoot, metadata)
  const customCheckerPaths = await listCustomCheckerPaths(projectRoot)

  if (customCheckerPaths.length > 0) {
    const customFindings = await Promise.all(
      customCheckerPaths.map(async (checkerPath) => {
        try {
          return await runCustomChecker(checkerPath, context)
        } catch (error) {
          return [
            {
              level: 'error' as const,
              code: 'custom-check-failed',
              file: relative(projectRoot, checkerPath).split('\\').join('/'),
              message: 'Custom doctor check failed to run',
              fix: error instanceof Error ? error.message : String(error),
            },
          ]
        }
      }),
    )

    return customFindings.flat()
  }

  const builtInFindings = await Promise.all(
    BUILT_IN_CHECKERS.map((checker) => checker.run(context)),
  )
  return builtInFindings.flat()
}

export const isDoctorInitialized = (metadata: ProjectMetadata): boolean =>
  metadata.doctor?.initialized === true

export const markDoctorInitialized = (
  configManager: ConfigManager,
): ProjectMetadata => {
  configManager.setProjectMetadata({
    doctor: {
      initialized: true,
    },
  })

  return configManager.getProjectMetadata()
}
