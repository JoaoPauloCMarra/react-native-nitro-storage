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
bun add react-native-nitro-modules@0.37.1 react-native-nitro-storage@0.12.0
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
acceptable. After opting into async writes, call `storage.flushSecureWrites()`
before a deterministic persistence boundary. A failed secure flush throws and
keeps failed or unattempted queued writes available for retry.
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

Each migration step runs in its own transaction with its version marker, so a
failed step leaves the scope on the last completed version and rerunning
`migrateToLatest()` retries deterministically.

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

| Code                          | Meaning                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keychain_locked`             | The protected store is locked. Retry after the device unlocks.                                                                                        |
| `authentication_required`     | The item needs user authentication, or the user cancelled the prompt.                                                                                 |
| `key_invalidated`             | The protecting key was invalidated, for example by a biometric enrolment change.                                                                      |
| `biometric_unavailable`       | The requested biometric level is not available on this device or OS version.                                                                          |
| `storage_corruption`          | Stored secure data could not be decrypted, the Disk database is corrupt, or (Android) the Secure master key or store cannot be created. Do not retry. |
| `storage_compensation_failed` | A multi-step write failed and restoring the previous state also failed.                                                                               |
| `unsupported`                 | The operation is not available on this platform or environment.                                                                                       |
| `storage_full`                | The device or database is out of space, or the web storage quota is exceeded. Free space before retrying.                                             |
| `invalid_key`                 | The storage key is empty. Keys must be non-empty strings.                                                                                             |

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

`bun run benchmark` measures only the built web entry with an isolated private
localStorage implementation; it is not a native Disk or Secure benchmark. See
[docs/benchmarks.md](docs/benchmarks.md) for sampling and interpretation limits.

## License

[MIT](LICENSE)
