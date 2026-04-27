# Secure Storage

Secure scope is for secrets: refresh tokens, credentials, API tokens, and device-bound keys. It uses iOS Keychain on iOS and Android Keystore-backed EncryptedSharedPreferences on Android.

Use Disk scope for non-secret persisted state. Secure storage has stronger boundaries but more platform rules, especially around biometric prompts, device lock state, and backup/restore behavior.

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

`storage.export(StorageScope.Secure)` returns raw secret values so it can round-trip with `storage.import(data, StorageScope.Secure)`.

```ts
import { storage, StorageScope } from "react-native-nitro-storage";

const secureSnapshot = storage.export(StorageScope.Secure);
storage.import(secureSnapshot, StorageScope.Secure);
```

Only keep Secure exports in memory for the shortest possible workflow. Do not log them or include them in diagnostics, analytics, crash reports, or support bundles.

## Secure Event Warning

Secure scope event subscriptions and `storage.setEventObserver()` can receive raw secret values in `oldValue`, `newValue`, or batch `changes`.

Use Secure events for in-memory coordination only. Do not log Secure event payloads or send them to analytics, crash reporting, support bundles, or devtools sessions that persist outside the device.

## Locked Keychain Errors

```ts
import { isKeychainLockedError } from "react-native-nitro-storage";

try {
  refreshTokenItem.get();
} catch (error) {
  if (isKeychainLockedError(error)) {
    // Defer token refresh until the device is unlocked.
  }
}
```

The helper recognizes iOS locked Keychain cases and Android invalidated/locked key cases surfaced by the native bridge.

## Android Secure Write Mode

Android secure writes default to synchronous persistence. Enable async writes when write throughput is more important than immediate durability:

```ts
import { storage } from "react-native-nitro-storage";

storage.setSecureWritesAsync(true);
refreshTokenItem.set("opaque-refresh-token");
storage.flushSecureWrites();
```

Call `flushSecureWrites()` before assertions, namespace clears, or any boundary that requires deterministic persistence.

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

Also run an end-to-end auth flow on a locked/unlocked real device when changing biometric or Keychain behavior.
