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
import { createCommand as createGrep } from './commands/grep.js'
import { createCommand as createHead } from './commands/head.js'
import { createCommand as createLn } from './commands/ln.js'
import { createCommand as createLs } from './commands/ls.js'
import { createCommand as createMkdir } from './commands/mkdir.js'
import { createCommand as createMv } from './commands/mv.js'
import { createCommand as createNc } from './commands/nc.js'
import { createCommand as createPwd } from './commands/pwd.js'
import { createCommand as createSockets } from './commands/sockets.js'
import { createCommand as createRm } from './commands/rm.js'
import { createCommand as createRmdir } from './commands/rmdir.js'
import { createCommand as createStat } from './commands/stat.js'
import { createCommand as createTouch } from './commands/touch.js'
import { createCommand as createHex } from './commands/hex.js'
import { createCommand as createLess } from './commands/less.js'
import { createCommand as createMan } from './commands/man.js'
import { createCommand as createPasskey } from './commands/passkey.js'
import { createCommand as createSed } from './commands/sed.js'
import { createCommand as createTee } from './commands/tee.js'
import { createCommand as createTail } from './commands/tail.js'
import { createCommand as createTar } from './commands/tar.js'
import { createCommand as createBasename } from './commands/basename.js'
import { createCommand as createCal } from './commands/cal.js'
import { createCommand as createComm } from './commands/comm.js'
import { createCommand as createCut } from './commands/cut.js'
import { createCommand as createDate } from './commands/date.js'
import { createCommand as createDiff } from './commands/diff.js'
import { createCommand as createDirname } from './commands/dirname.js'
import { createCommand as createFalse } from './commands/false.js'
import { createCommand as createFind } from './commands/find.js'
import { createCommand as createFormat } from './commands/format.js'
import { createCommand as createId } from './commands/id.js'
import { createCommand as createJoin } from './commands/join.js'
import { createCommand as createNl } from './commands/nl.js'
import { createCommand as createPaste } from './commands/paste.js'
import { createCommand as createSeq } from './commands/seq.js'
import { createCommand as createSort } from './commands/sort.js'
import { createCommand as createSplit } from './commands/split.js'
import { createCommand as createTest } from './commands/test.js'
import { createCommand as createTr } from './commands/tr.js'
import { createCommand as createTrue } from './commands/true.js'
import { createCommand as createUniq } from './commands/uniq.js'
import { createCommand as createUser } from './commands/user.js'
import { createCommand as createWc } from './commands/wc.js'
import { createCommand as createWhich } from './commands/which.js'
import { createCommand as createWhoami } from './commands/whoami.js'

// Export individual command factories
export { createCommand as createCat } from './commands/cat.js'
export { createCommand as createCd } from './commands/cd.js'
export { createCommand as createChmod } from './commands/chmod.js'
export { createCommand as createCp } from './commands/cp.js'
export { createCommand as createEcho } from './commands/echo.js'
export { createCommand as createGrep } from './commands/grep.js'
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
export { createCommand as createMan } from './commands/man.js'
export { createCommand as createSed } from './commands/sed.js'
export { createCommand as createTee } from './commands/tee.js'
export { createCommand as createTail } from './commands/tail.js'
export { createCommand as createTar } from './commands/tar.js'
export { createCommand as createBasename } from './commands/basename.js'
export { createCommand as createCut } from './commands/cut.js'
export { createCommand as createDate } from './commands/date.js'
export { createCommand as createDiff } from './commands/diff.js'
export { createCommand as createDirname } from './commands/dirname.js'
export { createCommand as createFind } from './commands/find.js'
export { createCommand as createFormat } from './commands/format.js'
export { createCommand as createSort } from './commands/sort.js'
export { createCommand as createTest } from './commands/test.js'
export { createCommand as createTr } from './commands/tr.js'
export { createCommand as createUniq } from './commands/uniq.js'
export { createCommand as createUser } from './commands/user.js'
export { createCommand as createWc } from './commands/wc.js'
export { createCommand as createWhich } from './commands/which.js'
export { createCommand as createSockets } from './commands/sockets.js'

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
    grep: createGrep(kernel, shell, terminal),
    head: createHead(kernel, shell, terminal),
    ln: createLn(kernel, shell, terminal),
    ls: createLs(kernel, shell, terminal),
    mkdir: createMkdir(kernel, shell, terminal),
    mv: createMv(kernel, shell, terminal),
    pwd: createPwd(kernel, shell, terminal),
    nc: createNc(kernel, shell, terminal),
    sockets: createSockets(kernel, shell, terminal),
    rm: createRm(kernel, shell, terminal),
    rmdir: createRmdir(kernel, shell, terminal),
    stat: createStat(kernel, shell, terminal),
    touch: createTouch(kernel, shell, terminal),
    hex: createHex(kernel, shell, terminal),
    less: createLess(kernel, shell, terminal),
    man: createMan(kernel, shell, terminal),
    passkey: createPasskey(kernel, shell, terminal),
    sed: createSed(kernel, shell, terminal),
    tail: createTail(kernel, shell, terminal),
    tee: createTee(kernel, shell, terminal),
    basename: createBasename(kernel, shell, terminal),
    cal: createCal(kernel, shell, terminal),
    comm: createComm(kernel, shell, terminal),
    cut: createCut(kernel, shell, terminal),
    date: createDate(kernel, shell, terminal),
    diff: createDiff(kernel, shell, terminal),
    dirname: createDirname(kernel, shell, terminal),
    false: createFalse(kernel, shell, terminal),
    find: createFind(kernel, shell, terminal),
    format: createFormat(kernel, shell, terminal),
    id: createId(kernel, shell, terminal),
    join: createJoin(kernel, shell, terminal),
    nl: createNl(kernel, shell, terminal),
    paste: createPaste(kernel, shell, terminal),
    seq: createSeq(kernel, shell, terminal),
    sort: createSort(kernel, shell, terminal),
    split: createSplit(kernel, shell, terminal),
    tar: createTar(kernel, shell, terminal),
    test: createTest(kernel, shell, terminal),
    tr: createTr(kernel, shell, terminal),
    true: createTrue(kernel, shell, terminal),
    uniq: createUniq(kernel, shell, terminal),
    user: createUser(kernel, shell, terminal),
    wc: createWc(kernel, shell, terminal),
    which: createWhich(kernel, shell, terminal),
    whoami: createWhoami(kernel, shell, terminal)
  }
}

// For backward compatibility, export as TerminalCommands
export { createAllCommands as TerminalCommands }

