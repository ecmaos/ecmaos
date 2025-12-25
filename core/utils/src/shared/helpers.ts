import type { Process, Terminal } from '@ecmaos/types'

/**
 * Helper to write to process stdout or fallback to terminal
 */
export async function writeStdout(process: Process | undefined, terminal: Terminal, text: string): Promise<void> {
  if (process && process.stdout) {
    const writer = process.stdout.getWriter()
    try {
      await writer.write(new TextEncoder().encode(text))
    } finally {
      writer.releaseLock()
    }
  } else {
    terminal.write(text)
  }
}

/**
 * Helper to write line to process stdout or fallback to terminal
 */
export async function writelnStdout(process: Process | undefined, terminal: Terminal, text: string): Promise<void> {
  await writeStdout(process, terminal, text + '\n')
}

/**
 * Helper to write to process stderr or fallback to terminal
 */
export async function writeStderr(process: Process | undefined, terminal: Terminal, text: string): Promise<void> {
  if (process) {
    const writer = process.stderr.getWriter()
    try {
      await writer.write(new TextEncoder().encode(text))
    } finally {
      writer.releaseLock()
    }
  } else {
    terminal.write(text)
  }
}

/**
 * Helper to write line to process stderr or fallback to terminal
 */
export async function writelnStderr(process: Process | undefined, terminal: Terminal, text: string): Promise<void> {
  await writeStderr(process, terminal, text + '\n')
}

