import type { Kernel, Shell, Terminal } from '@ecmaos/types'
import type { TerminalCommand } from './shared/terminal-command.js'

// Export shared infrastructure
export { TerminalCommand } from './shared/terminal-command.js'
export { writeStdout, writelnStdout, writeStderr, writelnStderr } from './shared/helpers.js'
export type { CommandArgs } from './shared/command-args.js'

// Import command factories
import { createCommand as createAwk } from './commands/awk.js'
import { createCommand as createBasename } from './commands/basename.js'
import { createCommand as createCal } from './commands/cal.js'
import { createCommand as createCat } from './commands/cat.js'
import { createCommand as createCd } from './commands/cd.js'
import { createCommand as createChmod } from './commands/chmod.js'
import { createCommand as createChown } from './commands/chown.js'
import { createCommand as createCksum } from './commands/cksum.js'
import { createCommand as createCmp } from './commands/cmp.js'
import { createCommand as createColumn } from './commands/column.js'
import { createCommand as createComm } from './commands/comm.js'
import { createCommand as createCp } from './commands/cp.js'
import { createCommand as createCron } from './commands/cron.js'
import { createCommand as createCrypto } from './commands/crypto.js'
import { createCommand as createCurl } from './commands/curl.js'
import { createCommand as createCut } from './commands/cut.js'
import { createCommand as createDd } from './commands/dd.js'
import { createCommand as createDate } from './commands/date.js'
import { createCommand as createDiff } from './commands/diff.js'
import { createCommand as createDirname } from './commands/dirname.js'
import { createCommand as createEcho } from './commands/echo.js'
import { createCommand as createEnv } from './commands/env.js'
import { createCommand as createExpand } from './commands/expand.js'
import { createCommand as createFactor } from './commands/factor.js'
import { createCommand as createFalse } from './commands/false.js'
import { createCommand as createFetch } from './commands/fetch.js'
import { createCommand as createFind } from './commands/find.js'
import { createCommand as createFmt } from './commands/fmt.js'
import { createCommand as createFold } from './commands/fold.js'
import { createCommand as createFormat } from './commands/format.js'
import { createCommand as createGrep } from './commands/grep.js'
import { createCommand as createGroups } from './commands/groups.js'
import { createCommand as createGit } from './commands/git.js'
import { createCommand as createHash } from './commands/hash.js'
import { createCommand as createHead } from './commands/head.js'
import { createCommand as createHistory } from './commands/history.js'
import { createCommand as createHostname } from './commands/hostname.js'
import { createCommand as createId } from './commands/id.js'
import { createCommand as createJoin } from './commands/join.js'
import { createCommand as createLess } from './commands/less.js'
import { createCommand as createLn } from './commands/ln.js'
import { createCommand as createLs } from './commands/ls.js'
import { createCommand as createMan } from './commands/man.js'
import { createCommand as createMkdir } from './commands/mkdir.js'
import { createCommand as createMktemp } from './commands/mktemp.js'
import { createCommand as createMount } from './commands/mount.js'
import { createCommand as createMv } from './commands/mv.js'
import { createCommand as createNc } from './commands/nc.js'
import { createCommand as createNl } from './commands/nl.js'
import { createCommand as createOd } from './commands/od.js'
import { createCommand as createOpen } from './commands/open.js'
import { createCommand as createPasskey } from './commands/passkey.js'
import { createCommand as createPaste } from './commands/paste.js'
import { createCommand as createPlay } from './commands/play.js'
import { createCommand as createPr } from './commands/pr.js'
import { createCommand as createPrintf } from './commands/printf.js'
import { createCommand as createPwd } from './commands/pwd.js'
import { createCommand as createReadlink } from './commands/readlink.js'
import { createCommand as createRealpath } from './commands/realpath.js'
import { createCommand as createRev } from './commands/rev.js'
import { createCommand as createRm } from './commands/rm.js'
import { createCommand as createRmdir } from './commands/rmdir.js'
import { createCommand as createSeq } from './commands/seq.js'
import { createCommand as createSed } from './commands/sed.js'
import { createCommand as createShuf } from './commands/shuf.js'
import { createCommand as createSleep } from './commands/sleep.js'
import { createCommand as createSockets } from './commands/sockets.js'
import { createCommand as createSort } from './commands/sort.js'
import { createCommand as createSplit } from './commands/split.js'
import { createCommand as createStat } from './commands/stat.js'
import { createCommand as createStrings } from './commands/strings.js'
import { createCommand as createTac } from './commands/tac.js'
import { createCommand as createTail } from './commands/tail.js'
import { createCommand as createTar } from './commands/tar.js'
import { createCommand as createTee } from './commands/tee.js'
import { createCommand as createTest } from './commands/test.js'
import { createCommand as createTime } from './commands/time.js'
import { createCommand as createTouch } from './commands/touch.js'
import { createCommand as createTr } from './commands/tr.js'
import { createCommand as createTrue } from './commands/true.js'
import { createCommand as createTty } from './commands/tty.js'
import { createCommand as createUname } from './commands/uname.js'
import { createCommand as createUmount } from './commands/umount.js'
import { createCommand as createUnexpand } from './commands/unexpand.js'
import { createCommand as createUniq } from './commands/uniq.js'
import { createCommand as createUnzip } from './commands/unzip.js'
import { createCommand as createUptime } from './commands/uptime.js'
import { createCommand as createUser } from './commands/user.js'
import { createCommand as createVim } from './commands/vim.js'
import { createCommand as createVideo } from './commands/video.js'
import { createCommand as createView } from './commands/view.js'
import { createCommand as createWc } from './commands/wc.js'
import { createCommand as createWeb } from './commands/web.js'
import { createCommand as createWhich } from './commands/which.js'
import { createCommand as createWhoami } from './commands/whoami.js'
import { createCommand as createXxd } from './commands/xxd.js'
import { createCommand as createZip } from './commands/zip.js'

// Export individual command factories
export { createCommand as createAwk } from './commands/awk.js'
export { createCommand as createBasename } from './commands/basename.js'
export { createCommand as createCat } from './commands/cat.js'
export { createCommand as createCd } from './commands/cd.js'
export { createCommand as createChmod } from './commands/chmod.js'
export { createCommand as createCksum } from './commands/cksum.js'
export { createCommand as createCmp } from './commands/cmp.js'
export { createCommand as createColumn } from './commands/column.js'
export { createCommand as createCp } from './commands/cp.js'
export { createCommand as createCron } from './commands/cron.js'
export { createCommand as createCrypto } from './commands/crypto.js'
export { createCommand as createCurl } from './commands/curl.js'
export { createCommand as createCut } from './commands/cut.js'
export { createCommand as createDd } from './commands/dd.js'
export { createCommand as createDate } from './commands/date.js'
export { createCommand as createDiff } from './commands/diff.js'
export { createCommand as createDirname } from './commands/dirname.js'
export { createCommand as createEcho } from './commands/echo.js'
export { createCommand as createEnv } from './commands/env.js'
export { createCommand as createExpand } from './commands/expand.js'
export { createCommand as createFactor } from './commands/factor.js'
export { createCommand as createFetch } from './commands/fetch.js'
export { createCommand as createFind } from './commands/find.js'
export { createCommand as createFmt } from './commands/fmt.js'
export { createCommand as createFold } from './commands/fold.js'
export { createCommand as createFormat } from './commands/format.js'
export { createCommand as createGrep } from './commands/grep.js'
export { createCommand as createGroups } from './commands/groups.js'
export { createCommand as createHash } from './commands/hash.js'
export { createCommand as createHistory } from './commands/history.js'
export { createCommand as createLess } from './commands/less.js'
export { createCommand as createLn } from './commands/ln.js'
export { createCommand as createLs } from './commands/ls.js'
export { createCommand as createMan } from './commands/man.js'
export { createCommand as createMkdir } from './commands/mkdir.js'
export { createCommand as createMktemp } from './commands/mktemp.js'
export { createCommand as createMount } from './commands/mount.js'
export { createCommand as createMv } from './commands/mv.js'
export { createCommand as createOpen } from './commands/open.js'
export { createCommand as createPlay } from './commands/play.js'
export { createCommand as createPr } from './commands/pr.js'
export { createCommand as createPrintf } from './commands/printf.js'
export { createCommand as createPwd } from './commands/pwd.js'
export { createCommand as createReadlink } from './commands/readlink.js'
export { createCommand as createRealpath } from './commands/realpath.js'
export { createCommand as createRev } from './commands/rev.js'
export { createCommand as createRm } from './commands/rm.js'
export { createCommand as createRmdir } from './commands/rmdir.js'
export { createCommand as createSed } from './commands/sed.js'
export { createCommand as createShuf } from './commands/shuf.js'
export { createCommand as createSleep } from './commands/sleep.js'
export { createCommand as createSockets } from './commands/sockets.js'
export { createCommand as createSort } from './commands/sort.js'
export { createCommand as createStat } from './commands/stat.js'
export { createCommand as createStrings } from './commands/strings.js'
export { createCommand as createTac } from './commands/tac.js'
export { createCommand as createTail } from './commands/tail.js'
export { createCommand as createTar } from './commands/tar.js'
export { createCommand as createTee } from './commands/tee.js'
export { createCommand as createTest } from './commands/test.js'
export { createCommand as createTouch } from './commands/touch.js'
export { createCommand as createTr } from './commands/tr.js'
export { createCommand as createTty } from './commands/tty.js'
export { createCommand as createUname } from './commands/uname.js'
export { createCommand as createUmount } from './commands/umount.js'
export { createCommand as createUniq } from './commands/uniq.js'
export { createCommand as createUnzip } from './commands/unzip.js'
export { createCommand as createUptime } from './commands/uptime.js'
export { createCommand as createUser } from './commands/user.js'
export { createCommand as createVideo } from './commands/video.js'
export { createCommand as createView } from './commands/view.js'
export { createCommand as createVim } from './commands/vim.js'
export { createCommand as createWc } from './commands/wc.js'
export { createCommand as createWeb } from './commands/web.js'
export { createCommand as createWhich } from './commands/which.js'
export { createCommand as createXxd } from './commands/xxd.js'
export { createCommand as createZip } from './commands/zip.js'
export { createCommand as createGit } from './commands/git.js'

/**
 * Creates all coreutils commands.
 * This function replaces the TerminalCommands function from the kernel.
 */
export function createAllCommands(kernel: Kernel, shell: Shell, terminal: Terminal): { [key: string]: TerminalCommand } {
  return {
    awk: createAwk(kernel, shell, terminal),
    basename: createBasename(kernel, shell, terminal),
    cal: createCal(kernel, shell, terminal),
    cat: createCat(kernel, shell, terminal),
    cd: createCd(kernel, shell, terminal),
    cksum: createCksum(kernel, shell, terminal),
    chmod: createChmod(kernel, shell, terminal),
    chown: createChown(kernel, shell, terminal),
    cmp: createCmp(kernel, shell, terminal),
    column: createColumn(kernel, shell, terminal),
    comm: createComm(kernel, shell, terminal),
    cp: createCp(kernel, shell, terminal),
    cron: createCron(kernel, shell, terminal),
    crypto: createCrypto(kernel, shell, terminal),
    curl: createCurl(kernel, shell, terminal),
    cut: createCut(kernel, shell, terminal),
    dd: createDd(kernel, shell, terminal),
    date: createDate(kernel, shell, terminal),
    diff: createDiff(kernel, shell, terminal),
    dirname: createDirname(kernel, shell, terminal),
    echo: createEcho(kernel, shell, terminal),
    env: createEnv(kernel, shell, terminal),
    expand: createExpand(kernel, shell, terminal),
    factor: createFactor(kernel, shell, terminal),
    false: createFalse(kernel, shell, terminal),
    fetch: createFetch(kernel, shell, terminal),
    find: createFind(kernel, shell, terminal),
    fmt: createFmt(kernel, shell, terminal),
    fold: createFold(kernel, shell, terminal),
    format: createFormat(kernel, shell, terminal),
    git: createGit(kernel, shell, terminal),
    grep: createGrep(kernel, shell, terminal),
    groups: createGroups(kernel, shell, terminal),
    hash: createHash(kernel, shell, terminal),
    head: createHead(kernel, shell, terminal),
    history: createHistory(kernel, shell, terminal),
    hostname: createHostname(kernel, shell, terminal),
    id: createId(kernel, shell, terminal),
    join: createJoin(kernel, shell, terminal),
    less: createLess(kernel, shell, terminal),
    ln: createLn(kernel, shell, terminal),
    ls: createLs(kernel, shell, terminal),
    man: createMan(kernel, shell, terminal),
    mkdir: createMkdir(kernel, shell, terminal),
    mktemp: createMktemp(kernel, shell, terminal),
    mount: createMount(kernel, shell, terminal),
    mv: createMv(kernel, shell, terminal),
    nc: createNc(kernel, shell, terminal),
    nl: createNl(kernel, shell, terminal),
    od: createOd(kernel, shell, terminal),
    open: createOpen(kernel, shell, terminal),
    passkey: createPasskey(kernel, shell, terminal),
    paste: createPaste(kernel, shell, terminal),
    play: createPlay(kernel, shell, terminal),
    pr: createPr(kernel, shell, terminal),
    printf: createPrintf(kernel, shell, terminal),
    pwd: createPwd(kernel, shell, terminal),
    readlink: createReadlink(kernel, shell, terminal),
    realpath: createRealpath(kernel, shell, terminal),
    rev: createRev(kernel, shell, terminal),
    rm: createRm(kernel, shell, terminal),
    rmdir: createRmdir(kernel, shell, terminal),
    sed: createSed(kernel, shell, terminal),
    seq: createSeq(kernel, shell, terminal),
    shuf: createShuf(kernel, shell, terminal),
    sleep: createSleep(kernel, shell, terminal),
    sockets: createSockets(kernel, shell, terminal),
    sort: createSort(kernel, shell, terminal),
    split: createSplit(kernel, shell, terminal),
    stat: createStat(kernel, shell, terminal),
    strings: createStrings(kernel, shell, terminal),
    tac: createTac(kernel, shell, terminal),
    tail: createTail(kernel, shell, terminal),
    tar: createTar(kernel, shell, terminal),
    tee: createTee(kernel, shell, terminal),
    test: createTest(kernel, shell, terminal),
    time: createTime(kernel, shell, terminal),
    touch: createTouch(kernel, shell, terminal),
    tr: createTr(kernel, shell, terminal),
    true: createTrue(kernel, shell, terminal),
    tty: createTty(kernel, shell, terminal),
    uname: createUname(kernel, shell, terminal),
    umount: createUmount(kernel, shell, terminal),
    unexpand: createUnexpand(kernel, shell, terminal),
    uniq: createUniq(kernel, shell, terminal),
    unzip: createUnzip(kernel, shell, terminal),
    uptime: createUptime(kernel, shell, terminal),
    user: createUser(kernel, shell, terminal),
    vc: createVideo(kernel, shell, terminal), // correction: should be video
    view: createView(kernel, shell, terminal),
    vim: createVim(kernel, shell, terminal),
    wc: createWc(kernel, shell, terminal),
    web: createWeb(kernel, shell, terminal),
    which: createWhich(kernel, shell, terminal),
    whoami: createWhoami(kernel, shell, terminal),
    xxd: createXxd(kernel, shell, terminal),
    zip: createZip(kernel, shell, terminal),
  }
}

// For backward compatibility, export as TerminalCommands
export { createAllCommands as TerminalCommands }
