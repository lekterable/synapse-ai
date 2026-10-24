import chalk from 'chalk'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs'
import { join, relative, resolve } from 'path'
import {
  blockStates,
  blocksDir,
  findBlocks,
  readReposFile,
  replaceBlocks,
} from '../blocks'
import { createConfigManager } from '../config'
import type { CliFlags, CommandHandler } from './types'

const readSources = (dir: string): Record<string, string> =>
  existsSync(dir)
    ? Object.fromEntries(
        readdirSync(dir)
          .filter((file) => file.endsWith('.md'))
          .map((file) => [
            file.slice(0, -3),
            readFileSync(join(dir, file), 'utf8'),
          ]),
      )
    : {}

// --repos <projects.yaml> lists the repos; otherwise the registered synapse projects.
const reposFor = (flags: CliFlags): string[] =>
  flags.repos
    ? readReposFile(flags.repos)
    : createConfigManager().getGlobalConfig().projects

const display = (file: string): string => relative(process.cwd(), file) || file

const check = (flags: CliFlags): void => {
  const sources = readSources(blocksDir(createConfigManager().getSourcePath()))
  const states = blockStates(reposFor(flags), sources)
  const drifted = states.filter((state) => state.state === 'drifted')
  const unknown = states.filter((state) => state.state === 'no-source')
  drifted.forEach((state) =>
    console.log(
      `${chalk.yellow('drifted')}  ${state.name}  ${display(state.file)}`,
    ),
  )
  unknown.forEach((state) =>
    console.log(
      `${chalk.dim('no source')}  ${state.name}  ${display(state.file)}`,
    ),
  )
  console.log(
    `${states.length - drifted.length - unknown.length} in sync, ${drifted.length} drifted, ${unknown.length} without a source`,
  )
  // A non-zero exit lets a scheduled job report drift.
  if (drifted.length > 0) process.exitCode = 1
}

const sync = (flags: CliFlags): void => {
  const sources = readSources(blocksDir(createConfigManager().getSourcePath()))
  const files = [
    ...new Set(
      blockStates(reposFor(flags), sources)
        .filter((state) => state.state === 'drifted')
        .map((state) => state.file),
    ),
  ]
  files.forEach((file) => {
    if (!flags.dryRun)
      writeFileSync(file, replaceBlocks(readFileSync(file, 'utf8'), sources))
    console.log(
      `${flags.dryRun ? 'would update' : 'updated'}  ${display(file)}`,
    )
  })
  if (files.length === 0) console.log('Every block is in sync')
}

// Makes a file's blocks the new source, e.g. after editing them in one repo.
const pull = (file: string | undefined, flags: CliFlags): void => {
  if (!file) throw new Error('Usage: synapse blocks pull <file>')
  const blocks = findBlocks(readFileSync(resolve(file), 'utf8'))
  if (blocks.length === 0) throw new Error(`${file} has no synapse blocks`)
  const dir = blocksDir(createConfigManager().getSourcePath())
  if (!flags.dryRun) mkdirSync(dir, { recursive: true })
  blocks.forEach(({ name, content }) => {
    if (!flags.dryRun) writeFileSync(join(dir, `${name}.md`), `${content}\n`)
    console.log(
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
