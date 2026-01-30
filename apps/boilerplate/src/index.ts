#!ecmaos:bin:app:boilerplate

import type { ProcessEntryParams } from '@ecmaos/types'

const main = async (params: ProcessEntryParams) => {
  console.log('Boilerplate App:', params)
  const { args, command, cwd, gid, kernel, pid, shell, terminal, stdin, stdout, stderr, uid } = params
  terminal.writeln(`Hello, ${kernel.name} ${kernel.id}!`)
  terminal.writeln(`CWD: ${cwd}`)
  terminal.writeln(`ARGS: ${args.join(' ')}`)

  kernel.dom.toast.success('Boilerplate app loaded!')
}

export default main
