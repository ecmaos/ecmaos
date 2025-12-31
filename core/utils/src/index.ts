import type { Kernel, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from './shared/terminal-command.js'

// Export shared infrastructure
export { TerminalCommand } from './shared/terminal-command.js'
export type { CommandArgs } from './shared/command-args.js'
export { writeStdout, writelnStdout, writeStderr, writelnStderr } from './shared/helpers.js'

// Import command factories
import { createCommand as createCat } from './commands/cat.js'
import { createCommand as createCd } from './commands/cd.js'
import { createCommand as createChmod } from './commands/chmod.js'
import { createCommand as createCp } from './commands/cp.js'
import { createCommand as createEcho } from './commands/echo.js'
import { createCommand as createLn } from './commands/ln.js'
import { createCommand as createLs } from './commands/ls.js'
import { createCommand as createMkdir } from './commands/mkdir.js'
import { createCommand as createMv } from './commands/mv.js'
import { createCommand as createPwd } from './commands/pwd.js'
import { createCommand as createRm } from './commands/rm.js'
import { createCommand as createRmdir } from './commands/rmdir.js'
import { createCommand as createStat } from './commands/stat.js'
import { createCommand as createTouch } from './commands/touch.js'
import { createCommand as createHex } from './commands/hex.js'
import { createCommand as createLess } from './commands/less.js'

// Export individual command factories
export { createCommand as createCat } from './commands/cat.js'
export { createCommand as createCd } from './commands/cd.js'
export { createCommand as createChmod } from './commands/chmod.js'
export { createCommand as createCp } from './commands/cp.js'
export { createCommand as createEcho } from './commands/echo.js'
export { createCommand as createLn } from './commands/ln.js'
export { createCommand as createLs } from './commands/ls.js'
export { createCommand as createMkdir } from './commands/mkdir.js'
export { createCommand as createMv } from './commands/mv.js'
export { createCommand as createPwd } from './commands/pwd.js'
export { createCommand as createRm } from './commands/rm.js'
export { createCommand as createRmdir } from './commands/rmdir.js'
export { createCommand as createStat } from './commands/stat.js'
export { createCommand as createTouch } from './commands/touch.js'
export { createCommand as createHex } from './commands/hex.js'
export { createCommand as createLess } from './commands/less.js'

/**
 * Creates all coreutils commands.
 * This function replaces the TerminalCommands function from the kernel.
 */
export function createAllCommands(kernel: Kernel, shell: Shell, terminal: Terminal): { [key: string]: TerminalCommand } {
  return {
    cat: createCat(kernel, shell, terminal),
    cd: createCd(kernel, shell, terminal),
    chmod: createChmod(kernel, shell, terminal),
    cp: createCp(kernel, shell, terminal),
    echo: createEcho(kernel, shell, terminal),
    ln: createLn(kernel, shell, terminal),
    ls: createLs(kernel, shell, terminal),
    mkdir: createMkdir(kernel, shell, terminal),
    mv: createMv(kernel, shell, terminal),
    pwd: createPwd(kernel, shell, terminal),
    rm: createRm(kernel, shell, terminal),
    rmdir: createRmdir(kernel, shell, terminal),
    stat: createStat(kernel, shell, terminal),
    touch: createTouch(kernel, shell, terminal),
    hex: createHex(kernel, shell, terminal),
    less: createLess(kernel, shell, terminal)
  }
}

// For backward compatibility, export as TerminalCommands
export { createAllCommands as TerminalCommands }

