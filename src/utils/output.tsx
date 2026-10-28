import chalk from 'chalk'

export type ErrorDetails = {
  problem: string
  reason: string
  solution: string
  exitCode?: number
}

export const showError = (details: ErrorDetails): never => {
  const { problem, reason, solution, exitCode = 1 } = details

  console.error(`${chalk.red('Error:')} ${problem}`)
  console.error(`${chalk.dim('Reason:')} ${reason}`)
  console.error(`${chalk.dim('Fix:')} ${solution}`)

  process.exit(exitCode)
}

// Writes one line to stdout, like console.log with a single string.
export const print = (message: string): void => {
  process.stdout.write(`${message}\n`)
}

export const showWarning = (message: string): void => {
  print(chalk.yellow(message))
}

export const showSuccess = (message: string): void => {
  print(chalk.green(message))
}

export const showVersion = (version: string): void => {
  print(version)
}
