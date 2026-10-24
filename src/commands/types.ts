export type CliFlags = {
  help: boolean
  version: boolean
  dryRun: boolean
  yes: boolean
  strategy: string
  root?: string
  scope?: string
  shared: boolean
  repos?: string
}

export type CommandHandler = (
  input: string[],
  flags: CliFlags,
) => Promise<void> | void
