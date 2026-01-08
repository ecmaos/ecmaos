# Passkey Authentication Tutorial

This tutorial explains how to use passkeys (WebAuthn) for secure authentication in ecmaOS. Passkeys provide passwordless authentication using your device's built-in security features like fingerprint readers, face recognition, or hardware security keys.

## Overview

Passkeys are a modern authentication method that uses public-key cryptography. When you register a passkey, your device creates a unique cryptographic key pair. The private key stays securely on your device, while the public key is stored by ecmaOS. This makes passkeys more secure than traditional passwords since they can't be stolen or phished.

## Prerequisites

- A user account in ecmaOS
- A browser that supports WebAuthn (most modern browsers)
- A device with a compatible authenticator (fingerprint reader, face recognition, hardware security key, etc.)

## Registering a Passkey

To register a new passkey, use the `passkey register` command:

```bash
passkey register
```

You can optionally provide a name to help identify the passkey later:

```bash
passkey register --name "My Laptop"
```

Or use the alternative syntax:

```bash
passkey register --name=My\ Laptop
```

### Registration Process

1. Run the `passkey register` command
2. Your browser will prompt you to interact with your authenticator
3. Follow the on-screen instructions to complete registration - this may involve:
   - Scanning your fingerprint
   - Using face recognition
   - Pressing a button on a hardware security key
   - Entering a PIN
4. Once successful, you'll see a confirmation message with your passkey ID

**Example output:**

```text
Please interact with your authenticator to register a passkey...
Passkey registered successfully: My Laptop
Passkey ID: 550e8400-e29b-41d4-a716-446655440000
```

## Logging In with a Passkey

Once you've registered at least one passkey, the login process automatically uses passkey authentication:

1. When ecmaOS boots or you log out, you'll be prompted for your username
2. If your user account has registered passkeys, the system will automatically prompt you to use your passkey
3. Interact with your authenticator (fingerprint, face recognition, etc.)
4. You'll be logged in without needing to enter a password

**Note:** If passkey authentication is cancelled or fails, the system will fall back to password authentication.

## Managing Your Passkeys

### Listing Registered Passkeys

To see all passkeys registered for your account:

```bash
passkey list
```

This displays:

- Passkey ID
- Name (if provided)
- Creation date
- Last used date

**Example output:**

```text
Registered passkeys (2):

  ID: 550e8400-e29b-41d4-a716-446655440000
    Name: My Laptop
    Created: 12/15/2024, 10:30:00 AM
    Last used: 12/15/2024, 2:45:00 PM

  ID: 7c9e6679-7425-40de-944b-e07fc1f90ae7
    Created: 12/14/2024, 3:20:00 PM
    Last used: Never
```

### Removing a Passkey

To remove a specific passkey, use the `remove` subcommand with the passkey ID:

```bash
passkey remove --id 550e8400-e29b-41d4-a716-446655440000
```

Or:

```bash
passkey remove --id=550e8400-e29b-41d4-a716-446655440000
```

You can find the passkey ID by running `passkey list`.

### Removing All Passkeys

To remove all registered passkeys at once:

```bash
passkey remove-all
```

**Warning:** This will remove all passkeys for your account. You'll need to use password authentication until you register a new passkey.

## Getting Help

To see all available commands and options:

```bash
passkey --help
```

Or:

```bash
passkey help
```

## Best Practices

1. **Use descriptive names**: When registering passkeys, use meaningful names (e.g., "Work Laptop", "Phone", "YubiKey") to easily identify them later

2. **Register multiple passkeys**: Consider registering passkeys on multiple devices for redundancy. If you lose access to one device, you can still log in from another

3. **Keep your device secure**: Since passkeys are tied to your device, ensure your device is protected with a strong lock screen password or PIN

4. **Review your passkeys regularly**: Use `passkey list` periodically to review registered passkeys and remove any you no longer use

5. **Have a backup**: Don't rely solely on passkeys. Make sure you still know your password in case you need to authenticate without a passkey-enabled device
