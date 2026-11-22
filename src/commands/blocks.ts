import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import chalk from 'chalk'
import {
  type BlockState,
  blockNames,
  blockSources,
  blockStates,
  blocksDir,
  findBlocks,
  readReposFile,
  replaceBlocks,
  repoScope,
  scopedBlockSources,
  sharedPart,
} from '../blocks'
import { createConfigManager } from '../config'
import { print } from '../utils/output'
import { findNearestProjectRoot } from '../utils/project-root'
import type { CliFlags, CommandHandler } from './types'

// --repos <projects.yaml> lists the repos; otherwise the registered synapse projects.
const reposFor = (flags: CliFlags): string[] =>
  flags.repos
    ? readReposFile(flags.repos)
    : createConfigManager().getGlobalConfig().projects

const display = (file: string): string => relative(process.cwd(), file) || file

// Each repo's block sources, from its own scope.
const sourcesByRepo = (
  repos: string[],
): ((repo: string) => Record<string, string>) => {
  const sourcePath = createConfigManager().getSourcePath()
  const sources = new Map(
    repos.map((repo) => [repo, blockSources(sourcePath, repoScope(repo))]),
  )
  return (repo) => sources.get(repo) ?? {}
}

const check = (flags: CliFlags): void => {
  const repos = reposFor(flags)
  const states = blockStates(repos, sourcesByRepo(repos))
  const drifted = states.filter((state) => state.state === 'drifted')
  const unknown = states.filter((state) => state.state === 'no-source')
  drifted.forEach((state) =>
    print(`${chalk.yellow('drifted')}  ${state.name}  ${display(state.file)}`),
  )
  unknown.forEach((state) =>
    print(`${chalk.dim('no source')}  ${state.name}  ${display(state.file)}`),
  )
  print(
    `${states.length - drifted.length - unknown.length} in sync, ${drifted.length} drifted, ${unknown.length} without a source`,
  )
  // A non-zero exit lets a scheduled job report drift.
  if (drifted.length > 0) process.exitCode = 1
}

const sync = (flags: CliFlags): void => {
  const repos = reposFor(flags)
  const sourcesFor = sourcesByRepo(repos)
  const files = [
    ...new Map(
      blockStates(repos, sourcesFor)
        .filter((state) => state.state === 'drifted')
        .map((state) => [state.file, state.repo] as const),
    ),
  ]
  files.forEach(([file, repo]) => {
    if (!flags.dryRun)
      writeFileSync(
        file,
        replaceBlocks(readFileSync(file, 'utf8'), sourcesFor(repo)),
      )
    print(`${flags.dryRun ? 'would update' : 'updated'}  ${display(file)}`)
  })
  if (files.length === 0) print('Every block is in sync')
}

// Makes a file's blocks the new source, e.g. after editing them in one repo. A block with
// scoped parts saves only its shared part, which is the block minus the scoped parts the
// file's repo adds; it is refused only when those scoped parts were edited too.
const pull = (file: string | undefined, flags: CliFlags): void => {
  if (!file) throw new Error('Usage: synapse blocks pull <file>')
  const path = resolve(file)
  const blocks = findBlocks(readFileSync(path, 'utf8'))
  if (blocks.length === 0) throw new Error(`${file} has no synapse blocks`)
  const sourcePath = createConfigManager().getSourcePath()
  const repo = findNearestProjectRoot(dirname(path)) ?? dirname(path)
  const scoped = scopedBlockSources(sourcePath, repoScope(repo))
  const parts = blocks.map(({ name, content }) => ({
    name,
    shared: sharedPart(content, scoped[name]),
  }))
  const edited = parts.filter(({ shared }) => shared === undefined)
  if (edited.length > 0)
    throw new Error(
      `${edited.map(({ name }) => name).join(', ')} ${edited.length === 1 ? 'does' : 'do'} not end with the scoped parts in ${sourcePath}: edit scoped parts there, or run "synapse blocks sync" first if the source changed`,
    )
  const dir = blocksDir(sourcePath)
  // A block that is only its scoped parts has no shared part to save; writing an empty one
  // would give every other repo an empty source for it.
  const saved = parts.filter(
    ({ name, shared }) => shared !== '' || existsSync(join(dir, `${name}.md`)),
  )
  if (!flags.dryRun) mkdirSync(dir, { recursive: true })
  saved.forEach(({ name, shared }) => {
    if (!flags.dryRun) writeFileSync(join(dir, `${name}.md`), `${shared}\n`)
    print(
      `${flags.dryRun ? 'would save' : 'saved'}  ${name} → ${join(dir, `${name}.md`)}`,
    )
  })
  parts
    .filter((part) => !saved.includes(part))
    .forEach(({ name }) =>
      print(`kept  ${name}: it has only scoped parts, nothing shared to save`),
    )
}

type Carried = 'yes' | 'no' | 'drifted' | 'no-source'

// One repo's blocks: drifted when any file has it drifted, yes when every copy is in sync.
const carried = (states: BlockState[]): Carried =>
  states.length === 0
    ? 'no'
    : states.some((state) => state.state === 'drifted')
      ? 'drifted'
      : states.some((state) => state.state === 'no-source')
        ? 'no-source'
        : 'yes'

const paint: Record<Carried, (text: string) => string> = {
  yes: chalk.green,
  no: chalk.dim,
  drifted: chalk.yellow,
  'no-source': chalk.dim,
}

// Which repo carries which block, read only: a table, or with --json the same data.
const report = (flags: CliFlags): void => {
  const repos = reposFor(flags)
  const names = blockNames(createConfigManager().getSourcePath())
  const states = blockStates(repos, sourcesByRepo(repos))
  // A repo whose folder is gone gets no states, so its blocks never read as "no".
  const rows = repos.map((repo) => {
    const missing = !existsSync(repo)
    return {
      repo,
      missing,
      blocks: missing
        ? {}
        : Object.fromEntries(
            names.map((name) => [
              name,
              carried(
                states.filter(
                  (state) => state.repo === repo && state.name === name,
                ),
              ),
            ]),
          ),
    }
  })
  if (flags.json) {
    print(JSON.stringify({ blocks: names, repos: rows }, undefined, 2))
    return
  }
  if (rows.length === 0 || names.length === 0) {
    print(
      rows.length === 0 ? 'No repos to report on' : 'The source has no blocks',
    )
    return
  }
  const labels = rows.map(
    ({ repo, missing }) => `${display(repo)}${missing ? ' (missing)' : ''}`,
  )
  const width = Math.max(4, ...labels.map((label) => label.length)) + 2
  const widths = names.map((name) => Math.max(name.length, 9) + 2)
  print(
    chalk.bold(
      [
        'Repo'.padEnd(width),
        ...names.map((name, index) => name.padEnd(widths[index] ?? 0)),
      ]
        .join('')
        .trimEnd(),
    ),
  )
  rows.forEach(({ blocks }, row) =>
    print(
      [
        (labels[row] ?? '').padEnd(width),
        ...names.map((name, index) => {
          const state: Carried | undefined = blocks[name]
          return state === undefined
            ? '-'.padEnd(widths[index] ?? 0)
            : paint[state](state.padEnd(widths[index] ?? 0))
        }),
      ]
        .join('')
        .trimEnd(),
    ),
  )
}

const blocks: CommandHandler = (input, flags) => {
  const [action = 'check', file] = input
  if (action === 'check') return check(flags)
  if (action === 'sync') return sync(flags)
  if (action === 'pull') return pull(file, flags)
  if (action === 'report') return report(flags)
  throw new Error(
    `Unknown blocks action "${action}" (check, sync, pull or report)`,
  )
}

export const registerBlocksCommands = (
  register: (name: string, handler: CommandHandler) => void,
): void => {
  register('blocks', blocks)
}
