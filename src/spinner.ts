const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * A one-line spinner on `stream` until the returned function is called. It only appears
 * after a moment, so quick work (a warm Gradle daemon) doesn't flicker.
 */
export function spinner(stream: NodeJS.WriteStream): (message: string) => () => void {
  return (message) => {
    let frame = 0
    let shown = false
    const draw = () => {
      stream.write(`\r${FRAMES[frame++ % FRAMES.length]} ${message}`)
      shown = true
    }
    let timer: NodeJS.Timeout = setTimeout(() => {
      draw()
      timer = setInterval(draw, 80)
    }, 150)
    return () => {
      clearTimeout(timer)
      clearInterval(timer)
      // clear the line, leaving the cursor where the spinner started
      if (shown) stream.write('\r\x1b[2K')
    }
  }
}
