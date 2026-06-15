# react-native-nitro-storage

[![npm version](https://img.shields.io/npm/v/react-native-nitro-storage?color=f97316&label=npm)](https://www.npmjs.com/package/react-native-nitro-storage)
[![npm downloads](https://img.shields.io/npm/dm/react-native-nitro-storage?color=22c55e&label=downloads)](https://www.npmjs.com/package/react-native-nitro-storage)
[![CI](https://github.com/JoaoPauloCMarra/react-native-nitro-storage/actions/workflows/ci.yml/badge.svg)](https://github.com/JoaoPauloCMarra/react-native-nitro-storage/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-native-nitro-storage?color=007ec6)](https://github.com/JoaoPauloCMarra/react-native-nitro-storage/blob/main/LICENSE)
[![React Native](https://img.shields.io/badge/react--native-%3E%3D0.75-61dafb)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/expo-SDK%2056-000020)](https://docs.expo.dev/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.35.7-black)](https://nitro.margelo.com/)
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
- [Expo Config](#expo-config)
- [Quick Start](#quick-start)
- [Typed Storage Items](#typed-storage-items)
- [Item Ergonomics](#item-ergonomics)
- [Set Items](#set-items)
- [Groups And Lifecycle](#groups-and-lifecycle)
- [Legacy Key Migration And Secure Resilience](#legacy-key-migration-and-secure-resilience)
- [React Hooks](#react-hooks)
- [Storage Scopes](#storage-scopes)
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

Peer dependencies:

| Package                      | Version    |
| ---------------------------- | ---------- |
| `react`                      | `>=18.2.0` |
| `react-native`               | `>=0.75.0` |
| `react-native-nitro-modules` | `>=0.35.7` |

Nitro peer requirement: `react-native-nitro-modules >=0.35.7`.

For Expo development builds:

```sh
bunx expo install react-native-nitro-storage react-native-nitro-modules
bunx expo prebuild
```

Expo Go cannot load Nitro native modules. Use an Expo development build or a
bare React Native app.

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

| Option                    | Default                  | What it does                                                   |
| ------------------------- | ------------------------ | -------------------------------------------------------------- |
| `faceIDPermission`        | Built-in Face ID message | Sets `NSFaceIDUsageDescription`.                               |
| `addBiometricPermissions` | `false`                  | Adds Android biometric and fingerprint permissions.            |
| `configureAndroidBackup`  | `true`                   | Writes Android backup rules that exclude secure storage files. |

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
config.reset(); // back to the default value
const loginMethod = memoryItem<string | null>({
  key: "loginMethod",
  defaultValue: null,
});
loginMethod.setOrDelete(maybeMethod); // null/undefined deletes, value sets
```

## Set Items

`createSetItem()` models set-membership state (seen ids, dismissed prompts)
without hand-rolling `Record<string, true>` helpers. Adding an existing member
or deleting an absent one is a no-op, so subscribers do not re-render.

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
legacy entry. Secure items can fall back to the last cached value when the
keychain is locked instead of throwing.

```ts
import {
  secureItem,
  createSecureAuthStorage,
} from "react-native-nitro-storage";

const accessToken = secureItem<string>({
  key: "accessToken",
  namespace: "auth",
  defaultValue: "",
  renameFrom: "authToken", // copied + cleaned up on first read
  fallbackToCacheOnReadError: true,
  onReadError: (error) => reportSecureReadError(error),
});

const auth = createSecureAuthStorage(
  {
    accessToken: { renameFrom: "authToken" },
    refreshToken: { renameFrom: "refreshToken" },
  },
  { namespace: "auth", group: "session", fallbackToCacheOnReadError: true },
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

| Scope                 | Backing store                                          | Use it for                                                                   |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `StorageScope.Memory` | In-process memory                                      | Session-only state, fast counters, and render-time caches.                   |
| `StorageScope.Disk`   | UserDefaults on iOS, SharedPreferences on Android, web | Preferences, feature flags, onboarding state, and non-secret persisted data. |
| `StorageScope.Secure` | Keychain on iOS, Android Keystore-backed preferences   | Refresh tokens, credentials, API tokens, and biometric-protected values.     |

## Secure Storage

```ts
import {
  AccessControl,
  BiometricLevel,
  StorageScope,
  createSecureAuthStorage,
  createStorageItem,
  isKeychainLockedError,
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
  if (isKeychainLockedError(error)) {
    storage.getSecurityCapabilities();
  }
}
```

Secure scope uses iOS Keychain and Android Keystore-backed
EncryptedSharedPreferences. Keep secure values small, do not log them, and avoid
exporting secure values unless you are intentionally doing a short-lived
in-memory migration. `storage.export(StorageScope.Secure)` throws unless you
explicitly opt into `{ includeSecureValues: true }`.

## Batch Operations

`getBatch()` preserves tuple value types, so IDEs infer each result from the
matching item.

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
const unsubscribe = storage.subscribeNamespace("settings", (event) => {
  console.log(event.key, event.operation, event.source);
});

storage.setEventObserver((event) => {
  console.log(event.type, event.scope);
});

storage.setMetricsObserver((event) => {
  console.log(event.operation, event.durationMs);
});

const metrics = storage.getMetricsSnapshot();
storage.resetMetrics();
unsubscribe();
```

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
context if the callback throws.

## Web Backends

```ts
import {
  setWebDiskStorageBackend,
  setWebSecureStorageBackend,
} from "react-native-nitro-storage";
import { createIndexedDBBackend } from "react-native-nitro-storage/indexeddb-backend";

const backend = await createIndexedDBBackend({
  dbName: "app-storage",
  storeName: "kv",
});

setWebDiskStorageBackend(backend);
setWebSecureStorageBackend(backend);
```

Browser storage cannot provide iOS Keychain or Android Keystore guarantees. Web
Secure scope is only as strong as the backend you configure.

## Testing

The `react-native-nitro-storage/testing` entrypoint is a faithful in-memory
implementation of the full public surface, so unit tests and Storybook run
without native modules. Mock the package with it, or use it directly.

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

## Platform Support

| Platform | Status                                             |
| -------- | -------------------------------------------------- |
| iOS      | Memory, Disk, and Keychain-backed Secure storage.  |
| Android  | Memory, Disk, and Keystore-backed Secure storage.  |
| Web      | Memory plus configurable Disk and Secure backends. |
| Expo     | Development builds with the config plugin.         |

## Documentation

| Topic                               | File                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| API reference                       | [docs/api-reference.md](docs/api-reference.md)                                 |
| React hooks                         | [docs/react-hooks.md](docs/react-hooks.md)                                     |
| Secure storage                      | [docs/secure-storage.md](docs/secure-storage.md)                               |
| Web backends                        | [docs/web-backends.md](docs/web-backends.md)                                   |
| Batch, transactions, and migrations | [docs/batch-transactions-migrations.md](docs/batch-transactions-migrations.md) |
| MMKV migration                      | [docs/mmkv-migration.md](docs/mmkv-migration.md)                               |
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
- **Biometric prompt does not appear:** set `biometric: true` on the item and
  add native biometric permissions when your app needs them.
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

Run native example builds before release when changing plugin, native, Nitro,
secure storage, or packaging files. The package release path also validates
package contents and dry-run publish behavior.

## License

[MIT](LICENSE)
