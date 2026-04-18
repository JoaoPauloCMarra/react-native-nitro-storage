# Security Policy

## Supported Versions

Security fixes are shipped for the latest published `0.x` release line.

| Version | Supported |
| ------- | --------- |
| `0.5.x` | Yes       |
| `<0.5`  | No        |

## Reporting a Vulnerability

Report security issues through GitHub Security Advisories with:

- affected package version
- platform and OS version
- React Native and `react-native-nitro-modules` versions
- reproduction steps
- whether the issue affects Memory, Disk, Secure, biometric storage, web backends, or packaging

Do not publish proof-of-concept exploit details until a fix is available.

## Storage Boundary

Native Secure scope delegates encryption to platform storage APIs: iOS Keychain and Android Jetpack Security `EncryptedSharedPreferences`. Web Secure scope is API-compatible but defaults to namespaced `localStorage`; use a custom web secure backend when browser-side storage must meet a stricter threat model.
