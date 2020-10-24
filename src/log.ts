import c from 'ansi-colors'

export type LogType = 'info' | 'success' | 'error'

const getBaseColor = (type: LogType) => {
  switch (type) {
    case 'info':
      return c.white
    case 'success':
      return c.green
    case 'error':
      return c.red
  }
}
/**
 * This log function does some smart coloring.
 */
export const log = (message: string, type: LogType = 'info') => {
  const header = c.bold.blue('[MB] ')
  const baseColor = getBaseColor(type)
  const formattedMessage = message
    // Pull Request #
    .replace(/(#\d+)/g, c.bold.yellow('$1'))
    // Label
    .replace(/("\w+")/g, c.italic.blue('$1'))

  console.log(header + baseColor(formattedMessage))
}
