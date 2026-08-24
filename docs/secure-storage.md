# Secure Storage

Secure scope is for secrets: refresh tokens, credentials, API tokens, and device-bound keys. It uses iOS Keychain on iOS and Android Keystore-backed EncryptedSharedPreferences on Android.

Use Disk scope for non-secret persisted state. Secure storage has stronger boundaries but more platform rules, especially around biometric prompts, device lock state, and backup/restore behavior.

Keep Secure values small. Platform secure stores are optimized for credentials and keys, not large payloads or support bundles.

## Store a Secure Token

```ts
import {
  AccessControl,
  createStorageItem,
  StorageScope,
} from "react-native-nitro-storage";

export const refreshTokenItem = createStorageItem<string>({
  key: "refreshToken",
  namespace: "auth",
  scope: StorageScope.Secure,
  defaultValue: "",
  accessControl: AccessControl.AfterFirstUnlockThisDeviceOnly,
});

refreshTokenItem.set("opaque-refresh-token");
```

## Biometric Secrets

```ts
import {
  BiometricLevel,
  createStorageItem,
  StorageScope,
} from "react-native-nitro-storage";

export const recoveryCodeItem = createStorageItem<string>({
  key: "recoveryCode",
  namespace: "vault",
  scope: StorageScope.Secure,
  defaultValue: "",
  biometric: true,
  biometricLevel: BiometricLevel.BiometryOnly,
});
```

`BiometricLevel.BiometryOnly` does not allow passcode fallback. Use `BiometricLevel.BiometryOrPasscode` when passcode fallback is acceptable.

On Android 11 and newer, the two levels use separate Android Keystore keys with distinct allowed authenticators. Android 10 and older support `BiometryOrPasscode`; `BiometryOnly` reports `biometric_unavailable` because the older Keystore API cannot enforce that distinction safely for this storage backend. Android authorization remains valid for a 30-second window after successful authentication.

## Access Control

`accessControl` maps to platform accessibility rules where available.

| Value                                          | Use when                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `AccessControl.WhenUnlocked`                   | The secret should be readable only after the device is unlocked.  |
| `AccessControl.AfterFirstUnlock`               | Background refresh needs access after first unlock until restart. |
| `AccessControl.WhenPasscodeSetThisDeviceOnly`  | The secret must stay on this device and require a passcode.       |
| `AccessControl.WhenUnlockedThisDeviceOnly`     | The secret should not migrate through backup/restore.             |
| `AccessControl.AfterFirstUnlockThisDeviceOnly` | Background refresh is needed, but migration is not allowed.       |

## Secure Auth Item Map

`createSecureAuthStorage()` creates a namespaced map of secure string items.

```ts
import {
  AccessControl,
  BiometricLevel,
  createSecureAuthStorage,
} from "react-native-nitro-storage";

export const authStorage = createSecureAuthStorage(
  {
    accessToken: { ttlMs: 15 * 60 * 1000 },
    refreshToken: {
      accessControl: AccessControl.AfterFirstUnlockThisDeviceOnly,
    },
    recoveryCode: {
      biometric: true,
      biometricLevel: BiometricLevel.BiometryOrPasscode,
    },
  },
  { namespace: "auth" },
);

authStorage.refreshToken.set("opaque-refresh-token");
```

## Runtime Capabilities

Use capability APIs to decide which support messages or diagnostics to show.

```ts
import { storage } from "react-native-nitro-storage";

const capabilities = storage.getSecurityCapabilities();

if (capabilities.secureStorage === "available") {
  // Secure scope is backed by the configured native or web secure backend.
}
```

Capability fields are status values, not guarantees beyond the active backend. Hardware-backed storage is reported as `unknown` unless the platform can prove it.

## Metadata Without Values

Use metadata APIs when rendering diagnostics or support dumps where secret values must stay out of memory.

```ts
import { storage } from "react-native-nitro-storage";

const oneKey = storage.getSecureMetadata("auth:refreshToken");
const allKeys = storage.getAllSecureMetadata();
```

`getSecureMetadata()` and `getAllSecureMetadata()` never return stored secret values. They report key existence, storage kind, backend name, access-control metadata, and whether a metadata path accidentally exposed a value.

## Secure Export Warning

`storage.export(StorageScope.Secure)` throws unless you explicitly opt into exposing raw secret values. Use `storage.exportSecureUnsafe()` or `storage.export(StorageScope.Secure, { includeSecureValues: true })` only when you need to round-trip with `storage.import(data, StorageScope.Secure)`.

```ts
import { storage, StorageScope } from "react-native-nitro-storage";

const secureSnapshot = storage.exportSecureUnsafe();
storage.import(secureSnapshot, StorageScope.Secure);
```

Only keep Secure exports in memory for the shortest possible workflow. Do not log them or include them in diagnostics, analytics, crash reports, or support bundles.

## Secure Event Warning

Secure scope event subscriptions can receive raw secret values in `oldValue`, `newValue`, or batch `changes`. `storage.setEventObserver()` redacts Secure values by default because observer callbacks are commonly used for logging and devtools.

Use Secure events for in-memory coordination only. Do not log Secure event payloads or send them to analytics, crash reporting, support bundles, or devtools sessions that persist outside the device. Pass `{ redactSecureValues: false }` to `setEventObserver()` only for local, non-persistent debugging.

## Android Backup Rules

Android secure storage uses encrypted SharedPreferences. Restored encrypted preference files can become unreadable when the app's Keystore keys are not restored with them. The Expo plugin configures backup exclusions for Nitro Storage secure files by default:

- `NitroStorageSecure.xml`
- `NitroStorageBiometric.xml`
- `NitroStorageBiometricOrPasscode.xml`
- `NitroStorageBiometricOnly.xml`

If you disable `configureAndroidBackup` or maintain custom Android backup XML, add equivalent exclusions for both cloud backup and device transfer.

## Secure Storage Error Recovery

```ts
import { isStorageError } from "react-native-nitro-storage";

try {
  refreshTokenItem.get();
} catch (error) {
  if (isStorageError(error, "keychain_locked")) {
    // Defer token refresh until the device is unlocked.
  }
}
```

Recovery depends on the exact stable code:

| Code                      | Meaning                                   | Consumer action                                     |
| ------------------------- | ----------------------------------------- | --------------------------------------------------- |
| `keychain_locked`         | Protected data is temporarily unavailable | Retry after the device unlocks and the app resumes. |
| `authentication_required` | The secure item requires user interaction | Start the application's authentication flow.        |
| `key_invalidated`         | The platform key can no longer decrypt it | Remove and recreate the affected credential safely. |

`isKeychainLockedError()` remains available for compatibility but is
deprecated. It groups all three codes and must not be used to select retry
behavior. The package does not block the synchronous JSI call, sleep, or retry
internally; the application owns lifecycle scheduling and cancellation.

Do not enable `fallbackToCacheOnReadError` for access or refresh tokens unless
the application explicitly accepts stale or revoked credentials. A cached
value can hide the distinction between temporary unavailability and credential
recovery.

## Android Secure Write Mode

Android secure writes default to asynchronous `SharedPreferences.apply()`. If
the caller requires each secure write to wait for a durable
`SharedPreferences.commit()`, opt into synchronous mode:

```ts
import { storage } from "react-native-nitro-storage";

storage.setSecureWritesAsync(false);
refreshTokenItem.set("opaque-refresh-token");
```

Coalesced secure item writes remain in a last-write-wins queue until the next
microtask or an explicit `flushSecureWrites()`. A failed flush throws and keeps
failed and unattempted writes queued for a later retry. Call
`flushSecureWrites()` before assertions, namespace clears, or any boundary that
requires deterministic persistence. `storage.clearBiometric()` is also a
durability barrier: it flushes pending Secure writes before clearing biometric
entries, and surfaces native clear failures.

## iOS Legacy Disk Migration

Older releases tracked observed Disk keys in `standardUserDefaults`. On iOS,
adapter initialization copies a valid registry into the Nitro suite domain and
removes each legacy source only after a target readback and synchronization
check. `NSUserDefaults` is not transactional, so the migration stops on any
failed synchronization or readback without deleting the source or registry.
Malformed registries, same-domain or fallback stores, conflicting target
values, and failed persistence therefore remain available for recovery. The
migration is retryable on a later initialization; do not delete the registry
manually while an upgrade is in progress.

## Web Secure Backend

Browsers cannot provide iOS Keychain or Android Keystore guarantees. On web, Secure scope is only as strong as the backend you configure.

```ts
import { setWebSecureStorageBackend } from "react-native-nitro-storage";
import { createIndexedDBBackend } from "react-native-nitro-storage/indexeddb-backend";

const backend = await createIndexedDBBackend();
setWebSecureStorageBackend(backend);
```

See [web-backends.md](web-backends.md) for backend contracts and IndexedDB setup.

## Release Checks

Before releasing secure-storage changes, run:

```sh
bun run test -- --filter=react-native-nitro-storage
bun run test:cpp -- --filter=react-native-nitro-storage
(cd packages/react-native-nitro-storage && bun run check:pack)
```

Also run the [physical-device Keychain lifecycle protocol](keychain-lifecycle-testing.md)
when changing biometric, Keychain, or error-classification behavior.
