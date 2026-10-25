import { spawnSync } from 'child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { findBlocks, replaceBlocks } from '../src/blocks'

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
})
