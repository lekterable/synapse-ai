import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import chalk from 'chalk'
import {
  blockSources,
  blockStates,
  blocksDir,
  findBlocks,
  readReposFile,
  replaceBlocks,
  repoScope,
  scopedBlockNames,
} from '../blocks'
import { createConfigManager } from '../config'
import { print } from '../utils/output'
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

// Makes a file's blocks the new source, e.g. after editing them in one repo.
const pull = (file: string | undefined, flags: CliFlags): void => {
  if (!file) throw new Error('Usage: synapse blocks pull <file>')
  const blocks = findBlocks(readFileSync(resolve(file), 'utf8'))
  if (blocks.length === 0) throw new Error(`${file} has no synapse blocks`)
  const sourcePath = createConfigManager().getSourcePath()
  const scoped = scopedBlockNames(sourcePath)
  const stacked = blocks.filter(({ name }) => scoped.includes(name))
  if (stacked.length > 0)
    throw new Error(
      `${stacked.map(({ name }) => name).join(', ')} ${stacked.length === 1 ? 'has' : 'have'} scoped parts, so edit ${stacked.length === 1 ? 'it' : 'them'} in ${sourcePath} instead`,
    )
  const dir = blocksDir(sourcePath)
  if (!flags.dryRun) mkdirSync(dir, { recursive: true })
  blocks.forEach(({ name, content }) => {
    if (!flags.dryRun) writeFileSync(join(dir, `${name}.md`), `${content}\n`)
    print(
      `${flags.dryRun ? 'would save' : 'saved'}  ${name} → ${join(dir, `${name}.md`)}`,
    )
  })
}

const blocks: CommandHandler = (input, flags) => {
  const [action = 'check', file] = input
  if (action === 'check') return check(flags)
  if (action === 'sync') return sync(flags)
  if (action === 'pull') return pull(file, flags)
  throw new Error(`Unknown blocks action "${action}" (check, sync or pull)`)
}

export const registerBlocksCommands = (
  register: (name: string, handler: CommandHandler) => void,
): void => {
  register('blocks', blocks)
}
