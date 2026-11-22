import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { createConfigManager } from './config'
import {
  BLOCKS_DIRECTORY,
  matchingScopeKeys,
  SCOPES_DIRECTORY,
  validateScopeName,
} from './source'

// A block is a marked region inside a file that otherwise belongs to the repo, like the
// shared "Code conventions" section of every CLAUDE.md:
//
//   <!-- synapse:code-conventions -->
//   ...
//   <!-- /synapse:code-conventions -->
//
// Its canonical text lives in <sourcePath>/blocks/<name>.md, plus
// <sourcePath>/scopes/<scope>/blocks/<name>.md for repos whose .synapse.json scope contains
// that scope. The parts stack, shared first and broadest scope next, so one block can list
// what each scope adds. Only files that carry the markers are touched, so a repo opts in by
// adding them.

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
  join(sourcePath, BLOCKS_DIRECTORY)

const readBlockFiles = (dir: string): [string, string][] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith('.md'))
        .map((file) => [
          file.slice(0, -3),
          readFileSync(join(dir, file), 'utf8').trim(),
        ])
    : []

const joinParts = (dirs: string[]): Record<string, string> =>
  dirs.flatMap(readBlockFiles).reduce<Record<string, string>>(
    (sources, [name, text]) => ({
      ...sources,
      [name]: [sources[name], text]
        .filter((part) => part !== undefined && part !== '')
        .join('\n\n'),
    }),
    {},
  )

const scopedDirs = (sourcePath: string, scope: string | undefined): string[] =>
  matchingScopeKeys(sourcePath, scope).map((key) =>
    join(sourcePath, SCOPES_DIRECTORY, key, BLOCKS_DIRECTORY),
  )

// The block sources a repo with this scope gets: each name's shared and scoped parts, joined.
export const blockSources = (
  sourcePath: string,
  scope: string | undefined,
): Record<string, string> =>
  joinParts([blocksDir(sourcePath), ...scopedDirs(sourcePath, scope)])

// Only the scoped parts a repo with this scope adds, joined the same way. A name whose parts
// are all empty adds nothing, so it is left out.
export const scopedBlockSources = (
  sourcePath: string,
  scope: string | undefined,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(joinParts(scopedDirs(sourcePath, scope))).filter(
      ([, text]) => text !== '',
    ),
  )

// Every block name the source has, shared or added by any scope.
export const blockNames = (sourcePath: string): string[] => {
  const scopesRoot = join(sourcePath, SCOPES_DIRECTORY)
  const scopes = existsSync(scopesRoot) ? readdirSync(scopesRoot) : []
  return [
    ...new Set(
      [
        blocksDir(sourcePath),
        ...scopes.map((scope) => join(scopesRoot, scope, BLOCKS_DIRECTORY)),
      ]
        .flatMap(readBlockFiles)
        .map(([name]) => name),
    ),
  ].sort((left, right) => left.localeCompare(right))
}

// The shared part a pulled block stands for: the block minus the scoped parts this repo adds.
// Undefined when the block no longer ends with them, so an edit to a scoped part is never
// written into the shared one.
export const sharedPart = (
  content: string,
  scoped: string | undefined,
): string | undefined => {
  if (scoped === undefined) return content
  if (content === scoped) return ''
  const suffix = `\n\n${scoped}`
  return content.endsWith(suffix)
    ? content.slice(0, -suffix.length).trim()
    : undefined
}

// The scope in a repo's .synapse.json; undefined when it has none, no .synapse.json, or a
// scope Synapse can't read, so one broken repo doesn't stop blocks for the others.
export const repoScope = (repo: string): string | undefined => {
  const scope = createConfigManager(repo).getProjectMetadata().scope
  try {
    return scope === undefined ? undefined : validateScopeName(scope)
  } catch {
    return undefined
  }
}

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

// Every marked block in the instruction files of these repos, compared with that repo's source.
export const blockStates = (
  repos: string[],
  sourcesFor: (repo: string) => Record<string, string>,
): BlockState[] =>
  repos.flatMap((repo) => {
    const sources = sourcesFor(repo)
    return BLOCK_FILES.map((file) => join(repo, file))
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
      )
  })
