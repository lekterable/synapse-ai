import { spawnSync } from 'child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

type CliResult = {
  status?: number
  stdout: string
  stderr: string
}

type Sandbox = {
  root: string
  home: string
  repo: string
  web: string
  webSrc: string
  webConsumer: string
  webConsumerSrc: string
  mobile: string
  scratch: string
}

type SourceSetup = {
  scopedFile: string
  sharedFile: string
}

const cliPath = join(process.cwd(), 'dist', 'cli.js')
let sandboxes: string[] = []
let sandbox: Sandbox

const stripAnsi = (value: string): string =>
  value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')

const normalizeMacPrivatePath = (pathValue: string): string =>
  pathValue.replace(/^\/private(?=\/var\/)/, '')

const createSandbox = async (): Promise<Sandbox> => {
  const root = await mkdtemp(join(tmpdir(), 'synapse-cli-test-'))
  const home = join(root, 'home')
  const repo = join(root, 'repo')
  const web = join(repo, 'apps', 'web')
  const webSrc = join(web, 'src')
  const webConsumer = join(repo, 'apps', 'web-consumer')
  const webConsumerSrc = join(webConsumer, 'src')
  const mobile = join(repo, 'apps', 'mobile')
  const scratch = join(root, 'scratch')

  await Promise.all(
    [home, repo, web, webSrc, webConsumer, webConsumerSrc, mobile, scratch].map(
      (directory) => mkdir(directory, { recursive: true }),
    ),
  )

  sandboxes = [...sandboxes, root]
  return {
    root,
    home,
    repo,
    web,
    webSrc,
    webConsumer,
    webConsumerSrc,
    mobile,
    scratch,
  }
}

const runCli = (
  cwd: string,
  home: string,
  args: string[],
  input?: string,
): CliResult => {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
    input,
    env: {
      ...process.env,
      HOME: home,
      COLUMNS: '200',
      LINES: '40',
    },
  })

  return {
    status: result.status ?? undefined,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

const expectError = (
  result: CliResult,
  expected: {
    problem: string
    reason: string
    fix: string
  },
): void => {
  const stderr = stripAnsi(result.stderr)

  expect(result.status).toBe(1)
  expect(stderr).toContain(`Error: ${expected.problem}`)
  expect(stderr).toContain(`Reason: ${expected.reason}`)
  expect(stderr).toContain(`Fix: ${expected.fix}`)
}

const getSourceRoot = (home: string): string => join(home, '.synapse', 'source')

const getGlobalConfigPath = (home: string): string =>
  join(home, '.config', 'synapse', 'config.json')

const getProjectMetadataPath = (projectRoot: string): string =>
  join(projectRoot, '.synapse.json')

const writeSourceFile = async (
  home: string,
  relativeFilePath: string,
  content: string,
): Promise<void> => {
  const filePath = join(getSourceRoot(home), relativeFilePath)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

const initializeParentAndNestedProjects = async (
  sandbox: Sandbox,
): Promise<void> => {
  expect(runCli(sandbox.repo, sandbox.home, ['init']).status).toBe(0)
  expect(
    runCli(sandbox.repo, sandbox.home, [
      'init',
      '--root',
      'apps/web',
      '--scope',
      'web',
    ]).status,
  ).toBe(0)
}

const initializeScopedProjects = async (
  sandbox: Sandbox,
): Promise<SourceSetup> => {
  const scopedFile = '.cursorrules'
  const sharedFile = 'AGENTS.md'

  await Promise.all([
    writeFile(join(sandbox.web, scopedFile), 'web-rule-v1\n', 'utf-8'),
    writeFile(join(sandbox.web, sharedFile), 'shared-agents-v1\n', 'utf-8'),
  ])

  expect(
    runCli(sandbox.repo, sandbox.home, [
      'init',
      '--root',
      'apps/web',
      '--scope',
      'web',
    ]).status,
  ).toBe(0)
  expect(
    runCli(sandbox.repo, sandbox.home, [
      'init',
      '--root',
      'apps/web-consumer',
      '--scope',
      'web',
    ]).status,
  ).toBe(0)
  expect(
    runCli(sandbox.repo, sandbox.home, [
      'init',
      '--root',
      'apps/mobile',
      '--scope',
      'mobile',
    ]).status,
  ).toBe(0)

  expect(
    runCli(sandbox.repo, sandbox.home, [
      'add',
      scopedFile,
      '--root',
      'apps/web',
    ]).status,
  ).toBe(0)
  expect(
    runCli(sandbox.repo, sandbox.home, [
      'add',
      sharedFile,
      '--root',
      'apps/web',
      '--shared',
    ]).status,
  ).toBe(0)

  return { scopedFile, sharedFile }
}

const prepareConflictScenario = async (
  sandbox: Sandbox,
  scopedFile: string,
): Promise<void> => {
  expect(
    runCli(sandbox.repo, sandbox.home, [
      'sync',
      '--root',
      'apps/web-consumer',
      '--yes',
    ]).status,
  ).toBe(0)

  await writeFile(
    join(sandbox.webConsumer, scopedFile),
    'local-change\n',
    'utf-8',
  )
  await writeFile(join(sandbox.web, scopedFile), 'web-rule-v2\n', 'utf-8')

  expect(
    runCli(sandbox.repo, sandbox.home, [
      'add',
      scopedFile,
      '--root',
      'apps/web',
    ]).status,
  ).toBe(0)
}

afterEach(async () => {
  await Promise.all(
    sandboxes.map((root) => rm(root, { recursive: true, force: true })),
  )
  sandboxes = []
})

describe('synapse', () => {
  beforeEach(async () => {
    sandbox = await createSandbox()
  })

  describe('init', () => {
    it('should initialize a scoped project at an explicit root', async () => {
      const result = runCli(sandbox.repo, sandbox.home, [
        'init',
        '--root',
        'apps/web',
        '--scope',
        'web',
      ])

      expect(result.status).toBe(0)
      const metadata = JSON.parse(
        await readFile(getProjectMetadataPath(sandbox.web), 'utf-8'),
      ) as {
        version: number
        scope?: string
        doctor?: {
          initialized: boolean
        }
      }
      expect(metadata.version).toBe(1)
      expect(metadata.scope).toBe('web')
      expect(metadata.doctor?.initialized).toBe(false)
    })

    it('should return a structured error for invalid scope names', async () => {
      const result = runCli(sandbox.repo, sandbox.home, [
        'init',
        '--root',
        'apps/web',
        '--scope',
        'bad/scope',
      ])

      expectError(result, {
        problem: 'Invalid scope name',
        reason:
          'Scope names may only contain letters, numbers, dots, hyphens, and underscores',
        fix: 'Use letters, numbers, dots, hyphens, or underscores in scope names',
      })
    })
  })

  describe('add', () => {
    it('should store scoped files under source/scopes and shared files at the source root', async () => {
      const { scopedFile, sharedFile } = await initializeScopedProjects(sandbox)

      const sourceRoot = getSourceRoot(sandbox.home)
      expect(
        await readFile(join(sourceRoot, 'scopes', 'web', scopedFile), 'utf-8'),
      ).toBe('web-rule-v1\n')
      expect(await readFile(join(sourceRoot, sharedFile), 'utf-8')).toBe(
        'shared-agents-v1\n',
      )
    })

    it('should resolve add file paths relative to the selected root when --root is provided', async () => {
      await writeFile(
        join(sandbox.web, '.cursorrules'),
        'web-rule-v1\n',
        'utf-8',
      )
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)

      const result = runCli(sandbox.repo, sandbox.home, [
        'add',
        '.cursorrules',
        '--root',
        'apps/web',
      ])

      expect(result.status).toBe(0)
      expect(
        await readFile(
          join(getSourceRoot(sandbox.home), 'scopes', 'web', '.cursorrules'),
          'utf-8',
        ),
      ).toBe('web-rule-v1\n')
    })

    it('should resolve add file paths relative to nested cwd when no --root is provided', async () => {
      await writeFile(join(sandbox.web, 'AGENTS.md'), 'cwd-relative\n', 'utf-8')
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)

      const result = runCli(sandbox.webSrc, sandbox.home, [
        'add',
        '../AGENTS.md',
        '--shared',
      ])

      expect(result.status).toBe(0)
      expect(
        await readFile(join(getSourceRoot(sandbox.home), 'AGENTS.md'), 'utf-8'),
      ).toBe('cwd-relative\n')
    })

    it('should add every file in a directory to the project scope', async () => {
      await mkdir(join(sandbox.web, '.cursor', 'rules'), { recursive: true })
      await Promise.all([
        writeFile(
          join(sandbox.web, '.cursor', 'rules', 'frontend.md'),
          'frontend-rule\n',
          'utf-8',
        ),
        writeFile(
          join(sandbox.web, '.cursor', 'rules', 'backend.md'),
          'backend-rule\n',
          'utf-8',
        ),
      ])
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)

      const result = runCli(sandbox.repo, sandbox.home, [
        'add',
        '.cursor',
        '--root',
        'apps/web',
      ])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Added 2 file(s) to source (scope: web)')
      expect(
        await readFile(
          join(
            getSourceRoot(sandbox.home),
            'scopes',
            'web',
            '.cursor',
            'rules',
            'frontend.md',
          ),
          'utf-8',
        ),
      ).toBe('frontend-rule\n')
      expect(
        await readFile(
          join(
            getSourceRoot(sandbox.home),
            'scopes',
            'web',
            '.cursor',
            'rules',
            'backend.md',
          ),
          'utf-8',
        ),
      ).toBe('backend-rule\n')
    })

    it('should skip ignored files when adding a directory', async () => {
      await mkdir(join(sandbox.web, 'templates', 'node_modules'), {
        recursive: true,
      })
      await Promise.all([
        writeFile(
          join(sandbox.web, 'templates', 'prompt.md'),
          'shared-prompt\n',
          'utf-8',
        ),
        writeFile(
          join(sandbox.web, 'templates', 'node_modules', 'ignored.txt'),
          'ignored\n',
          'utf-8',
        ),
      ])
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)

      const result = runCli(sandbox.repo, sandbox.home, [
        'add',
        'templates',
        '--root',
        'apps/web',
        '--shared',
      ])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Added 1 file(s) to source (shared)')
      expect(
        await readFile(
          join(getSourceRoot(sandbox.home), 'templates', 'prompt.md'),
          'utf-8',
        ),
      ).toBe('shared-prompt\n')
      await expect(
        readFile(
          join(
            getSourceRoot(sandbox.home),
            'templates',
            'node_modules',
            'ignored.txt',
          ),
          'utf-8',
        ),
      ).rejects.toThrow()
    })

    it('should return a structured error when the path argument is missing', async () => {
      const result = runCli(sandbox.web, sandbox.home, ['add'])

      expectError(result, {
        problem: 'No path specified for add command',
        reason: 'The add command requires a file or directory path argument',
        fix: 'Usage: synapse add <path>',
      })
    })
  })

  describe('doctor', () => {
    it('should run built-in checks before doctor setup is initialized', async () => {
      await writeFile(
        join(sandbox.web, '.cursorrules'),
        'legacy cursor rules\n',
        'utf-8',
      )
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)

      const result = runCli(sandbox.repo, sandbox.home, [
        'doctor',
        '--root',
        'apps/web',
      ])
      const stdout = stripAnsi(result.stdout)
      const metadata = JSON.parse(
        await readFile(getProjectMetadataPath(sandbox.web), 'utf-8'),
      ) as {
        doctor?: {
          initialized: boolean
        }
      }

      expect(result.status).toBe(0)
      expect(stdout).toContain('built-in checks only')
      expect(stdout).toContain('Doctor Findings')
      expect(stdout).toContain('Legacy Cursor rules file detected')
      expect(metadata.doctor?.initialized).toBe(false)
    })

    it('should scaffold default checks on first doctor run with --yes', async () => {
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)

      const result = runCli(sandbox.repo, sandbox.home, [
        'doctor',
        '--root',
        'apps/web',
        '--yes',
      ])
      const metadata = JSON.parse(
        await readFile(getProjectMetadataPath(sandbox.web), 'utf-8'),
      ) as {
        doctor?: {
          initialized: boolean
        }
      }

      expect(result.status).toBe(0)
      expect(result.stdout).toContain(
        'Scaffolded default doctor checks in .synapse/checks',
      )
      expect(metadata.doctor?.initialized).toBe(true)
      expect(
        await readFile(
          join(sandbox.web, '.synapse', 'checks', 'deprecated-cursor-rules.js'),
          'utf-8',
        ),
      ).toContain('deprecated-cursor-rules')
    })

    it('should run custom doctor checks from .synapse/checks', async () => {
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)
      await mkdir(join(sandbox.web, '.synapse', 'checks'), { recursive: true })
      await writeFile(
        join(sandbox.web, '.synapse', 'checks', 'custom.js'),
        `export default async function run() {
  return [
    {
      level: 'warning',
      code: 'custom-check',
      file: 'AGENTS.md',
      message: 'Custom doctor warning',
      fix: 'Review this custom test finding',
    },
  ]
}
`,
        'utf-8',
      )

      const result = runCli(sandbox.repo, sandbox.home, [
        'doctor',
        '--root',
        'apps/web',
      ])
      const stdout = stripAnsi(result.stdout)

      expect(result.status).toBe(0)
      expect(stdout).toContain('Custom doctor warning')
      expect(stdout).toContain('AGENTS.md')
      expect(stdout).not.toContain('No AI instruction files were found')
    })
  })

  describe('remove', () => {
    it('should remove a shared file from the source root', async () => {
      const { sharedFile } = await initializeScopedProjects(sandbox)

      const result = runCli(sandbox.repo, sandbox.home, [
        'remove',
        sharedFile,
        '--root',
        'apps/web',
        '--shared',
      ])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Removed 1 file(s) from source (shared)')
      await expect(
        readFile(join(getSourceRoot(sandbox.home), sharedFile), 'utf-8'),
      ).rejects.toThrow()
    })

    it('should remove every file in a directory from the project scope', async () => {
      await mkdir(join(sandbox.web, '.cursor', 'rules'), { recursive: true })
      await Promise.all([
        writeFile(
          join(sandbox.web, '.cursor', 'rules', 'frontend.md'),
          'frontend-rule\n',
          'utf-8',
        ),
        writeFile(
          join(sandbox.web, '.cursor', 'rules', 'backend.md'),
          'backend-rule\n',
          'utf-8',
        ),
      ])
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'add',
          '.cursor',
          '--root',
          'apps/web',
        ]).status,
      ).toBe(0)

      const result = runCli(sandbox.repo, sandbox.home, [
        'remove',
        '.cursor',
        '--root',
        'apps/web',
      ])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain(
        'Removed 2 file(s) from source (scope: web)',
      )
      await expect(
        readFile(
          join(
            getSourceRoot(sandbox.home),
            'scopes',
            'web',
            '.cursor',
            'rules',
            'frontend.md',
          ),
          'utf-8',
        ),
      ).rejects.toThrow()
      await expect(
        readFile(
          join(
            getSourceRoot(sandbox.home),
            'scopes',
            'web',
            '.cursor',
            'rules',
            'backend.md',
          ),
          'utf-8',
        ),
      ).rejects.toThrow()
    })

    it('should return a structured error when the path argument is missing', async () => {
      const result = runCli(sandbox.web, sandbox.home, ['remove'])

      expectError(result, {
        problem: 'No path specified for remove command',
        reason: 'The remove command requires a file or directory path argument',
        fix: 'Usage: synapse remove <path>',
      })
    })

    it('should return a structured error when the path does not exist in the selected source layer', async () => {
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)

      const result = runCli(sandbox.repo, sandbox.home, [
        'remove',
        'AGENTS.md',
        '--root',
        'apps/web',
        '--shared',
      ])

      expectError(result, {
        problem: 'Cannot remove path: AGENTS.md',
        reason:
          'The file or directory does not exist in the selected source layer',
        fix: 'Check the selected path and use --shared or --scope to target the correct source layer',
      })
    })
  })

  describe('sync', () => {
    it('should sync scoped files plus the shared fallback for matching scopes', async () => {
      const { scopedFile, sharedFile } = await initializeScopedProjects(sandbox)

      const result = runCli(sandbox.repo, sandbox.home, [
        'sync',
        '--root',
        'apps/web-consumer',
        '--yes',
      ])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Synced 2 file(s).')
      expect(
        await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8'),
      ).toBe('web-rule-v1\n')
      expect(
        await readFile(join(sandbox.webConsumer, sharedFile), 'utf-8'),
      ).toBe('shared-agents-v1\n')
    })

    it('should not sync files from other scopes', async () => {
      const { sharedFile } = await initializeScopedProjects(sandbox)

      const result = runCli(sandbox.repo, sandbox.home, [
        'sync',
        '--root',
        'apps/mobile',
        '--yes',
      ])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Synced 1 file(s).')
      expect(await readFile(join(sandbox.mobile, sharedFile), 'utf-8')).toBe(
        'shared-agents-v1\n',
      )
      await expect(
        readFile(join(sandbox.mobile, '.cursorrules'), 'utf-8'),
      ).rejects.toThrow()
    })

    it('should use the nearest synapse root when running from a nested directory', async () => {
      const { scopedFile, sharedFile } = await initializeScopedProjects(sandbox)

      const result = runCli(sandbox.webConsumerSrc, sandbox.home, [
        'sync',
        '--yes',
      ])

      expect(result.status).toBe(0)
      expect(
        await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8'),
      ).toBe('web-rule-v1\n')
      expect(
        await readFile(join(sandbox.webConsumer, sharedFile), 'utf-8'),
      ).toBe('shared-agents-v1\n')
    })

    it('should require --yes in non-interactive mode when changes are pending', async () => {
      await initializeScopedProjects(sandbox)

      const result = runCli(sandbox.repo, sandbox.home, [
        'sync',
        '--root',
        'apps/web-consumer',
      ])

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'Confirmation requires interactive terminal',
      )
    })

    it('should not mutate files or metadata with --dry-run', async () => {
      const { scopedFile } = await initializeScopedProjects(sandbox)
      const metadataPath = getProjectMetadataPath(sandbox.webConsumer)
      const metadataBefore = await readFile(metadataPath, 'utf-8')

      const result = runCli(sandbox.repo, sandbox.home, [
        'sync',
        '--root',
        'apps/web-consumer',
        '--dry-run',
      ])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Would sync 2 file(s).')
      await expect(
        readFile(join(sandbox.webConsumer, scopedFile), 'utf-8'),
      ).rejects.toThrow()
      const metadataAfter = await readFile(metadataPath, 'utf-8')
      expect(metadataAfter).toBe(metadataBefore)
    })

    it('should keep local changes with --strategy ours', async () => {
      const { scopedFile } = await initializeScopedProjects(sandbox)
      await prepareConflictScenario(sandbox, scopedFile)

      const result = runCli(sandbox.repo, sandbox.home, [
        'sync',
        '--root',
        'apps/web-consumer',
        '--strategy',
        'ours',
        '--yes',
      ])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No files selected for sync.')
      expect(result.stdout).toContain('Skipped 1 conflict file(s).')
      expect(
        await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8'),
      ).toBe('local-change\n')
    })

    it('should overwrite local changes with --strategy theirs and create a backup', async () => {
      const { scopedFile } = await initializeScopedProjects(sandbox)
      await prepareConflictScenario(sandbox, scopedFile)

      const result = runCli(sandbox.repo, sandbox.home, [
        'sync',
        '--root',
        'apps/web-consumer',
        '--strategy',
        'theirs',
        '--yes',
      ])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Synced 1 file(s).')
      expect(
        await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8'),
      ).toBe('web-rule-v2\n')

      const backups = await readdir(join(sandbox.home, '.synapse', 'backups'))
      expect(backups.length).toBeGreaterThan(0)
    })

    it('should treat --strategy ask with --yes as source-wins', async () => {
      const { scopedFile } = await initializeScopedProjects(sandbox)
      await prepareConflictScenario(sandbox, scopedFile)

      const result = runCli(sandbox.repo, sandbox.home, [
        'sync',
        '--root',
        'apps/web-consumer',
        '--strategy',
        'ask',
        '--yes',
      ])

      expect(result.status).toBe(0)
      expect(
        await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8'),
      ).toBe('web-rule-v2\n')
    })

    it('should return a structured error when no synapse project can be found', async () => {
      const result = runCli(sandbox.scratch, sandbox.home, ['sync', '--yes'])

      expectError(result, {
        problem: 'No synapse project found',
        reason:
          'Synapse could not find a .synapse.json in this directory or any parent directory',
        fix: 'Run "synapse init" here, or pass --root <path> to target another project',
      })
    })

    it('should return a structured error for an invalid conflict strategy', async () => {
      const result = runCli(sandbox.scratch, sandbox.home, [
        'sync',
        '--strategy',
        'broken',
      ])

      expectError(result, {
        problem: 'Invalid conflict strategy',
        reason: 'Invalid --strategy value: broken',
        fix: 'Use one of: ask, theirs, ours, skip',
      })
    })
  })

  describe('list', () => {
    it('should shorten home-relative project paths with a tilde', async () => {
      const homeProject = join(sandbox.home, 'projects', 'local-home-project')
      await mkdir(homeProject, { recursive: true })

      expect(runCli(homeProject, sandbox.home, ['init']).status).toBe(0)

      const result = runCli(sandbox.repo, sandbox.home, ['list'])
      const stdout = stripAnsi(result.stdout)

      expect(result.status).toBe(0)
      expect(stdout).toContain('~/projects/local-home-project')
      expect(stdout).not.toContain(homeProject)
    })

    it('should show last sync dates for active projects', async () => {
      const { scopedFile, sharedFile } = await initializeScopedProjects(sandbox)

      expect(
        runCli(sandbox.repo, sandbox.home, [
          'sync',
          '--root',
          'apps/web-consumer',
          '--yes',
        ]).status,
      ).toBe(0)

      const result = runCli(sandbox.repo, sandbox.home, ['list'])
      const stdout = stripAnsi(result.stdout)

      expect(result.status).toBe(0)
      expect(stdout).toContain('Last Sync')
      expect(stdout).toContain(new Date().toISOString().slice(0, 10))
      expect(stdout).toContain('never')
      expect(stdout).toContain(sandbox.webConsumer)
      expect(
        await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8'),
      ).toBe('web-rule-v1\n')
      expect(
        await readFile(join(sandbox.webConsumer, sharedFile), 'utf-8'),
      ).toBe('shared-agents-v1\n')
    })

    it('should show a dash for last sync when the registered project path is missing', async () => {
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)
      await rm(sandbox.web, { recursive: true, force: true })

      const result = runCli(sandbox.repo, sandbox.home, ['list'])
      const stdout = stripAnsi(result.stdout)

      expect(result.status).toBe(0)
      expect(stdout).toContain('missing path')
      expect(stdout).toMatch(
        new RegExp(
          `${sandbox.web.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s+-\\s+-\\s+missing path`,
        ),
      )
    })
  })

  describe('prune', () => {
    it('should preview stale project registrations without removing them', async () => {
      expect(runCli(sandbox.repo, sandbox.home, ['init']).status).toBe(0)
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)
      await rm(sandbox.web, { recursive: true, force: true })

      const result = runCli(sandbox.repo, sandbox.home, ['prune', '--dry-run'])
      const config = JSON.parse(
        await readFile(getGlobalConfigPath(sandbox.home), 'utf-8'),
      ) as {
        projects: string[]
      }

      expect(result.status).toBe(0)
      expect(stripAnsi(result.stdout)).toContain('Prune Plan')
      expect(stripAnsi(result.stdout)).toContain('Would remove 1 stale')
      expect(config.projects.map(normalizeMacPrivatePath)).toContain(
        normalizeMacPrivatePath(sandbox.web),
      )
    })

    it('should remove missing paths and missing configs from global projects', async () => {
      expect(runCli(sandbox.repo, sandbox.home, ['init']).status).toBe(0)
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/mobile',
          '--scope',
          'mobile',
        ]).status,
      ).toBe(0)
      await Promise.all([
        rm(sandbox.web, { recursive: true, force: true }),
        rm(getProjectMetadataPath(sandbox.mobile), { force: true }),
      ])

      const result = runCli(sandbox.repo, sandbox.home, ['prune', '--yes'])
      const config = JSON.parse(
        await readFile(getGlobalConfigPath(sandbox.home), 'utf-8'),
      ) as {
        projects: string[]
      }

      expect(result.status).toBe(0)
      expect(stripAnsi(result.stdout)).toContain(
        'Removed 2 stale project registration(s).',
      )
      expect(config.projects.map(normalizeMacPrivatePath)).toEqual([
        normalizeMacPrivatePath(sandbox.repo),
      ])
    })

    it('should require confirmation in non-interactive mode', async () => {
      expect(
        runCli(sandbox.repo, sandbox.home, [
          'init',
          '--root',
          'apps/web',
          '--scope',
          'web',
        ]).status,
      ).toBe(0)
      await rm(sandbox.web, { recursive: true, force: true })

      const result = runCli(sandbox.repo, sandbox.home, ['prune'])

      expectError(result, {
        problem: 'Confirmation requires interactive terminal',
        reason: 'Prune removes stale project registrations from global config',
        fix: 'Re-run with --yes to prune without prompt, or use --dry-run to preview',
      })
    })
  })

  describe('nested project ownership guard', () => {
    it('should block adding a nested project file from the parent project root', async () => {
      await initializeParentAndNestedProjects(sandbox)
      await writeFile(
        join(sandbox.web, '.cursorrules'),
        'nested-rule\n',
        'utf-8',
      )

      const result = runCli(sandbox.repo, sandbox.home, [
        'add',
        'apps/web/.cursorrules',
      ])

      expectError(result, {
        problem: 'Cannot add path from nested synapse project boundary',
        reason:
          'File "apps/web/.cursorrules" belongs to nested synapse project "apps/web"',
        fix: 'Run the command from the nested project root, or use --root <nested-project> instead',
      })
    })

    it('should block adding a nested project directory from the parent project root', async () => {
      await initializeParentAndNestedProjects(sandbox)
      await mkdir(join(sandbox.web, '.cursor', 'rules'), { recursive: true })
      await writeFile(
        join(sandbox.web, '.cursor', 'rules', 'frontend.md'),
        'nested-rule\n',
        'utf-8',
      )

      const result = runCli(sandbox.repo, sandbox.home, [
        'add',
        'apps/web/.cursor',
      ])

      expectError(result, {
        problem: 'Cannot add path from nested synapse project boundary',
        reason:
          'File "apps/web/.cursor/rules/frontend.md" belongs to nested synapse project "apps/web"',
        fix: 'Run the command from the nested project root, or use --root <nested-project> instead',
      })
    })

    it('should block removing a nested project directory from the parent project root', async () => {
      await initializeParentAndNestedProjects(sandbox)
      await mkdir(
        join(getSourceRoot(sandbox.home), 'scopes', 'web', '.cursor', 'rules'),
        {
          recursive: true,
        },
      )
      await writeFile(
        join(
          getSourceRoot(sandbox.home),
          'scopes',
          'web',
          '.cursor',
          'rules',
          'frontend.md',
        ),
        'nested-rule\n',
        'utf-8',
      )

      const result = runCli(sandbox.repo, sandbox.home, [
        'remove',
        'apps/web/.cursor',
        '--scope',
        'web',
      ])

      expectError(result, {
        problem: 'Cannot remove path from nested synapse project boundary',
        reason:
          'File "apps/web/.cursor" belongs to nested synapse project "apps/web"',
        fix: 'Run the command from the nested project root, or use --root <nested-project> instead',
      })
    })

    it('should block a targeted sync into a nested project from the parent project root', async () => {
      await initializeParentAndNestedProjects(sandbox)
      await writeSourceFile(
        sandbox.home,
        'apps/web/.cursorrules',
        'nested-rule\n',
      )

      const result = runCli(sandbox.repo, sandbox.home, [
        'sync',
        'apps/web/.cursorrules',
        '--yes',
      ])

      expectError(result, {
        problem: 'Cannot sync across nested synapse project boundary',
        reason:
          'File "apps/web/.cursorrules" belongs to nested synapse project "apps/web"',
        fix: 'Run the command from the nested project root, or use --root <nested-project> instead',
      })
    })

    it('should fail closed on full sync when the parent source contains nested project files', async () => {
      await initializeParentAndNestedProjects(sandbox)
      await writeSourceFile(sandbox.home, 'AGENTS.md', 'shared-root\n')
      await writeSourceFile(
        sandbox.home,
        'apps/web/.cursorrules',
        'nested-rule\n',
      )

      const result = runCli(sandbox.repo, sandbox.home, ['sync', '--yes'])

      expectError(result, {
        problem: 'Cannot sync across nested synapse project boundary',
        reason:
          'File "apps/web/.cursorrules" belongs to nested synapse project "apps/web"',
        fix: 'Run the command from the nested project root, or use --root <nested-project> instead',
      })
      await expect(
        readFile(join(sandbox.repo, 'AGENTS.md'), 'utf-8'),
      ).rejects.toThrow()
    })
  })

  describe('link', () => {
    it('should return a structured error when the path is not a directory', async () => {
      const invalidPath = join(sandbox.repo, 'not-a-directory.txt')
      await writeFile(invalidPath, 'x', 'utf-8')

      const result = runCli(sandbox.repo, sandbox.home, ['link', invalidPath])

      expectError(result, {
        problem: `Cannot link path: ${invalidPath}`,
        reason: 'The specified path is not a directory',
        fix: 'Pass a project directory path to link',
      })
    })
  })

  describe('cli surface', () => {
    it('should print help and exit successfully', async () => {
      const result = runCli(sandbox.repo, sandbox.home, ['--help'])

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('Usage')
      expect(result.stdout).toContain('--root, -r <path>')
      expect(result.stdout).toContain('--shared')
      expect(result.stdout).toContain('add <path>')
      expect(result.stdout).toContain('doctor')
      expect(result.stdout).toContain('prune')
      expect(result.stdout).toContain('remove <path>')
    })

    it('should print the version and exit successfully', async () => {
      const packageJson = JSON.parse(
        await readFile(join(process.cwd(), 'package.json'), 'utf-8'),
      ) as { version: string }
      const result = runCli(sandbox.repo, sandbox.home, ['--version'])

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout.trim()).toBe(packageJson.version)
    })

    it('should return a structured error for unknown commands', async () => {
      const result = runCli(sandbox.repo, sandbox.home, ['does-not-exist'])

      expectError(result, {
        problem: 'Unknown command: does-not-exist',
        reason: 'The command is not recognized by synapse',
        fix: 'Run "synapse --help" to see available commands',
      })
    })
  })
})
