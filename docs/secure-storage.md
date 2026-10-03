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

On Android 11 and newer, the two levels use separate Android Keystore keys with distinct allowed authenticators. Android 10 and older support `BiometryOrPasscode`; `BiometryOnly` reports `biometric_unavailable` because the older Keystore API cannot enforce that distinction safely for this storage backend.

### Platform prompt behaviour

- **iOS:** reading a biometric item runs `SecItemCopyMatching` with user interaction allowed. The system shows the Face ID, Touch ID, or passcode sheet, and the synchronous JSI call blocks the JavaScript thread until the user answers. JavaScript timers, JavaScript-driven animations, and other JSI calls wait during that time. Read biometric items from a user action, not during render. Deleting a biometric item does not read it first unless an event listener or an unredacted event observer needs the previous value, so a delete does not show a prompt.
- **Android errors:** if the default Secure master key or store cannot be created (for example a Keystore key that exists but is unusable), Secure calls throw `storage_corruption`. This is not a temporary state: do not retry in a loop. Secure scope stays unavailable until the app data is cleared or the app is reinstalled; Memory and Disk keep working.
- **Android:** Nitro Storage never shows a prompt. Each biometric level is an `EncryptedSharedPreferences` file whose Tink keyset is wrapped by an Android Keystore key that requires user authentication within the last 30 seconds. That key is used only when the store is first opened in a process: `EncryptedSharedPreferences` decrypts the keyset once and keeps it in memory, and later reads and writes in the same process do not check authentication again. After the first successful open, biometric values stay readable without authentication until the process ends.
- **What Android apps must do:** run `androidx.biometric.BiometricPrompt` in the app before every read that must be gated, and treat the storage check as a one-time guard per process. Enable the config plugin option `addBiometricPermissions` so the app can declare `USE_BIOMETRIC` and `USE_FINGERPRINT` for its own prompt. Reading a `BiometryOrPasscode` item opens only the `BiometryOrPasscode` store, so a device-credential authentication is enough for that level.

## Access Control

`accessControl` maps to platform accessibility rules where available.

| Value                                          | Use when                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `AccessControl.WhenUnlocked`                   | The secret should be readable only after the device is unlocked.  |
| `AccessControl.AfterFirstUnlock`               | Background refresh needs access after first unlock until restart. |
| `AccessControl.WhenPasscodeSetThisDeviceOnly`  | The secret must stay on this device and require a passcode.       |
| `AccessControl.WhenUnlockedThisDeviceOnly`     | The secret should not migrate through backup/restore.             |
| `AccessControl.AfterFirstUnlockThisDeviceOnly` | Background refresh is needed, but migration is not allowed.       |

On iOS the level applies on every write, including updates of an item that already exists, so changing `accessControl` or `storage.setAccessControl()` moves existing items to the new level on their next write. On iOS, `item.has()` and `storage.has(key, StorageScope.Secure)` throw `keychain_locked` while the keychain is locked, and a Keychain status error for any other unexpected status, instead of returning `false`. A biometric item that the Keychain reports as needing authentication counts as present, so `has()` on a biometric item returns `true` without a prompt; while the device is locked the same status also returns `true`. Listing, counting, and prefix queries on Secure keys throw a Keychain status error for unexpected statuses instead of returning an empty result.

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

if (capabilities.secureStorage.encrypted === "available") {
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
behavior. The package does not sleep or retry internally; the application owns
lifecycle scheduling and cancellation. Biometric reads on iOS block the
synchronous JSI call while the system prompt is visible.

`fallbackToCacheOnReadError` returns the last value read in this process only
when a read fails with `keychain_locked`. Every other error still throws. Only
iOS reports `keychain_locked`; Android and web never do, so the fallback has no
effect there. Do not
enable it for access or refresh tokens unless the application explicitly
accepts stale credentials while the device is locked.

## Android Secure Write Mode

Android secure writes default to synchronous `SharedPreferences.commit()` for
the established durability contract. If asynchronous
`SharedPreferences.apply()` is acceptable, opt into async mode explicitly:

```ts
import { storage } from "react-native-nitro-storage";

storage.setSecureWritesAsync(true);
refreshTokenItem.set("opaque-refresh-token");
```

Coalesced secure item writes remain in a last-write-wins queue until the next
microtask or an explicit `flushSecureWrites()`. An explicit flush failure throws
and keeps failed and unattempted writes queued for retry. Scheduled failures
propagate unless `storage.setScheduledFlushErrorObserver()` is installed; it
receives `{ scope, error }` while the failed writes remain queued.

`flushSecureWrites()` drains the JavaScript queue into the backend. It does not
wait for Android `apply()` persistence. Use the default synchronous mode or
select `storage.setSecureWritesAsync(false)` before writes that need synchronous
native persistence. Changing the mode is not a barrier for earlier `apply()`
calls. `storage.clearBiometric()` drains pending Secure writes before clearing
biometric entries and surfaces native clear failures; it also cannot wait for
earlier Android `apply()` calls.

## iOS Legacy Disk Migration

Older releases tracked observed Disk keys in `standardUserDefaults`. On iOS,
the first Disk operation copies a valid registry into the Nitro suite domain and
removes each legacy source only after a target readback and synchronization
check. `NSUserDefaults` is not transactional, so the migration stops on any
failed synchronization or readback without deleting the source or registry.
Malformed registries, same-domain or fallback stores, conflicting target
values, and failed persistence therefore remain available for recovery. The
migration is retryable on a later launch; do not delete the registry
manually while an upgrade is in progress.

After that cutover, suite string keys are imported into the SQLite WAL Disk
database. New Disk writes go to SQLite. The v1 suite marker is preserved so
the UserDefaults cutover stays retryable. See
[native-libraries.md](native-libraries.md).

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
bun run test
bun run test:cpp
bun run audit:package
```

`bun run release:preflight` runs these checks together with the full release gate.

Also run the [physical-device Keychain lifecycle protocol](keychain-lifecycle-testing.md)
when changing biometric, Keychain, or error-classification behavior.
