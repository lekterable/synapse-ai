import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

// A block is a marked region inside a file that otherwise belongs to the repo, like the
// shared "Code conventions" section of every CLAUDE.md:
//
//   <!-- synapse:code-conventions -->
//   ...
//   <!-- /synapse:code-conventions -->
//
// Its canonical text lives in <sourcePath>/blocks/<name>.md. Only files that carry the
// markers are touched, so a repo opts in by adding them.

export const BLOCK_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  'GEMINI.md',
]

const BLOCK =
  /<!-- synapse:([a-z0-9-]+) -->\n([\s\S]*?)\n?<!-- \/synapse:\1 -->/g

export type Block = { name: string; content: string }

export const findBlocks = (text: string): Block[] =>
  [...text.matchAll(BLOCK)].map(([, name = '', content = '']) => ({
    name,
    content: content.trim(),
  }))

// Replaces the content of every block that has a source; other blocks stay as they are.
export const replaceBlocks = (
  text: string,
  sources: Record<string, string>,
): string =>
  text.replace(BLOCK, (match, name: string) => {
    const source = sources[name]
    return source === undefined
      ? match
      : `<!-- synapse:${name} -->\n${source.trim()}\n<!-- /synapse:${name} -->`
  })

export const blocksDir = (sourcePath: string): string =>
  join(sourcePath, 'blocks')

const expandHome = (path: string): string =>
  path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path

// Repo folders from a YAML list in the shape of .dotfiles' projects.yaml:
// `root` plus `repos` keyed by folder name relative to it.
export const readReposFile = (file: string): string[] => {
  const list = (parse(readFileSync(expandHome(file), 'utf8')) ?? {}) as {
    root?: string
    repos?: Record<string, unknown>
  }
  const root = expandHome(list.root ?? '.')
  return Object.keys(list.repos ?? {}).map((name) => join(root, name))
}

export type BlockState = {
  repo: string
  file: string
  name: string
  state: 'in-sync' | 'drifted' | 'no-source'
}

// Every marked block in the instruction files of these repos, compared with its source.
export const blockStates = (
  repos: string[],
  sources: Record<string, string>,
): BlockState[] =>
  repos.flatMap((repo) =>
    BLOCK_FILES.map((file) => join(repo, file))
      .filter((path) => existsSync(path))
      .flatMap((path) =>
        findBlocks(readFileSync(path, 'utf8')).map(({ name, content }) => {
          const source = sources[name]
          return {
            repo,
            file: path,
            name,
            state:
              source === undefined
                ? ('no-source' as const)
                : content === source.trim()
                  ? ('in-sync' as const)
                  : ('drifted' as const),
          }
        }),
      ),
  )
