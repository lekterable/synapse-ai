import type { CommandHandler } from './types'

const commandHandlers: Record<string, CommandHandler> = {}

export const registerCommand = (
  name: string,
  handler: CommandHandler,
): void => {
  if (commandHandlers[name]) {
    throw new Error(`Command "${name}" is already registered`)
  }
  commandHandlers[name] = handler
}

export const getCommandHandler = (
  command: string,
): CommandHandler | undefined => {
  return commandHandlers[command]
}
