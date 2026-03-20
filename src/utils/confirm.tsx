import React, { useRef } from 'react'
import { Box, Text, render, useInput } from 'ink'
import chalk from 'chalk'

type ConfirmPromptProps = {
  message: string
  defaultValue: boolean
  onSubmit: (value: boolean) => void
}

const ConfirmPrompt: React.FC<ConfirmPromptProps> = ({
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
