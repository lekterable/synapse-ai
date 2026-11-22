import chalk from 'chalk'
import { Box, render, Text, useInput } from 'ink'
import { type FC, useRef } from 'react'

// Everything that renders with Ink. Ink and React take most of the CLI's start-up time, so
// commands load this file through ./ui only when they show a prompt or a view.

type ConfirmPromptProps = {
  message: string
  defaultValue: boolean
  onSubmit: (value: boolean) => void
}

const ConfirmPrompt: FC<ConfirmPromptProps> = ({
  message,
  defaultValue,
  onSubmit,
}) => {
  const resolvedRef = useRef(false)

  const submit = (value: boolean): void => {
    if (resolvedRef.current) {
      return
    }
    resolvedRef.current = true
    onSubmit(value)
  }

  useInput((input, key) => {
    if (key.escape) {
      submit(false)
      return
    }

    if (key.return) {
      submit(defaultValue)
      return
    }

    if (input.toLowerCase() === 'y') {
      submit(true)
      return
    }

    if (input.toLowerCase() === 'n') {
      submit(false)
    }
  })

  return (
    <Box>
      <Text>
        {chalk.bold(message)} {chalk.dim(defaultValue ? '[Y/n]' : '[y/N]')}
      </Text>
    </Box>
  )
}

export const confirm = async (
  message: string,
  defaultValue: boolean = false,
): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    const instance = render(
      <ConfirmPrompt
        message={message}
        defaultValue={defaultValue}
        onSubmit={(value) => {
          instance.unmount()
          resolve(value)
        }}
      />,
    )
  })
}

// Prints lines as one Ink column, so each line wraps to the terminal like the rest of the views.
export const renderLines = (lines: string[]): void => {
  render(
    <Box flexDirection="column">
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the lines are static
        <Text key={index}>{line}</Text>
      ))}
    </Box>,
  )
}
