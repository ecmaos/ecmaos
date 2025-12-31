import chalk from 'chalk'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Passkey, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'passkey',
    description: 'Manage passkey credentials for WebAuthn authentication',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'subcommand', type: String, defaultOption: true, description: 'Subcommand: register, list, remove, remove-all' },
      { name: 'name', type: String, description: 'Name/description for the passkey (used with register)' },
      { name: 'id', type: String, description: 'Passkey ID to remove (used with remove)' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const currentUid = shell.credentials.uid
      const user = kernel.users.get(currentUid)
      if (!user) {
        await writelnStderr(process, terminal, chalk.red('Error: Current user not found'))
        return 1
      }

      const subcommand = (argv.subcommand as string)?.toLowerCase()

      if (!subcommand || subcommand === 'help' || argv.help) {
        await writelnStdout(process, terminal, 'Usage: passkey <subcommand> [options]')
        await writelnStdout(process, terminal, '')
        await writelnStdout(process, terminal, 'Subcommands:')
        await writelnStdout(process, terminal, '  register [--name <name>]    Register a new passkey')
        await writelnStdout(process, terminal, '  list                        List all registered passkeys')
        await writelnStdout(process, terminal, '  remove --id <id>            Remove a specific passkey')
        await writelnStdout(process, terminal, '  remove-all                  Remove all passkeys')
        return 0
      }

      try {
        switch (subcommand) {
          case 'register': {
            if (!kernel.auth.passkey.isSupported()) {
              await writelnStderr(process, terminal, chalk.red('Error: WebAuthn is not supported in this browser'))
              return 1
            }

            const name = (argv.name as string) || undefined
            const username = user.username
            const userId = new TextEncoder().encode(username)

            const challenge = crypto.getRandomValues(new Uint8Array(32))
            const rpId = globalThis.location.hostname || 'localhost'

            const createOptions: PublicKeyCredentialCreationOptions = {
              challenge,
              rp: {
                name: kernel.name || 'ecmaOS',
                id: rpId
              },
              user: {
                id: userId,
                name: username,
                displayName: username
              },
              pubKeyCredParams: [
                { type: 'public-key', alg: -7 },
                { type: 'public-key', alg: -257 }
              ],
              authenticatorSelection: {
                userVerification: 'preferred'
              },
              timeout: 60000
            }

            await writelnStdout(process, terminal, chalk.yellow('Please interact with your authenticator to register a passkey...'))
            const credential = await kernel.auth.passkey.create(createOptions)

            if (!credential || !(credential instanceof PublicKeyCredential)) {
              await writelnStderr(process, terminal, chalk.red('Error: Failed to create passkey. Registration cancelled or failed.'))
              return 1
            }

            const publicKeyCredential = credential as PublicKeyCredential
            const response = publicKeyCredential.response as AuthenticatorAttestationResponse

            const credentialId = btoa(String.fromCharCode(...new Uint8Array(publicKeyCredential.rawId)))
            
            let publicKeyArray: Uint8Array
            
            try {
              if (typeof response.getPublicKey === 'function') {
                try {
                  const publicKeyCrypto = response.getPublicKey()
                  
                  if (publicKeyCrypto && publicKeyCrypto instanceof CryptoKey) {
                    const publicKeyJwk = await crypto.subtle.exportKey('jwk', publicKeyCrypto)
                    publicKeyArray = new TextEncoder().encode(JSON.stringify(publicKeyJwk))
                  } else {
                    throw new Error('getPublicKey() did not return a valid CryptoKey')
                  }
                } catch (exportError) {
                  await writelnStderr(process, terminal, chalk.yellow(`Warning: Could not extract public key via getPublicKey(): ${exportError instanceof Error ? exportError.message : String(exportError)}. Using attestationObject instead.`))
                  const attestationObject = response.attestationObject
                  publicKeyArray = new Uint8Array(attestationObject)
                }
              } else {
                const attestationObject = response.attestationObject
                publicKeyArray = new Uint8Array(attestationObject)
              }
            } catch (error) {
              await writelnStderr(process, terminal, chalk.red(`Error processing credential data: ${error instanceof Error ? error.message : String(error)}`))
              return 1
            }

            const passkey = {
              id: crypto.randomUUID(),
              credentialId,
              publicKey: publicKeyArray,
              createdAt: Date.now(),
              name
            }

            await kernel.users.addPasskey(currentUid, passkey)
            await writelnStdout(process, terminal, chalk.green(`Passkey registered successfully${name ? `: ${name}` : ''}`))
            await writelnStdout(process, terminal, `Passkey ID: ${passkey.id}`)
            return 0
          }

          case 'list': {
            const passkeys = await kernel.users.getPasskeys(currentUid)
            
            if (passkeys.length === 0) {
              await writelnStdout(process, terminal, 'No passkeys registered for this user.')
              return 0
            }

            await writelnStdout(process, terminal, `Registered passkeys (${passkeys.length}):`)
            await writelnStdout(process, terminal, '')
            
            for (const pk of passkeys) {
              const createdDate = new Date(pk.createdAt).toLocaleString()
              const lastUsedDate = pk.lastUsed ? new Date(pk.lastUsed).toLocaleString() : 'Never'
              await writelnStdout(process, terminal, `  ID: ${pk.id}`)
              if (pk.name) {
                await writelnStdout(process, terminal, `    Name: ${pk.name}`)
              }
              await writelnStdout(process, terminal, `    Created: ${createdDate}`)
              await writelnStdout(process, terminal, `    Last used: ${lastUsedDate}`)
              await writelnStdout(process, terminal, '')
            }
            return 0
          }

          case 'remove': {
            const id = argv.id as string
            if (!id) {
              await writelnStderr(process, terminal, chalk.red('Error: --id is required for remove command'))
              await writelnStdout(process, terminal, 'Usage: passkey remove --id <id>')
              return 1
            }

            const passkeys = await kernel.users.getPasskeys(currentUid)
            const passkey = passkeys.find(pk => pk.id === id)
            
            if (!passkey) {
              await writelnStderr(process, terminal, chalk.red(`Error: Passkey with ID ${id} not found`))
              return 1
            }

            await kernel.users.removePasskey(currentUid, id)
            await writelnStdout(process, terminal, chalk.green(`Passkey removed successfully${passkey.name ? `: ${passkey.name}` : ''}`))
            return 0
          }

          case 'remove-all': {
            const passkeys = await kernel.users.getPasskeys(currentUid)
            
            if (passkeys.length === 0) {
              await writelnStdout(process, terminal, 'No passkeys to remove.')
              return 0
            }

            await kernel.users.savePasskeys(currentUid, [])
            const passkeysPath = `${user.home}/.passkeys`
            try {
              await kernel.filesystem.fs.unlink(passkeysPath)
            } catch {}

            await writelnStdout(process, terminal, chalk.green(`Removed ${passkeys.length} passkey(s)`))
            return 0
          }

          default:
            await writelnStderr(process, terminal, chalk.red(`Error: Unknown subcommand: ${subcommand}`))
            await writelnStdout(process, terminal, 'Run "passkey help" for usage information')
            return 1
        }
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
        return 1
      }
    }
  })
}
