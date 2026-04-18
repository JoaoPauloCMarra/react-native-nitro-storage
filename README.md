# react-native-nitro-storage

[![npm](https://img.shields.io/npm/v/react-native-nitro-storage)](https://www.npmjs.com/package/react-native-nitro-storage)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![React Native](https://img.shields.io/badge/react--native-%3E%3D0.75-61dafb)](https://reactnative.dev/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.35.4-black)](https://nitro.margelo.com/)

One storage layer for render-time state, persisted app state, and native secrets.

Nitro Storage is a synchronous React Native storage library built on Nitro Modules and JSI. It exposes typed Memory, Disk, and Secure storage with React hooks, batch APIs, transactions, migrations, biometric access control, MMKV migration helpers, and a web IndexedDB backend.

Use it when you want one storage API for React Native and web, with fast synchronous reads and native secure storage instead of mixing AsyncStorage, SecureStore, Keychain wrappers, MMKV adapters, and custom React state glue.

## Contents

- [At a Glance](#at-a-glance)
- [Use It When](#use-it-when)
- [Why Nitro Storage](#why-nitro-storage)
- [Install](#install)
- [Quick Start](#quick-start)
- [Storage Scopes](#storage-scopes)
- [Docs](#docs)
- [Platform Support](#platform-support)
- [Security Model](#security-model)
- [Migration Paths](#migration-paths)
- [Choosing a Storage Library](#choosing-a-storage-library)
- [Production Checklist](#production-checklist)
- [Development](#development)

## At a Glance

| Need                              | API or feature                                                |
| --------------------------------- | ------------------------------------------------------------- |
| Read preferences during startup   | `createStorageItem` with `StorageScope.Disk`                  |
| Keep session-only state           | `StorageScope.Memory`                                         |
| Store auth tokens or secrets      | `StorageScope.Secure`                                         |
| Protect a value with biometrics   | `biometric: true` and `biometricLevel`                        |
| Bind storage to React             | `useStorage`, `useStorageSelector`, `useSetStorage`           |
| Bootstrap several values at once  | `getBatch`, `setBatch`, `removeBatch`                         |
| Roll back local writes on failure | `runTransaction`                                              |
| Upgrade local schemas             | `registerMigration` and `migrateToLatest`                     |
| Move existing MMKV data           | `migrateFromMMKV`                                             |
| Persist storage on web            | `setWebDiskStorageBackend` or `createIndexedDBBackend`        |
| Inspect secure backend state      | `getSecurityCapabilities`, `getSecureMetadata`, metadata APIs |

## Use It When

Nitro Storage is a good fit when your app needs synchronous local reads and a typed API across preferences, auth state, feature flags, and secrets. It is especially useful for startup gates, theme or locale preferences, persisted onboarding state, refresh tokens, biometric-protected values, and React state that should survive reloads.

Use a database or server-state cache instead when you need relational queries, conflict resolution, large collections, sync protocols, pagination, or cache invalidation from remote APIs.

## Why Nitro Storage

- Synchronous reads for startup state, render-time preferences, and auth boundaries.
- Typed `StorageItem<T>` values with custom serialization, validation, TTL, optimistic writes, and subscriptions.
- Three scopes: in-memory session state, persisted disk state, and platform secure storage.
- Secure storage backed by iOS Keychain and Android Keystore/EncryptedSharedPreferences.
- React hooks without providers: `useStorage`, `useStorageSelector`, and `useSetStorage`.
- Batch reads/writes, namespace cleanup, raw import/export, transactions, and migrations.
- Web parity with configurable Disk/Secure backends and an IndexedDB backend.
- MMKV migration helper for moving existing keys without rewriting app code first.

## Install

```sh
bun add react-native-nitro-storage react-native-nitro-modules
```

Use the equivalent command for npm, Yarn, or pnpm if your app does not use Bun.

For Expo projects, install the native packages, add the config plugin, and prebuild:

```sh
bunx expo install react-native-nitro-storage react-native-nitro-modules
```

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-nitro-storage",
        {
          "faceIDPermission": "Allow $(PRODUCT_NAME) to protect your secure data with Face ID",
          "addBiometricPermissions": true
        }
      ]
    ]
  }
}
```

```sh
bunx expo prebuild
```

The Expo plugin sets `NSFaceIDUsageDescription`, can opt into Android biometric permissions, and initializes the Android storage adapter in `MainApplication`.

Bare React Native projects should install pods after adding the package:

```sh
cd ios && pod install
```

Bare Android apps must initialize the adapter from `MainApplication` before using native storage:

```kt
import com.nitrostorage.AndroidStorageAdapter

override fun onCreate() {
  super.onCreate()
  AndroidStorageAdapter.init(this)
}
```

## Quick Start

Create storage items outside React render functions, then use them from anywhere.

```ts
import {
  createStorageItem,
  StorageScope,
  useStorage,
} from "react-native-nitro-storage";

type Theme = "system" | "light" | "dark";

export const themeItem = createStorageItem<Theme>({
  key: "theme",
  scope: StorageScope.Disk,
  defaultValue: "system",
  validate: (value): value is Theme =>
    value === "system" || value === "light" || value === "dark",
});

export function ThemeButton() {
  const [theme, setTheme] = useStorage(themeItem);

  return (
    <Button
      title={`Theme: ${theme}`}
      onPress={() => setTheme(theme === "dark" ? "light" : "dark")}
    />
  );
}
```

Secure values use the same item API:

```ts
import {
  AccessControl,
  BiometricLevel,
  createStorageItem,
  StorageScope,
} from "react-native-nitro-storage";

export const refreshTokenItem = createStorageItem<string>({
  key: "refreshToken",
  namespace: "auth",
  scope: StorageScope.Secure,
  defaultValue: "",
  biometric: true,
  biometricLevel: BiometricLevel.BiometryOrPasscode,
  accessControl: AccessControl.AfterFirstUnlockThisDeviceOnly,
});

refreshTokenItem.set("opaque-refresh-token");
```

Bootstrap several values in one synchronous call:

```ts
import { StorageScope, getBatch } from "react-native-nitro-storage";

const [theme] = getBatch([themeItem], StorageScope.Disk);
```

Keep multi-step local writes reversible:

```ts
import { StorageScope, runTransaction } from "react-native-nitro-storage";

runTransaction(StorageScope.Disk, (tx) => {
  tx.setItem(themeItem, "dark");
  tx.setRaw("onboarding:complete", "true");
});
```

## Storage Scopes

| Scope                 | Backing store                                                                 | Best for                                         |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| `StorageScope.Memory` | JS memory                                                                     | Session flags, wizard state, optimistic UI cache |
| `StorageScope.Disk`   | UserDefaults on iOS, SharedPreferences on Android, web Disk backend           | Preferences, feature flags, non-secret app state |
| `StorageScope.Secure` | iOS Keychain, Android Keystore/EncryptedSharedPreferences, web Secure backend | Tokens, credentials, device-bound secrets        |

Use Secure scope only for secrets. Disk scope is faster and easier to inspect, but it is not a secret store.

## Docs

| Task                                        | Start here                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| Learn the public API                        | [docs/api-reference.md](docs/api-reference.md)                                 |
| Bind storage to React                       | [docs/react-hooks.md](docs/react-hooks.md)                                     |
| Store tokens or biometric secrets           | [docs/secure-storage.md](docs/secure-storage.md)                               |
| Use batch APIs, transactions, or migrations | [docs/batch-transactions-migrations.md](docs/batch-transactions-migrations.md) |
| Configure web Disk/Secure storage           | [docs/web-backends.md](docs/web-backends.md)                                   |
| Migrate from `react-native-mmkv`            | [docs/mmkv-migration.md](docs/mmkv-migration.md)                               |
| Copy working snippets                       | [docs/recipes.md](docs/recipes.md)                                             |
| Run or interpret benchmarks                 | [docs/benchmarks.md](docs/benchmarks.md)                                       |
| Report a vulnerability                      | [SECURITY.md](SECURITY.md)                                                     |

## API Snapshot

```ts
import {
  AccessControl,
  BiometricLevel,
  StorageScope,
  createSecureAuthStorage,
  createStorageItem,
  flushWebStorageBackends,
  getBatch,
  getStorageErrorCode,
  isKeychainLockedError,
  migrateFromMMKV,
  migrateToLatest,
  registerMigration,
  removeBatch,
  runTransaction,
  setBatch,
  setWebDiskStorageBackend,
  setWebSecureStorageBackend,
  storage,
  useSetStorage,
  useStorage,
  useStorageSelector,
} from "react-native-nitro-storage";
```

The main building blocks are:

- `createStorageItem<T>(config)` for typed values.
- `storage` for raw reads, namespace cleanup, secure metadata, metrics, and runtime capability checks.
- `getBatch`, `setBatch`, and `removeBatch` for multi-key work.
- `runTransaction` for synchronous rollback on failure.
- `registerMigration` and `migrateToLatest` for versioned local data migrations.
- `createSecureAuthStorage` for a compact secure-token item map.
- `setWebDiskStorageBackend`, `setWebSecureStorageBackend`, and `createIndexedDBBackend` for web persistence.

See the full [API reference](docs/api-reference.md).

## Platform Support

| Platform | Status    | Notes                                                                                                  |
| -------- | --------- | ------------------------------------------------------------------------------------------------------ |
| iOS      | Supported | Disk uses app-suite `UserDefaults`; Secure uses Keychain.                                              |
| Android  | Supported | Disk uses SharedPreferences; Secure uses Keystore-backed EncryptedSharedPreferences.                   |
| Expo     | Supported | Add the included config plugin before prebuild.                                                        |
| Web      | Supported | Defaults to localStorage-style backends; IndexedDB backend is available for persistent Secure storage. |

Peer dependencies:

- `react >=18.2.0`
- `react-native >=0.75.0`
- `react-native-nitro-modules >=0.35.4`

## Security Model

Secure scope stores values in native secure storage on iOS and Android. Biometric items are stored through separate biometric paths and can require biometric or passcode access on each read.

```ts
const capabilities = storage.getSecurityCapabilities();
const metadata = storage.getSecureMetadata("auth:refreshToken");
```

Security metadata APIs never return stored values. They are intended for diagnostics, inventory screens, and support tooling that needs to understand which secure backend is active without exposing secrets.

Important boundaries:

- Disk and Memory scopes are not secret stores.
- Web Secure storage depends on the backend you configure; browser storage cannot provide iOS Keychain or Android Keystore guarantees.
- Hardware-backed secure storage is reported as `unknown` unless the platform can prove it through the native backend.
- Secret values should not be logged, exported in diagnostics, or copied into crash reports.

Read [docs/secure-storage.md](docs/secure-storage.md) and [SECURITY.md](SECURITY.md) before using Secure scope for production auth tokens.

## Migration Paths

From `react-native-mmkv`, migrate existing keys in place and keep your typed item API as the destination:

```ts
import { migrateFromMMKV } from "react-native-nitro-storage";

migrateFromMMKV(mmkv, themeItem, true);
migrateFromMMKV(mmkv, refreshTokenItem, true);
```

From `AsyncStorage`, `expo-secure-store`, Keychain wrappers, or a custom storage adapter, run a one-time startup migration: read the old value, validate it, write it through the matching `StorageItem`, then stop reading the old key after the migration ships broadly.

```ts
const oldTheme = await AsyncStorage.getItem("theme");

if (oldTheme === "light" || oldTheme === "dark" || oldTheme === "system") {
  themeItem.set(oldTheme);
  await AsyncStorage.removeItem("theme");
}
```

For versioned local data, keep migrations explicit and repeatable:

```ts
import {
  StorageScope,
  migrateToLatest,
  registerMigration,
} from "react-native-nitro-storage";

registerMigration(2, ({ getRaw, setRaw }) => {
  if (getRaw("theme") === "auto") {
    setRaw("theme", "system");
  }
});

migrateToLatest(StorageScope.Disk);
```

See [docs/mmkv-migration.md](docs/mmkv-migration.md) and [docs/batch-transactions-migrations.md](docs/batch-transactions-migrations.md) for the full flows.

## Choosing a Storage Library

| Need                                                            | Good fit                                    |
| --------------------------------------------------------------- | ------------------------------------------- |
| Fast synchronous typed state plus secure storage in one package | `react-native-nitro-storage`                |
| Existing MMKV-only app with no secure storage requirement       | `react-native-mmkv` can still be enough     |
| Async key/value persistence only                                | `@react-native-async-storage/async-storage` |
| Expo-only secure token storage with async calls                 | `expo-secure-store`                         |
| Keychain/Keystore credentials only                              | A focused Keychain wrapper may be simpler   |

Nitro Storage is strongest when the app needs synchronous reads, React bindings, typed values, secure storage, and migration utilities together. It is not trying to replace databases, query caches, or server-state libraries.

## Production Checklist

- Use `StorageScope.Secure` only for secrets and tokens.
- Keep secrets out of logs, exports, analytics, and crash reports.
- Test biometric and Keychain/Keystore flows on real iOS and Android devices.
- Configure a web Secure backend intentionally; browser storage does not provide native Keychain or Keystore guarantees.
- Run the full package gate before release:

```sh
bun run lint -- --filter=react-native-nitro-storage
bun run format:check -- --filter=react-native-nitro-storage
bun run typecheck -- --filter=react-native-nitro-storage
bun run test:types -- --filter=react-native-nitro-storage
bun run test -- --filter=react-native-nitro-storage
bun run test:cpp -- --filter=react-native-nitro-storage
bun run --cwd packages/react-native-nitro-storage check:pack
npm publish --dry-run
```

## Development

```sh
bun install
bun run lint -- --filter=react-native-nitro-storage
bun run format:check -- --filter=react-native-nitro-storage
bun run typecheck -- --filter=react-native-nitro-storage
bun run test:types -- --filter=react-native-nitro-storage
bun run test -- --filter=react-native-nitro-storage
bun run test:cpp -- --filter=react-native-nitro-storage
```

Release checks:

```sh
bun run build -- --filter=react-native-nitro-storage
bun run benchmark -- --filter=react-native-nitro-storage
bun run --cwd packages/react-native-nitro-storage check:pack
npm publish --dry-run
```

## License

MIT
