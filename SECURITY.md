# Security Policy

## Supported Versions

Security fixes are shipped for the latest published `0.x` release line.

| Version  | Supported |
| -------- | --------- |
| `0.13.x` | Yes       |
| `< 0.13` | No        |

## Reporting a Vulnerability

Report security issues privately through GitHub private vulnerability reporting: https://github.com/JoaoPauloCMarra/react-native-nitro-storage/security/advisories/new

Never report vulnerabilities in public issues, pull requests, or discussions.

Include:

- affected package version
- platform and OS version
- React Native and `react-native-nitro-modules` versions
- reproduction steps
- whether the issue affects Memory, Disk, Secure, biometric storage, web backends, or packaging

Do not publish proof-of-concept exploit details until a fix is available.

## Storage Boundary

Memory scope keeps values in process memory only.

Native Disk scope stores values unencrypted in an app-private SQLite database in WAL mode on iOS and Android. Do not store secrets in Disk scope.

Native Secure scope delegates encryption to platform storage APIs: iOS Keychain and Android Jetpack Security `EncryptedSharedPreferences`.

Web Disk and Secure scopes default to namespaced `localStorage`, or to the custom backend set with `setWebDiskStorageBackend` / `setWebSecureStorageBackend`. Web Secure scope is API-compatible but not encrypted by default; use a custom web secure backend when browser-side storage must meet a stricter threat model.
