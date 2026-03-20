import { spawnSync } from 'child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'

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

const stripAnsi = (value: string): string =>
  value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')

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

describe('synapse init', () => {
  it('should initialize a scoped project at an explicit root', async () => {
    const sandbox = await createSandbox()

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
    }
    expect(metadata.version).toBe(2)
    expect(metadata.scope).toBe('web')
  })

  it('should return a structured error for invalid scope names', async () => {
    const sandbox = await createSandbox()
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

describe('synapse add', () => {
  it('should store scoped files under source/scopes and shared files at the source root', async () => {
    const sandbox = await createSandbox()
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
    const sandbox = await createSandbox()
    await writeFile(join(sandbox.web, '.cursorrules'), 'web-rule-v1\n', 'utf-8')
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
    const sandbox = await createSandbox()
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
    const sandbox = await createSandbox()
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
    const sandbox = await createSandbox()
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
    const sandbox = await createSandbox()
    const result = runCli(sandbox.web, sandbox.home, ['add'])

    expectError(result, {
      problem: 'No path specified for add command',
      reason: 'The add command requires a file or directory path argument',
      fix: 'Usage: synapse add <path>',
    })
  })
})

describe('synapse sync', () => {
  it('should sync scoped files plus the shared fallback for matching scopes', async () => {
    const sandbox = await createSandbox()
    const { scopedFile, sharedFile } = await initializeScopedProjects(sandbox)

    const result = runCli(sandbox.repo, sandbox.home, [
      'sync',
      '--root',
      'apps/web-consumer',
      '--yes',
    ])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Synced 2 file(s).')
    expect(await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8')).toBe(
      'web-rule-v1\n',
    )
    expect(await readFile(join(sandbox.webConsumer, sharedFile), 'utf-8')).toBe(
      'shared-agents-v1\n',
    )
  })

  it('should not sync files from other scopes', async () => {
    const sandbox = await createSandbox()
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
    const sandbox = await createSandbox()
    const { scopedFile, sharedFile } = await initializeScopedProjects(sandbox)

    const result = runCli(sandbox.webConsumerSrc, sandbox.home, [
      'sync',
      '--yes',
    ])

    expect(result.status).toBe(0)
    expect(await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8')).toBe(
      'web-rule-v1\n',
    )
    expect(await readFile(join(sandbox.webConsumer, sharedFile), 'utf-8')).toBe(
      'shared-agents-v1\n',
    )
  })

  it('should require --yes in non-interactive mode when changes are pending', async () => {
    const sandbox = await createSandbox()
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
    const sandbox = await createSandbox()
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
    const sandbox = await createSandbox()
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
    expect(await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8')).toBe(
      'local-change\n',
    )
  })

  it('should overwrite local changes with --strategy theirs and create a backup', async () => {
    const sandbox = await createSandbox()
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
    expect(await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8')).toBe(
      'web-rule-v2\n',
    )

    const backups = await readdir(join(sandbox.home, '.synapse', 'backups'))
    expect(backups.length).toBeGreaterThan(0)
  })

  it('should treat --strategy ask with --yes as source-wins', async () => {
    const sandbox = await createSandbox()
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
    expect(await readFile(join(sandbox.webConsumer, scopedFile), 'utf-8')).toBe(
      'web-rule-v2\n',
    )
  })

  it('should return a structured error when no synapse project can be found', async () => {
    const sandbox = await createSandbox()
    const result = runCli(sandbox.scratch, sandbox.home, ['sync', '--yes'])

    expectError(result, {
      problem: 'No synapse project found',
      reason:
        'Synapse could not find a .synapse.json in this directory or any parent directory',
      fix: 'Run "synapse init" here, or pass --root <path> to target another project',
    })
  })

  it('should return a structured error for an invalid conflict strategy', async () => {
    const sandbox = await createSandbox()
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

describe('nested project ownership guard', () => {
  it('should block adding a nested project file from the parent project root', async () => {
    const sandbox = await createSandbox()
    await initializeParentAndNestedProjects(sandbox)
    await writeFile(join(sandbox.web, '.cursorrules'), 'nested-rule\n', 'utf-8')

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
    const sandbox = await createSandbox()
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

  it('should block a targeted sync into a nested project from the parent project root', async () => {
    const sandbox = await createSandbox()
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
    const sandbox = await createSandbox()
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

describe('synapse link', () => {
  it('should return a structured error when the path is not a directory', async () => {
    const sandbox = await createSandbox()
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

describe('synapse cli surface', () => {
  it('should print help and exit successfully', async () => {
    const sandbox = await createSandbox()
    const result = runCli(sandbox.repo, sandbox.home, ['--help'])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Usage')
    expect(result.stdout).toContain('--root, -r <path>')
    expect(result.stdout).toContain('--shared')
    expect(result.stdout).toContain('add <path>')
  })

  it('should print the version and exit successfully', async () => {
    const sandbox = await createSandbox()
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf-8'),
    ) as { version: string }
    const result = runCli(sandbox.repo, sandbox.home, ['--version'])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe(packageJson.version)
  })

  it('should return a structured error for unknown commands', async () => {
    const sandbox = await createSandbox()
    const result = runCli(sandbox.repo, sandbox.home, ['does-not-exist'])

    expectError(result, {
      problem: 'Unknown command: does-not-exist',
      reason: 'The command is not recognized by synapse',
      fix: 'Run "synapse --help" to see available commands',
    })
  })
})
