# react-native-nitro-storage

[![npm version](https://img.shields.io/npm/v/react-native-nitro-storage?color=f97316&label=npm)](https://www.npmjs.com/package/react-native-nitro-storage)
[![npm downloads](https://img.shields.io/npm/dm/react-native-nitro-storage?color=22c55e&label=downloads)](https://www.npmjs.com/package/react-native-nitro-storage)
[![CI](https://github.com/JoaoPauloCMarra/react-native-nitro-storage/actions/workflows/ci.yml/badge.svg)](https://github.com/JoaoPauloCMarra/react-native-nitro-storage/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-native-nitro-storage?color=007ec6)](https://github.com/JoaoPauloCMarra/react-native-nitro-storage/blob/main/LICENSE)
[![React Native](https://img.shields.io/badge/react--native-0.86.3-61dafb)](https://reactnative.dev/docs/0.86/getting-started-without-a-framework)
[![Expo](https://img.shields.io/badge/expo-SDK%2057%20%28RN%200.86.3%29-000020)](https://docs.expo.dev/versions/v57.0.0/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.37.0%20%3C0.38.0-black)](https://nitro.margelo.com/)
[![TypeScript](https://img.shields.io/badge/typescript-6.0-3178c6)](https://www.typescriptlang.org/)

Synchronous Memory, Disk, and Secure storage for React Native, Expo development
builds, and web. Nitro Storage is powered by
[Nitro Modules](https://nitro.margelo.com/) and JSI, with typed storage items,
React hooks, batch operations, event subscriptions, migrations, biometric secure
values, MMKV migration helpers, and configurable web backends.

Use it for startup state, preferences, feature flags, local auth state, secure
tokens, biometric-protected values, optimistic writes, app migrations, and
state-library persistence where a synchronous API is the right fit. Use a
database or server-state cache instead for relational queries, large collections,
pagination, conflict resolution, or remote synchronization.

## Contents

- [Install](#install)
- [Requirements and compatibility](#requirements-and-compatibility)
- [Expo Config](#expo-config)
- [Quick Start](#quick-start)
- [Auth Tokens](#auth-tokens)
- [Typed Storage Items](#typed-storage-items)
- [Item Ergonomics](#item-ergonomics)
- [Set Items](#set-items)
- [Groups And Lifecycle](#groups-and-lifecycle)
- [Legacy Key Migration And Secure Resilience](#legacy-key-migration-and-secure-resilience)
- [React Hooks](#react-hooks)
- [Storage Scopes](#storage-scopes)
- [Prefix Queries](#prefix-queries)
- [Secure Storage](#secure-storage)
- [Batch Operations](#batch-operations)
- [Events And Observability](#events-and-observability)
- [Migrations And Transactions](#migrations-and-transactions)
- [Web Backends](#web-backends)
- [Testing](#testing)
- [Platform Support](#platform-support)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Install

```sh
bun add react-native-nitro-storage react-native-nitro-modules
```

## Requirements and compatibility

Peer dependencies:

| Package                      | Version            |
| ---------------------------- | ------------------ |
| `react`                      | `>=18.2.0`         |
| `react-native`               | `>=0.77.0`         |
| `react-native-nitro-modules` | `>=0.37.0 <0.38.0` |

Nitro peer requirement: `react-native-nitro-modules >=0.37.0 <0.38.0`.

| Tested on                                  | Supported floor                     |
| ------------------------------------------ | ----------------------------------- |
| React Native `0.86.3` / Expo SDK `57.0.26` | React Native `0.77` / Expo SDK `53` |

Nitro Storage supports React Native 0.77 or newer and Expo SDK 53 or newer,
which is the minimum for Nitro Modules 0.37: its Android package does not
compile against React Native 0.76. It is tested on React Native 0.86.3 and Expo
SDK 57.

The `react-native-nitro-storage/testing` and
`react-native-nitro-storage/indexeddb-backend` subpaths also resolve when Metro
package exports are disabled (the default before React Native 0.79).

The package gate uses React Native `0.86.3` and the Strict TypeScript API.
`check:ci` also compiles the public source against React Native `0.87.0`'s
Strict TypeScript API; this does not change the runtime baseline. The Expo
example uses Expo SDK `57.0.26`, React Native
`0.86.3`, React `19.2.3`, and Nitro Modules `0.37.1`, which is the React Native
version supported by that Expo SDK. Do not override Expo's React Native version.

When upgrading from 0.8.x or 0.9.x, upgrade Nitro Modules to the 0.37.x range
before installing this package, then rebuild the native app so the generated
Nitro bindings and native runtime use the same major-minor version:

```sh
bun add react-native-nitro-modules@0.37.1 react-native-nitro-storage@0.15.0
bunx expo prebuild
```

`SetStorageItem.get()` retains its original `Record<string, true>` compatibility
shape. At runtime, absent members are still absent, so use `set.has(member)` for
membership checks. New code that wants a precise member union can use
`set.getTyped()`, which returns `Partial<Record<TMember, true>>`.

Nitro Storage requires an Expo development build or a bare React Native app;
Expo Go and native Windows, macOS, and tvOS targets are not supported.

For Expo development builds:

```sh
bunx expo install react-native-nitro-storage react-native-nitro-modules
bunx expo prebuild
```

Expo Go cannot load Nitro native modules. Use an Expo development build or a
bare React Native app.

iOS static frameworks are supported with source-built React Native. After
upgrading, regenerate the Expo native project or run `pod install`, then rebuild
the app so CocoaPods applies the updated header paths.

## Expo Config

Add the config plugin before prebuilding native iOS and Android projects:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-nitro-storage",
        {
          "faceIDPermission": "Allow $(PRODUCT_NAME) to unlock secure storage.",
          "addBiometricPermissions": false,
          "configureAndroidBackup": true
        }
      ]
    ]
  }
}
```

| Option                    | Default                  | What it does                                                    |
| ------------------------- | ------------------------ | --------------------------------------------------------------- |
| `faceIDPermission`        | Built-in Face ID message | Sets `NSFaceIDUsageDescription`.                                |
| `addBiometricPermissions` | `false`                  | Adds Android `USE_BIOMETRIC` and `USE_FINGERPRINT` permissions. |
| `configureAndroidBackup`  | `true`                   | Writes Android backup rules that exclude secure storage files.  |

Nitro Storage does not show a biometric prompt on Android. Enable
`addBiometricPermissions` when your app runs its own `BiometricPrompt` before it
reads biometric items; the permissions are for that prompt.

Android adapter initialization is owned by the package through an Android
manifest initializer, so apps should not edit `MainApplication` to call
`AndroidStorageAdapter.init(this)`. Set `configureAndroidBackup: false` only
when your app maintains equivalent backup and device-transfer exclusions for
Nitro Storage secure files.

## Quick Start

```ts
import {
  StorageScope,
  createStorageItem,
  storage,
} from "react-native-nitro-storage";

const themeItem = createStorageItem<"light" | "dark">({
  key: "theme",
  namespace: "settings",
  scope: StorageScope.Disk,
  defaultValue: "light",
});

themeItem.set("dark");

const theme = themeItem.get();
const raw = storage.getString("settings:theme", StorageScope.Disk);
```

`storage.getString` / `setString` remain the raw API. Prefer typed items for
application state.

Native storage calls are synchronous JSI operations. Keep values and batches
small enough for the JavaScript event loop; native and configured web-backend
failures throw errors. Secure cache fallback is opt-in through
`fallbackToCacheOnReadError` and applies only to `keychain_locked` read errors,
which only iOS reports.
Storage keys must be non-empty strings; an empty key throws an `invalid_key`
error before it reaches native storage.

## Auth Tokens

Use `createSecureAuthStorage` for access and refresh tokens. `renameFrom`
copies a legacy key on first read and deletes it, so you do not need a custom
migration helper.

```ts
import { createSecureAuthStorage } from "react-native-nitro-storage";

const auth = createSecureAuthStorage(
  {
    accessToken: { renameFrom: "authToken" },
    refreshToken: { renameFrom: "refreshToken" },
  },
  { namespace: "auth" },
);

auth.accessToken.set("access-token");
const current = auth.accessToken.get();
auth.accessToken.subscribe(() => {});
```

Keep `getString` facades only when the app owns a storage architecture
boundary. `createSecureAuthStorage` already namespaces keys, notifies
subscribers, and migrates legacy keys.

Do not enable `fallbackToCacheOnReadError` for access or refresh tokens unless
the application explicitly accepts stale credentials while the keychain is
locked. Handle temporary secure-storage errors and retry from application
lifecycle state instead.

## Typed Storage Items

`createStorageItem<T>()` is the recommended API for application code. It keeps
serialization, validation, default values, TTL, namespace, access-control, and
React hook types attached to the key.

```ts
type Preferences = {
  theme: "system" | "light" | "dark";
  compactMode: boolean;
};

const preferencesItem = createStorageItem<Preferences>({
  key: "preferences",
  namespace: "settings",
  scope: StorageScope.Disk,
  defaultValue: { theme: "system", compactMode: false },
  validate: (value): value is Preferences =>
    typeof value === "object" && value !== null && "theme" in value,
});

preferencesItem.set((previous) => ({
  ...previous,
  compactMode: !previous.compactMode,
}));

const snapshot = preferencesItem.getWithVersion();
const didWrite = preferencesItem.setIfVersion(snapshot.version, {
  ...snapshot.value,
  theme: "dark",
});
```

The package ships its own TypeScript types, so editors and AI tools catch
mistakes before they reach the runtime. It exports `StorageItem`,
`StorageItemConfig`, `StorageSetter`, `StorageActions`, `VersionedValue`,
`StorageBatchSetItem`, `StorageClearOptions`, `StorageKeyRef`, `SetItemConfig`,
`SetStorageItem`, plus web backend, event, secure-metadata, and capability types.

## Item Ergonomics

`merge`, `reset`, and `setOrDelete` cover the most common object-state edits
without re-reading or hand-writing compare-and-swap loops. Scoped factories
(`memoryItem`, `diskItem`, `secureItem`) drop the repeated `scope` field.

```ts
import { diskItem, memoryItem } from "react-native-nitro-storage";

const config = diskItem<{ theme: "light" | "dark"; compact: boolean }>({
  key: "config",
  defaultValue: { theme: "light", compact: false },
});

config.merge({ compact: true }); // shallow object update
config.reset(); // deletes the stored key; the next read returns the default value
const loginMethod = memoryItem<string | null>({
  key: "loginMethod",
  defaultValue: null,
});
loginMethod.setOrDelete(maybeMethod); // null/undefined deletes, value sets
```

## Set Items

`createSetItem()` models set-membership state (seen ids, dismissed prompts)
without hand-rolling membership helpers. Its compatibility `get()` result is a
`Record<string, true>`; absent members are still not stored at runtime. Use
`getTyped()` when a precise `Partial<Record<TMember, true>>` result is useful.
Adding an existing member or deleting an absent one is a no-op, so subscribers
do not re-render.

```ts
import { createSetItem, StorageScope } from "react-native-nitro-storage";

const dismissedTips = createSetItem({
  key: "dismissedTips",
  scope: StorageScope.Disk,
});

dismissedTips.add("welcome");
dismissedTips.has("welcome"); // true
dismissedTips.toggle("welcome"); // false (removed)
dismissedTips.values(); // string[]
```

## Groups And Lifecycle

Tag items with a `group` to clear related state in one call, or keep specific
keys while wiping the rest of a scope. This replaces manual snapshot-and-restore
logout flows.

```ts
import { secureItem, storage, StorageScope } from "react-native-nitro-storage";

const accessToken = secureItem<string>({
  key: "accessToken",
  defaultValue: "",
  group: "session",
});

// Wipe everything tied to the session.
storage.clearGroup("session");

// Wipe Disk but keep a few opt-in preferences.
storage.clear(StorageScope.Disk, {
  except: [apiEnvironmentItem, "onboardingComplete"],
});
```

## Legacy Key Migration And Secure Resilience

`renameFrom` migrates an old key to a new one on first read and deletes the
legacy entry. Secure items that set `fallbackToCacheOnReadError` return the last
value read in this process when a read fails with `keychain_locked`. Every other
read error, such as `authentication_required`, `key_invalidated`, or
`storage_corruption`, still throws. Only iOS reports `keychain_locked`, so the fallback has an effect only on iOS; Android and web never use it. Use the fallback for values where a stale
copy is acceptable, not for credentials.

```ts
import {
  secureItem,
  createSecureAuthStorage,
} from "react-native-nitro-storage";

const cachedProfile = secureItem<{ name: string } | null>({
  key: "profile",
  namespace: "account",
  defaultValue: null,
  renameFrom: "userProfile", // copied + cleaned up on first read
  fallbackToCacheOnReadError: true,
  onReadError: (error) => reportSecureReadError(error),
});

const auth = createSecureAuthStorage(
  {
    accessToken: { renameFrom: "authToken" },
    refreshToken: { renameFrom: "refreshToken" },
  },
  { namespace: "auth", group: "session" },
);
```

## React Hooks

```tsx
import { Switch } from "react-native";
import { useSetStorage, useStorage } from "react-native-nitro-storage";

export function ThemeToggle() {
  const [theme] = useStorage(themeItem);
  const setTheme = useSetStorage(themeItem);

  return (
    <Switch
      value={theme === "dark"}
      onValueChange={(enabled) => setTheme(enabled ? "dark" : "light")}
    />
  );
}
```

Use `useStorageSelector()` when a component needs a derived value instead of the
whole stored object.

```tsx
import { useStorageSelector } from "react-native-nitro-storage";

const [compactMode] = useStorageSelector(
  preferencesItem,
  (preferences) => preferences.compactMode,
);
```

`useStorage` also returns a render-stable `actions` object as a third element,
and `useStorageValue` / `useStorageActions` split read and write concerns.

```tsx
import {
  useStorage,
  useStorageActions,
  useStorageValue,
} from "react-native-nitro-storage";

const [config, setConfig, actions] = useStorage(configItem);
actions.merge({ compact: true });
actions.reset();

const theme = useStorageValue(themeItem); // read-only, no setter
const tokenActions = useStorageActions(tokenItem); // { set, merge, reset, remove, setOrDelete }
```

## Storage Scopes

| Scope                 | Backing store                                                                                     | Use it for                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `StorageScope.Memory` | In-process memory                                                                                 | Session-only state, fast counters, and render-time caches.                   |
| `StorageScope.Disk`   | SQLite WAL on iOS/Android (imports UserDefaults / SharedPreferences once); configured web backend | Preferences, feature flags, onboarding state, and non-secret persisted data. |
| `StorageScope.Secure` | Keychain on iOS, Android Keystore-backed preferences                                              | Refresh tokens, credentials, API tokens, and biometric-protected values.     |

## Prefix Queries

Prefix queries use literal, case-sensitive matching on every backend. `User::`
and `user::` are separate namespaces; `%`, `_`, and `\\` are literal characters.
Raw enumeration returns the original strings and preserves arbitrary keys as own
properties on an ordinary object, including `__proto__`.

Disk and Secure strings preserve embedded NUL characters in keys and values,
including batch operations. Earlier versions could truncate strings at Android
JNI or iOS Foundation boundaries; this fix cannot reconstruct previously lost
suffixes. iOS legacy Disk migration also preserves full keys without aliasing
shorter host-app defaults keys.

```ts
storage.setString("User::theme", "dark", StorageScope.Disk);
storage.setString("user::theme", "light", StorageScope.Disk);
const settings = storage.getByPrefix("User::", StorageScope.Disk);
// settings["User::theme"] === "dark"; no lowercase namespace entries.
```

## Secure Storage

```ts
import {
  AccessControl,
  BiometricLevel,
  StorageScope,
  createSecureAuthStorage,
  createStorageItem,
  isStorageError,
  storage,
} from "react-native-nitro-storage";

const refreshToken = createStorageItem<string>({
  key: "refreshToken",
  namespace: "auth",
  scope: StorageScope.Secure,
  defaultValue: "",
  accessControl: AccessControl.AfterFirstUnlockThisDeviceOnly,
});

const recoveryCode = createStorageItem<string>({
  key: "recoveryCode",
  namespace: "auth",
  scope: StorageScope.Secure,
  defaultValue: "",
  biometric: true,
  biometricLevel: BiometricLevel.BiometryOrPasscode,
});

const auth = createSecureAuthStorage({
  accessToken: { ttlMs: 15 * 60_000 },
  refreshToken: {
    accessControl: AccessControl.AfterFirstUnlockThisDeviceOnly,
  },
});

try {
  recoveryCode.get();
} catch (error) {
  if (isStorageError(error, "keychain_locked")) {
    storage.getSecurityCapabilities();
  }
}
```

Secure scope uses iOS Keychain and Android Keystore-backed
EncryptedSharedPreferences. Keep secure values small, do not log them, and avoid
exporting secure values unless you are intentionally doing a short-lived
in-memory migration. `storage.export(StorageScope.Secure)` throws unless you
explicitly opt into `{ includeSecureValues: true }`.

Android secure writes default to synchronous `commit()` durability. Call
`storage.setSecureWritesAsync(true)` only when asynchronous `apply()` writes are
acceptable. `storage.flushSecureWrites()` drains the JavaScript write queue into
the native backend; it does not wait for Android `apply()` to reach disk. Keep
the default synchronous mode, or call `storage.setSecureWritesAsync(false)`
before the writes that need synchronous native persistence. Changing the mode
does not make earlier `apply()` calls durable retroactively. A failed explicit
flush throws and keeps failed or unattempted queued writes available for retry.
`storage.clearBiometric()`
flushes pending Secure writes before clearing biometric entries and surfaces
native clear failures.

On Android 11 and newer, `BiometricLevel.BiometryOnly` and
`BiometricLevel.BiometryOrPasscode` use separate Keystore policies. Android 10
and older support `BiometryOrPasscode`; `BiometryOnly` throws
`biometric_unavailable` because those releases cannot safely enforce the
biometric-only distinction. Promoting a value to biometric storage removes the
plain secure copy on every platform, so plain reads cannot return a stale
value. Secure existence, discovery, and cleanup operations
can also throw when a protected store is locked or its key is invalidated. Use
`isStorageError()` to choose the correct recovery path: retry
`keychain_locked` after unlock, request user interaction for
`authentication_required`, and rebuild the affected credential for
`key_invalidated`.

Changing the access control level applies to later writes of existing items
too: on iOS every Secure write now updates `kSecAttrAccessible` of an item that
already exists. On iOS, `item.has()` and `storage.has(key, StorageScope.Secure)` throw
`keychain_locked` while the keychain is locked, and a Keychain status error for
any other unexpected status, instead of returning `false`. A biometric item that
the Keychain reports as needing authentication counts as present, so `has()` on
a biometric item returns `true` without a prompt; while the device is locked the
same status also returns `true`. Listing, counting, and prefix queries on Secure
keys throw a Keychain status error for unexpected statuses instead of returning
an empty result. Deleting an item reads its previous value only when an event listener
or an unredacted event observer needs it, so deleting a biometric item does not
show a biometric prompt.

Biometric behaviour differs by platform:

- **iOS:** `getSecureBiometric` reads run through the Keychain with user
  interaction allowed. The system shows the Face ID, Touch ID, or passcode sheet
  and the synchronous JSI call blocks the JavaScript thread until the user
  answers. Read biometric items from a user action, not during render.
- **Android:** Nitro Storage never shows a prompt. Each biometric store is an
  `EncryptedSharedPreferences` file whose Keystore key requires recent user
  authentication. The key is checked only when the store is first opened in a
  process; later reads and writes in that process use the already-decrypted
  keyset and do not check authentication again. Run your own `BiometricPrompt`
  before every read that must be gated. Reading a `BiometryOrPasscode` item
  opens only that store, so a device-credential authentication is enough.

Scheduled Disk and Secure flush failures can be handled without losing the
pending writes:

```ts
import {
  storage,
  type StorageScheduledFlushError,
} from "react-native-nitro-storage";

let lastFlushFailure: StorageScheduledFlushError | undefined;
storage.setScheduledFlushErrorObserver((failure) => {
  lastFlushFailure = failure;
});

// Call after resolving the failure, such as freeing space or unlocking storage.
function retryPendingWrites() {
  storage.flushDiskWrites();
  storage.flushSecureWrites();
  lastFlushFailure = undefined;
}

// Remove the observer when its owner is disposed.
function stopObservingFlushErrors() {
  storage.setScheduledFlushErrorObserver(undefined);
}
```

The observer receives the failed scope and the error thrown by the backend
adapter. Web adapters may wrap the underlying failure in an error with `cause`.
It replaces
the uncaught scheduled-flush error only while installed; without an observer,
the error still propagates. Explicit flush calls always throw to their caller,
and an observer that throws also propagates its error. Register one observer per
storage instance and handle retry failures at the calling boundary. The observer
reports the synchronous backend handoff; it cannot report a later Android
`apply()` or IndexedDB persistence failure that the backend does not expose.

### Access Control Lifecycle

`storage.setAccessControl(level)` sets the default `AccessControl` for Secure
writes. Follow these rules:

- It is per process and is not persisted. Call it on every launch, before the
  first Secure write, for example at module scope in your app entry.
- It affects writes only. Reads never use the level, and an existing Keychain
  item keeps its accessibility class until it is written again. On iOS every
  Secure write, including an update of an existing item, sets
  `kSecAttrAccessible`, so a rewrite moves the item to the current level.
- An item created with its own `accessControl` option uses that level instead
  of the default.
- Android has no Keychain accessibility classes. `setAccessControl` only records
  the JavaScript default there and changes no native behavior.
- Raw `storage.setString(key, value, StorageScope.Secure)` writes use the same
  default level.

```ts
import { AccessControl, storage } from "react-native-nitro-storage";

storage.setAccessControl(AccessControl.AfterFirstUnlockThisDeviceOnly);
```

### Migrating Existing Secure Items

Items written under `WhenUnlocked` stay unreadable while the device is locked,
even after you change the default. `migrateSecureAccessControl(level, options?)`
sets `level` as the default and rewrites each Secure item so the Keychain item
gets the new class. It reads the stored string and writes the same string back,
so values are never decoded, changed, or deleted.

```ts
import {
  AccessControl,
  migrateSecureAccessControl,
} from "react-native-nitro-storage";

const result = migrateSecureAccessControl(
  AccessControl.AfterFirstUnlockThisDeviceOnly,
);
// { migrated: string[]; locked: string[]; missing: string[];
//   skipped: string[]; failed: { key: string; code?: StorageErrorCode }[] }

if (result.locked.length > 0) {
  // Retry only the locked keys once protected data is available.
  migrateSecureAccessControl(AccessControl.AfterFirstUnlockThisDeviceOnly, {
    keys: result.locked,
  });
}
```

- Run it while the device is unlocked, for example from a foreground user
  action or after `storage.isProtectedDataAvailable()` returns `true`. Reading
  or rewriting a `WhenUnlocked` item while locked fails with `keychain_locked`.
- A key whose read or write fails with `keychain_locked` is left unchanged and
  listed in `locked`. Any other error leaves the key unchanged and lists it in
  `failed` with its error code. The helper never deletes data.
- `options.keys` limits the work to specific keys. Without it, every Secure key
  is processed. Biometric-protected items are listed in `skipped` and are never
  read, because reading them can show a biometric prompt.
- The level becomes the default for later writes even when a key fails, so new
  writes already use it.
- Items that you configured with their own `accessControl` option are rewritten
  with `level` too. Pass `options.keys` to leave them out.
- On Android and web there is no accessibility class to change. The helper
  validates the level, records the default, reads and writes nothing, and lists
  every Secure key in `skipped`.
- Each rewrite is a native write, so storage listeners and observers receive a
  change event for every migrated key, even though the value is unchanged.
- It is JavaScript only and works with any 0.14-compatible native module.

### Protected Data Availability

On iOS, Keychain items in the `WhenUnlocked` classes (`WhenUnlocked`,
`WhenUnlockedThisDeviceOnly`, and `WhenPasscodeSetThisDeviceOnly`) can be read
only while protected data is available. Use these APIs to
wait instead of catching `keychain_locked`:

```ts
import { storage } from "react-native-nitro-storage";

const available: boolean = storage.isProtectedDataAvailable();

const unsubscribe = storage.onProtectedDataAvailable(() => {
  // Protected data became available again.
});
unsubscribe();
```

- `isProtectedDataAvailable()` returns a cached value and never blocks. iOS
  updates it from the `UIApplicationProtectedDataDidBecomeAvailable` and
  `UIApplicationProtectedDataWillBecomeUnavailable` notifications. The first
  value is read from `UIApplication` on the main thread when the native storage
  module is first created. If the main thread is busy, the value reads `true` until that read
  completes.
- `onProtectedDataAvailable(listener)` calls `listener` each time protected data
  changes from unavailable to available, and returns an unsubscribe function. It
  does not call the listener on subscribe. Subscribe first, then check
  `isProtectedDataAvailable()`, so a change between the two calls is not missed.
- In an iOS app extension `UIApplication` is not available. The module cannot
  read the state there, so `isProtectedDataAvailable()` returns `true` and
  `keychain_locked` remains the signal.
- Android and web always return `true`, and the listener never fires.

### Handling keychain_locked

When a production app sees `keychain_locked` because Secure reads run while the
device is locked, for example during a background launch, defer those reads
until protected data is available. This keeps the default `WhenUnlocked`
protection.

```ts
import { storage } from "react-native-nitro-storage";

export function whenProtectedDataAvailable(run: () => void): () => void {
  let done = false;
  const runOnce = () => {
    if (done) return;
    done = true;
    unsubscribe();
    run();
  };
  const unsubscribe = storage.onProtectedDataAvailable(runOnce);
  if (storage.isProtectedDataAvailable()) runOnce();
  return unsubscribe;
}
```

Moving items to `AfterFirstUnlock` or `AfterFirstUnlockThisDeviceOnly` removes
the lock failure after the first unlock following a restart, but it weakens
protection: the items stay readable while the device is locked. Choose the
`ThisDeviceOnly` variant when items must not leave the device:

| Level                            | Readable while locked after first unlock | Included in backups and device transfer |
| -------------------------------- | ---------------------------------------- | --------------------------------------- |
| `WhenUnlocked`                   | No                                       | Yes                                     |
| `AfterFirstUnlock`               | Yes                                      | Yes                                     |
| `AfterFirstUnlockThisDeviceOnly` | Yes                                      | No                                      |

Items in a `ThisDeviceOnly` class are not restored onto a new device from a
backup or device transfer, so the user must sign in again there.

Raw `storage.getString(key, StorageScope.Secure)` has no
`fallbackToCacheOnReadError`. It throws `keychain_locked` while the Keychain is
locked. Only typed items created with `fallbackToCacheOnReadError: true` return
their last cached value for that error.

## Batch Operations

`getBatch()` preserves tuple value types, so IDEs infer each result from the
matching item. `setBatch()` validates every item/value pair independently,
including heterogeneous batches.
Missing keys use each item's `defaultValue`; the native bridge preserves missing
entries as `undefined` while reading the batch. With `readCache: true`, item and
batch reads reuse raw cache entries, including cached missing values, until a
write, delete, clear, or external change invalidates the entry.

```ts
import { getBatch, removeBatch, setBatch } from "react-native-nitro-storage";

const localeItem = createStorageItem({
  key: "locale",
  namespace: "settings",
  scope: StorageScope.Disk,
  defaultValue: "en-US",
});

const [theme, locale] = getBatch(
  [themeItem, localeItem] as const,
  StorageScope.Disk,
);

setBatch(
  [
    { item: themeItem, value: "dark" },
    { item: localeItem, value: "en-US" },
  ],
  StorageScope.Disk,
);

removeBatch([themeItem, localeItem], StorageScope.Disk);
```

## Events And Observability

```ts
const unsubscribe = storage.subscribeNamespace(
  "settings",
  StorageScope.Disk,
  (event) => {
    if (event.type === "key") {
      console.log(event.key, event.operation, event.source);
    } else {
      console.log(event.changes.length, event.operation, event.source);
    }
  },
);

storage.setEventObserver((event) => {
  console.log(event.type, event.scope);
});

storage.setMetricsObserver((event) => {
  console.log(event.operation, event.durationMs);
});

const metrics = storage.getMetricsSnapshot();
const scopedMetrics = storage.getScopedMetricsSnapshot();
const cacheMetrics = storage.getCacheMetrics();
storage.resetMetrics();
unsubscribe();
```

`getMetricsSnapshot()` aggregates each operation across scopes for backward
compatibility. `getScopedMetricsSnapshot()` adds the numeric scope suffix for
per-scope analysis, for example `item:set:1`. `getCacheMetrics()` reports live
Disk/Secure raw-cache hits, misses, entries, and estimated bytes. Reads fill
the cache only for items with `readCache` or `fallbackToCacheOnReadError`. The
cache is unbounded; `resetMetrics()` zeros the hit/miss counters and leaves
entries in place.

The example app includes hidden integrity, keychain, and Disk/Secure stress
labs at `nitrostorage://e2e-integrity`, `nitrostorage://e2e-keychain`, and
`nitrostorage://e2e-stress`.

Secure event observer values are redacted by default. Pass
`{ redactSecureValues: false }` only in trusted debug tooling where raw values
are safe to inspect.

TTL expiry emits a dedicated `"expire"` change event. Use
`storage.subscribeExpired()` to react to keys that lapse on read.

```ts
const unsubscribeExpired = storage.subscribeExpired(
  StorageScope.Disk,
  (event) => {
    console.log("expired", event.key);
  },
);
```

`storage.findDuplicateKeys()` and `storage.getRegisteredKeys()` help audit
accidental `(scope, key)` collisions; call them once at startup in development.

## Migrations And Transactions

```ts
import {
  migrateFromMMKV,
  migrateToLatest,
  registerMigration,
  runTransaction,
} from "react-native-nitro-storage";

registerMigration(2, ({ getRaw, setRaw, removeRaw }) => {
  const oldTheme = getRaw("legacyTheme");

  if (oldTheme) {
    setRaw("settings:theme", oldTheme);
    removeRaw("legacyTheme");
  }
});

migrateToLatest(StorageScope.Disk);

runTransaction(StorageScope.Disk, (tx) => {
  tx.setItem(themeItem, "dark");
  tx.setItem(localeItem, "en-US");
});

migrateFromMMKV(mmkvInstance, themeItem);
```

`runTransaction(scope, callback)` rolls back every write made through the `tx`
context if the callback throws, then emits one typed `rollback` batch event.
Callbacks must be synchronous. A Promise or thenable return throws a `TypeError`
and rolls back changes made through the context. Every context method becomes
unavailable when the callback ends, including for a continuation after `await`.
Complete asynchronous work before calling `runTransaction()` or registering a
migration; do not retain the context outside its callback.

Each migration step runs in its own transaction with its version marker, so a
failed step leaves the scope on the last completed version and rerunning
`migrateToLatest()` retries deterministically.
An asynchronous migration is rejected without advancing its version marker.

## Web Backends

```ts
import {
  setWebDiskStorageBackend,
  setWebSecureStorageBackend,
} from "react-native-nitro-storage";
import { createIndexedDBBackend } from "react-native-nitro-storage/indexeddb-backend";

const diskBackend = await createIndexedDBBackend("app-storage", "disk");
const secureBackend = await createIndexedDBBackend("app-storage", "secure");

setWebDiskStorageBackend(diskBackend);
setWebSecureStorageBackend(secureBackend);
```

Use one backend instance per scope. If one instance is registered for both
scopes, Disk enumeration skips Secure keys and each scope's `clear()` removes
only its own keys, but separate stores keep the two scopes fully isolated.
Import `createIndexedDBBackend` from the `react-native-nitro-storage/indexeddb-backend`
subpath; the root export is deprecated.

Web reads and mutations stay synchronous against the backend's in-memory
contract; use `flushWebStorageBackends()` for asynchronous persistence
boundaries. The native entry keeps the web backend setters, getters, and flush
function as typed no-ops for cross-platform code.

Browser storage cannot provide iOS Keychain or Android Keystore guarantees. Web
Secure scope is only as strong as the backend you configure.

Cross-tab `storage` events update a scope only while that scope uses the
default `localStorage` backend. Custom backends sync through their own
`subscribe()` channel; the IndexedDB backend uses a `BroadcastChannel`.

## Testing

The `react-native-nitro-storage/testing` entrypoint is an in-memory
implementation with the same runtime exports as the main entry, so unit tests
and Storybook run without native modules. Item subscribers and hooks re-render
for Memory, Disk, and Secure writes. It does not model platform behaviour:
there are no keychain locks, biometric prompts, access-control levels,
coalesced native write timing, or web backends (the web backend functions are
no-ops). Mock the package with it, or use it directly.

```ts
import {
  createNitroStorageMock,
  resetNitroStorageMock,
} from "react-native-nitro-storage/testing";

// Jest: swap the real module for the in-memory implementation.
jest.mock("react-native-nitro-storage", () =>
  require("react-native-nitro-storage/testing"),
);

beforeEach(() => {
  resetNitroStorageMock();
});

// Or build an isolated instance per test file.
const { storage, memoryItem } = createNitroStorageMock();
```

## API

The package exposes named `storage`, `createStorageItem`, the scoped item
factories, `createSetItem`, batch operations, migration and transaction helpers,
secure-auth storage, React hooks, and web backend utilities. Values are bound to
`Memory`, `Disk`, or `Secure` and support typed single-key operations, raw
inspection, events and observers, cache and write-flush controls, secure
metadata, transactional migrations with rename/rollback, and configurable web
backends. The full reference lives in
[docs/api-reference.md](docs/api-reference.md).

## Error Contract

Native and web adapters tag classified failures with stable error codes. Use
`getStorageErrorCode(error)` or `isStorageError(error, code)` to branch on them.
Errors never swallow the underlying cause silently: the original platform
message is preserved on the error for diagnostics.

| Code                          | Meaning                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keychain_locked`             | The protected store is locked. Retry after the device unlocks.                                                                                      |
| `authentication_required`     | The item needs user authentication, or the user cancelled the prompt.                                                                               |
| `key_invalidated`             | The protecting key was invalidated, for example by a biometric enrolment change.                                                                    |
| `biometric_unavailable`       | The requested biometric level is not available on this device or OS version.                                                                        |
| `storage_corruption`          | Stored secure data could not be decoded, the Disk database is corrupt, or (Android) the Secure master key or store cannot be created. Do not retry. |
| `storage_compensation_failed` | A multi-step write failed and restoring the previous state also failed.                                                                             |
| `unsupported`                 | The operation is not available on this platform or environment.                                                                                     |
| `storage_full`                | The device or database is out of space, or the web storage quota is exceeded. Free space before retrying.                                           |
| `invalid_key`                 | The storage key is empty. Keys must be non-empty strings.                                                                                           |

Invalid scopes and non-finite numeric levels are rejected with untagged errors
before they reach native storage.

A full device is an expected condition, not a bug. Disk writes and deletes both
fail with `storage_full` until the user frees space:

```ts
import {
  isStorageError,
  storage,
  StorageScope,
} from "react-native-nitro-storage";

function saveDraft(draft: string): "saved" | "storage_full" {
  try {
    storage.setString("draft", draft, StorageScope.Disk);
    return "saved";
  } catch (error) {
    if (!isStorageError(error, "storage_full")) throw error;
    return "storage_full";
  }
}
```

A full device does not block cleanup. `storage.clear(StorageScope.Disk)`
deletes and recreates the Disk database when a normal delete fails with
`storage_full`, which frees the space the database used. `remove` and
`removeBatch` can still fail with `storage_full`, because a delete also writes
to the database log.

A corrupt Disk database is never deleted automatically. Every Disk call fails
with `storage_corruption` until the app clears Disk storage:

```ts
import {
  isStorageError,
  storage,
  StorageScope,
} from "react-native-nitro-storage";

function readDraft(): string | undefined {
  try {
    return storage.getString("draft", StorageScope.Disk);
  } catch (error) {
    if (!isStorageError(error, "storage_corruption")) throw error;
    storage.clear(StorageScope.Disk);
    return undefined;
  }
}
```

`storage.clear(StorageScope.Disk)` and `storage.clearAll()` are the recovery
calls. `clear` with `except`, namespace clears, and `removeByPrefix` read keys
first and fail on a corrupt database. A `clear` batch event with an empty
`changes` array means every key in that scope was removed and the previous
values could not be read; treat all keys in the scope as deleted.

On Android, Disk values above 512 KiB are read in 512 KiB chunks, and read
time grows faster than value size (about 30 ms for 5 MiB and 265 ms for 20 MiB
in a host measurement; devices are slower). Keep single Disk values below about
5 MiB.

## Platform Support

| Platform               | Status                                             |
| ---------------------- | -------------------------------------------------- |
| iOS                    | Memory, Disk, and Keychain-backed Secure storage.  |
| Android                | Memory, Disk, and Keystore-backed Secure storage.  |
| Web                    | Memory plus configurable Disk and Secure backends. |
| Expo development build | Supported with the config plugin.                  |
| Expo Go                | Not supported for Nitro native modules.            |
| Windows, macOS, tvOS   | Not supported by this package.                     |

## Documentation

| Topic                               | File                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| API reference                       | [docs/api-reference.md](docs/api-reference.md)                                 |
| React hooks                         | [docs/react-hooks.md](docs/react-hooks.md)                                     |
| Secure storage                      | [docs/secure-storage.md](docs/secure-storage.md)                               |
| Web backends                        | [docs/web-backends.md](docs/web-backends.md)                                   |
| Batch, transactions, and migrations | [docs/batch-transactions-migrations.md](docs/batch-transactions-migrations.md) |
| MMKV migration                      | [docs/mmkv-migration.md](docs/mmkv-migration.md)                               |
| Native libraries                    | [docs/native-libraries.md](docs/native-libraries.md)                           |
| Recipes                             | [docs/recipes.md](docs/recipes.md)                                             |
| Benchmarks                          | [docs/benchmarks.md](docs/benchmarks.md)                                       |
| Example replay coverage             | [docs/qa/agent-device-replay.md](docs/qa/agent-device-replay.md)               |
| Security policy                     | [SECURITY.md](SECURITY.md)                                                     |

## Troubleshooting

- **Expo Go error:** build a development client; Expo Go cannot load Nitro
  modules.
- **Android not initialized:** rebuild the native app after installing or
  upgrading the package so the Android manifest initializer is merged.
- **Secure values fail after Android restore:** keep `configureAndroidBackup:
true` or provide equivalent backup exclusions.
- **Biometric prompt does not appear on Android:** this is expected. The
  package never prompts on Android; run `BiometricPrompt` in your app before
  reading the item, and enable `addBiometricPermissions` for that prompt. On
  iOS, set `biometric: true` on the item and a `faceIDPermission` message.
- **Web secure storage is unavailable:** configure a secure backend before using
  Secure scope on web.
- **TypeScript cannot infer `getBatch()` tuple values:** pass readonly tuples
  with `as const`, or keep batch items in a `const` tuple.

## Development

```sh
bun install
bun run check
bun run test:cpp:asan
bun run test:cpp:ubsan
bun run test:cpp:tsan
bun run release:preflight
bun run example:android
bun run example:ios
```

Run native example builds locally before release when changing plugin, native,
Nitro, secure storage, or packaging files. GitHub CI does not build the Android
or iOS example. The package release path also validates package contents and
dry-run publish behavior.

Run `bun run example:replay:check` to check that replay coverage matches package
and example sources. After reviewing affected assertions, use
`bun run example:replay:refresh` to update the source lock. Device execution uses
`bun run example:replay --platform ios --udid <exact-target>` or
`--platform android --serial <exact-target>`; see the
[replay guide](docs/qa/agent-device-replay.md) for prerequisites and coverage limits.

`bun run benchmark` measures only the built web entry with an isolated private
localStorage implementation; it is not a native Disk or Secure benchmark. See
[docs/benchmarks.md](docs/benchmarks.md) for sampling and interpretation limits.

## License

[MIT](LICENSE)
