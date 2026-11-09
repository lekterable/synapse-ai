import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
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
  webConsumer: string
}

const cliPath = join(process.cwd(), 'dist', 'cli.js')
let sandboxes: string[] = []
let sandbox: Sandbox

const createSandbox = async (): Promise<Sandbox> => {
  const root = await mkdtemp(join(tmpdir(), 'synapse-sync-source-'))
  const home = join(root, 'home')
  const repo = join(root, 'repo')
  const webConsumer = join(repo, 'apps', 'web-consumer')

  await Promise.all(
    [home, repo, webConsumer].map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
  )

  sandboxes = [...sandboxes, root]
  return { root, home, repo, webConsumer }
}

const runCli = (cwd: string, home: string, args: string[]): CliResult => {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd,
    encoding: 'utf-8',
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

const readProjectMetadata = async (
  projectRoot: string,
): Promise<{
  syncedFiles: Record<string, string>
  fileHashes: Record<string, string>
}> =>
  JSON.parse(await readFile(getProjectMetadataPath(projectRoot), 'utf-8')) as {
    syncedFiles: Record<string, string>
    fileHashes: Record<string, string>
  }

afterEach(async () => {
  await Promise.all(
    sandboxes.map((root) => rm(root, { recursive: true, force: true })),
  )
  sandboxes = []
})

describe('synapse sync source contract', () => {
  beforeEach(async () => {
    sandbox = await createSandbox()
  })

  it('should not copy the internal blocks store into a project', async () => {
    await writeSourceFile(sandbox.home, 'AGENTS.md', 'shared-agents\n')
    await writeSourceFile(
      sandbox.home,
      'blocks/code-conventions.md',
      'canonical-conventions\n',
    )
    expect(runCli(sandbox.repo, sandbox.home, ['init']).status).toBe(0)

    const result = runCli(sandbox.repo, sandbox.home, ['sync', '--yes'])
    const metadata = await readProjectMetadata(sandbox.repo)

    expect(result.status).toBe(0)
    expect(await readFile(join(sandbox.repo, 'AGENTS.md'), 'utf-8')).toBe(
      'shared-agents\n',
    )
    await expect(
      readFile(join(sandbox.repo, 'blocks', 'code-conventions.md'), 'utf-8'),
    ).rejects.toThrow()
    expect(metadata.syncedFiles).not.toHaveProperty(
      'blocks/code-conventions.md',
    )
    expect(metadata.fileHashes).not.toHaveProperty('blocks/code-conventions.md')
  })

  it('should record a byte-identical existing file as tracked after sync', async () => {
    const template = '## Summary\n\nidentical-template\n'
    await writeSourceFile(
      sandbox.home,
      '.github/pull_request_template.md',
      template,
    )
    await mkdir(join(sandbox.repo, '.github'), { recursive: true })
    await writeFile(
      join(sandbox.repo, '.github', 'pull_request_template.md'),
      template,
      'utf-8',
    )
    expect(runCli(sandbox.repo, sandbox.home, ['init']).status).toBe(0)

    const first = runCli(sandbox.repo, sandbox.home, ['sync'])
    const firstMetadata = await readProjectMetadata(sandbox.repo)
    const second = runCli(sandbox.repo, sandbox.home, ['sync', '--yes'])
    const secondMetadata = await readProjectMetadata(sandbox.repo)
    const status = runCli(sandbox.repo, sandbox.home, ['status'])

    expect(first.status).toBe(0)
    expect(stripVTControlCharacters(first.stdout)).toContain(
      'Tracked 1 identical file(s).',
    )
    expect(stripVTControlCharacters(first.stdout)).not.toContain(
      'All tracked files are already in sync.',
    )
    expect(firstMetadata.syncedFiles).toHaveProperty(
      '.github/pull_request_template.md',
    )
    expect(firstMetadata.fileHashes).toHaveProperty(
      '.github/pull_request_template.md',
    )
    expect(second.status).toBe(0)
    expect(stripVTControlCharacters(second.stdout)).toContain(
      'All tracked files are already in sync.',
    )
    expect(secondMetadata).toEqual(firstMetadata)
    expect(status.status).toBe(0)
    expect(stripVTControlCharacters(status.stdout)).not.toContain('➕')
  })

  it('should sync a scoped project whose scope has a blocks folder', async () => {
    await writeSourceFile(sandbox.home, 'AGENTS.md', 'shared-agents\n')
    await writeSourceFile(sandbox.home, 'scopes/react/blocks/notes.md', 'x\n')
    expect(
      runCli(sandbox.repo, sandbox.home, ['init', '--scope', 'react']).status,
    ).toBe(0)

    const result = runCli(sandbox.repo, sandbox.home, ['sync', '--yes'])

    expect(result.status).toBe(0)
    expect(await readFile(join(sandbox.repo, 'AGENTS.md'), 'utf-8')).toBe(
      'shared-agents\n',
    )
    await expect(
      readFile(join(sandbox.repo, 'blocks', 'notes.md'), 'utf-8'),
    ).rejects.toThrow()
  })
})
