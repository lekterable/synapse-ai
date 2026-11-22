// Loads Ink only when a command shows a prompt or a view; see ./ink.

export const confirm = async (
  message: string,
  defaultValue: boolean = false,
): Promise<boolean> => (await import('./ink')).confirm(message, defaultValue)

export const renderLines = async (lines: string[]): Promise<void> =>
  (await import('./ink')).renderLines(lines)
