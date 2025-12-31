/**
 * @experimental
 * Handles authentication features
 */

import type { Auth as IAuth, PasswordCredentialInit } from '@ecmaos/types'

export class Auth implements IAuth {
  passkey = {
    // Create a new credential
    create: async (options: PublicKeyCredentialCreationOptions): Promise<Credential | null> => {
      try {
        if (!this.passkey.isSupported()) {
          throw new Error('WebAuthn is not supported in this browser')
        }

        if (!window.isSecureContext) {
          throw new Error('WebAuthn requires a secure context (HTTPS or localhost)')
        }

        const credential = await navigator.credentials.create({ publicKey: options })
        
        if (!credential || !(credential instanceof PublicKeyCredential)) {
          throw new Error('Failed to create credential')
        }

        return credential
      } catch (error) {
        if (error instanceof Error) {
          if (error.name === 'NotAllowedError') {
            throw new Error('User cancelled or denied the operation')
          } else if (error.name === 'InvalidStateError') {
            throw new Error('Credential already exists or operation is invalid')
          } else if (error.name === 'NotSupportedError') {
            throw new Error('The operation is not supported')
          } else if (error.name === 'SecurityError') {
            throw new Error('Security error: operation not allowed')
          }
          throw error
        }
        throw new Error(`Error creating credential: ${String(error)}`)
      }
    },

    // Get an existing credential
    get: async (options: PublicKeyCredentialRequestOptions): Promise<Credential | null> => {
      try {
        if (!this.passkey.isSupported()) {
          throw new Error('WebAuthn is not supported in this browser')
        }

        if (!window.isSecureContext) {
          throw new Error('WebAuthn requires a secure context (HTTPS or localhost)')
        }

        const credential = await navigator.credentials.get({ publicKey: options })
        
        if (!credential || !(credential instanceof PublicKeyCredential)) {
          return null
        }

        return credential
      } catch (error) {
        if (error instanceof Error) {
          if (error.name === 'NotAllowedError') {
            throw new Error('User cancelled or denied the operation')
          } else if (error.name === 'InvalidStateError') {
            throw new Error('No matching credential found')
          } else if (error.name === 'NotSupportedError') {
            throw new Error('The operation is not supported')
          } else if (error.name === 'SecurityError') {
            throw new Error('Security error: operation not allowed')
          }
          throw error
        }
        throw new Error(`Error getting credential: ${String(error)}`)
      }
    },

    // Check if WebAuthn is supported in the current browser
    isSupported: (): boolean => {
      return !!window.PublicKeyCredential && !!navigator.credentials
    },

    // Verify a passkey signature
    verify: async (
      credential: PublicKeyCredential,
      challenge: Uint8Array,
      publicKey: CryptoKey
    ): Promise<boolean> => {
      try {
        const response = credential.response as AuthenticatorAssertionResponse
        const signature = response.signature
        const clientDataJSON = response.clientDataJSON
        const authenticatorData = response.authenticatorData

        const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON))
        const receivedChallenge = Uint8Array.from(atob(clientData.challenge), c => c.charCodeAt(0))
        
        const expectedChallenge = challenge
        if (receivedChallenge.length !== expectedChallenge.length) {
          return false
        }
        
        for (let i = 0; i < expectedChallenge.length; i++) {
          if (receivedChallenge[i] !== expectedChallenge[i]) {
            return false
          }
        }

        const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON)
        const signedData = new Uint8Array(authenticatorData.byteLength + clientDataHash.byteLength)
        signedData.set(new Uint8Array(authenticatorData), 0)
        signedData.set(new Uint8Array(clientDataHash), authenticatorData.byteLength)

        const isValid = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          publicKey,
          signature,
          signedData
        )

        return isValid
      } catch (error) {
        console.error('Error verifying passkey:', error)
        return false
      }
    }
  }

  password = {
    create: async (options: PasswordCredentialInit): Promise<Credential | null> => {
      // @ts-expect-error - typescript does not accept password param, but it is valid
      return await navigator.credentials.create({ password: options })
    }
  }
}
