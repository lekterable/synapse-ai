import chalk from 'chalk'

export interface ErrorDetails {
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

export const showWarning = (message: string): void => {
  console.log(chalk.yellow(message))
}

export const showSuccess = (message: string): void => {
  console.log(chalk.green(message))
}

export const showVersion = (version: string): void => {
  console.log(version)
}
