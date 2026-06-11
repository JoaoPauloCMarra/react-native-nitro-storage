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
- [React Hooks](#react-hooks)
- [Storage Scopes](#storage-scopes)
- [Secure Storage](#secure-storage)
- [Batch Operations](#batch-operations)
- [Events And Observability](#events-and-observability)
- [Migrations And Transactions](#migrations-and-transactions)
- [Web Backends](#web-backends)
- [Platform Support](#platform-support)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

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

The plugin also initializes the Android storage adapter in `MainApplication`.
Set `configureAndroidBackup: false` only when your app maintains equivalent
backup and device-transfer exclusions for Nitro Storage secure files.

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

The package exports `StorageItem`, `StorageItemConfig`, `StorageSetter`,
`VersionedValue`, `StorageBatchSetItem`, web backend types, event types, secure
metadata types, and capability types for IDE-safe integrations.

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

runTransaction(() => {
  themeItem.set("dark");
  localeItem.set("en-US");
});

migrateFromMMKV(mmkvInstance, themeItem);
```

Transactions roll back local writes if the callback throws.

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
