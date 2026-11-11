import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { blockSources, findBlocks, replaceBlocks } from '../src/blocks'

const cliPath = join(process.cwd(), 'dist', 'cli.js')

const doc = (body: string): string =>
  `# Agent guide\n\nRepo notes.\n\n<!-- synapse:conventions -->\n${body}\n<!-- /synapse:conventions -->\n\n## Repo only\n`

describe('blocks', () => {
  it('should replace only blocks that have a source and keep the rest of the file', () => {
    const text = `${doc('old rules')}<!-- synapse:other -->\nmine\n<!-- /synapse:other -->\n`
    const next = replaceBlocks(text, { conventions: 'new rules\n' })
    expect(findBlocks(next)).toEqual([
      { name: 'conventions', content: 'new rules' },
      { name: 'other', content: 'mine' },
    ])
    expect(next.startsWith('# Agent guide\n\nRepo notes.\n\n')).toBe(true)
    expect(next).toContain('\n\n## Repo only\n')
  })

  it('should report drift from a projects.yaml list, sync it, and exit 0 once in sync', async () => {
    const root = await mkdtemp(join(tmpdir(), 'synapse-blocks-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const home = join(root, 'home')
    await mkdir(join(home, '.synapse', 'source', 'blocks'), { recursive: true })
    await writeFile(
      join(home, '.synapse', 'source', 'blocks', 'conventions.md'),
      'new rules\n',
    )
    await mkdir(join(root, 'projects', 'me', 'app'), { recursive: true })
    await mkdir(join(root, 'projects', 'me', 'lib'), { recursive: true })
    await writeFile(
      join(root, 'projects', 'me', 'app', 'CLAUDE.md'),
      doc('old rules'),
    )
    await writeFile(
      join(root, 'projects', 'me', 'lib', 'AGENTS.md'),
      doc('new rules'),
    )
    const repos = join(root, 'projects.yaml')
    await writeFile(
      repos,
      `root: ${join(root, 'projects')}\nrepos:\n  me/app: null\n  me/lib: null\n  me/missing: null\n`,
    )
    const run = (...args: string[]) =>
      spawnSync('node', [cliPath, 'blocks', ...args, '--repos', repos], {
        cwd: root,
        encoding: 'utf-8',
        env: { ...process.env, HOME: home, NO_COLOR: '1' },
      })

    const before = run('check')
    expect(before.status).toBe(1)
    expect(before.stdout).toContain('1 in sync, 1 drifted, 0 without a source')

    expect(run('sync').status).toBe(0)
    expect(
      await readFile(join(root, 'projects', 'me', 'app', 'CLAUDE.md'), 'utf8'),
    ).toBe(doc('new rules'))
    expect(run('check').status).toBe(0)
  })
  it('should stack shared and matching scoped parts, broadest scope first', async () => {
    const source = await mkdtemp(join(tmpdir(), 'synapse-block-source-'))
    onTestFinished(() => rm(source, { recursive: true, force: true }))
    const part = async (path: string, text: string) => {
      await mkdir(join(source, path, '..'), { recursive: true })
      await writeFile(join(source, path), text)
    }
    await part('blocks/guides.md', 'shared\n')
    await part('scopes/web+react/blocks/guides.md', 'react web\n')
    await part('scopes/react/blocks/guides.md', 'react\n')
    await part('scopes/mobile/blocks/guides.md', 'mobile\n')
    await part('scopes/react/blocks/only-react.md', 'only react\n')

    expect(blockSources(source, 'web,react')).toEqual({
      guides: 'shared\n\nreact\n\nreact web',
      'only-react': 'only react',
    })
    expect(blockSources(source, undefined)).toEqual({ guides: 'shared' })
  })

  it('should sync each repo with its own scope, treat an unreadable scope as none, and refuse to pull a stacked block', async () => {
    const root = await mkdtemp(join(tmpdir(), 'synapse-blocks-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const home = join(root, 'home')
    const source = join(home, '.synapse', 'source')
    await mkdir(join(source, 'blocks'), { recursive: true })
    await mkdir(join(source, 'scopes', 'react', 'blocks'), { recursive: true })
    await writeFile(join(source, 'blocks', 'conventions.md'), 'shared\n')
    await writeFile(
      join(source, 'scopes', 'react', 'blocks', 'conventions.md'),
      'react rules\n',
    )
    const app = join(root, 'projects', 'app')
    const lib = join(root, 'projects', 'lib')
    await mkdir(app, { recursive: true })
    await mkdir(lib, { recursive: true })
    await writeFile(join(app, 'AGENTS.md'), doc('old'))
    await writeFile(
      join(app, '.synapse.json'),
      JSON.stringify({
        version: 1,
        scope: 'react',
        syncedFiles: {},
        fileHashes: {},
      }),
    )
    await writeFile(join(lib, 'AGENTS.md'), doc('old'))
    const broken = join(root, 'projects', 'broken')
    await mkdir(broken, { recursive: true })
    await writeFile(join(broken, 'AGENTS.md'), doc('old'))
    await writeFile(
      join(broken, '.synapse.json'),
      JSON.stringify({
        version: 1,
        scope: 'bad scope!',
        syncedFiles: {},
        fileHashes: {},
      }),
    )
    const repos = join(root, 'projects.yaml')
    await writeFile(
      repos,
      `root: ${join(root, 'projects')}\nrepos:\n  app: null\n  lib: null\n  broken: null\n`,
    )
    const run = (...args: string[]) =>
      spawnSync('node', [cliPath, 'blocks', ...args], {
        cwd: root,
        encoding: 'utf-8',
        env: { ...process.env, HOME: home, NO_COLOR: '1' },
      })

    expect(run('sync', '--repos', repos).status).toBe(0)
    expect(await readFile(join(app, 'AGENTS.md'), 'utf8')).toBe(
      doc('shared\n\nreact rules'),
    )
    expect(await readFile(join(lib, 'AGENTS.md'), 'utf8')).toBe(doc('shared'))
    expect(await readFile(join(broken, 'AGENTS.md'), 'utf8')).toBe(
      doc('shared'),
    )
    expect(run('check', '--repos', repos).status).toBe(0)

    const pull = run('pull', join(app, 'AGENTS.md'))
    expect(pull.status).toBe(1)
    expect(pull.stderr).toContain('conventions has scoped parts')
    expect(
      await readFile(join(source, 'blocks', 'conventions.md'), 'utf8'),
    ).toBe('shared\n')
  })
})
