# react-native-nitro-storage

[![npm version](https://img.shields.io/npm/v/react-native-nitro-storage?color=f97316&label=npm)](https://www.npmjs.com/package/react-native-nitro-storage)
[![license](https://img.shields.io/npm/l/react-native-nitro-storage?color=007ec6)](https://github.com/JoaoPauloCMarra/react-native-nitro-storage/blob/main/LICENSE)
[![React Native](https://img.shields.io/badge/react--native-%3E%3D0.75-61dafb)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/expo-SDK%2056-000020)](https://expo.dev/)
[![Nitro Modules](https://img.shields.io/badge/nitro--modules-%3E%3D0.35.7-black)](https://nitro.margelo.com/)

Synchronous Memory, Disk, and Secure storage for React Native, Expo, and web,
powered by Nitro Modules.

Use it for startup state, preferences, feature flags, local auth state, secure
tokens, biometric-protected values, migrations, transactions, batch operations,
React hooks, and web backends from one typed API.

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

Nitro peer: react-native-nitro-modules >=0.35.7.

For Expo development builds:

```sh
bunx expo install react-native-nitro-storage react-native-nitro-modules
bunx expo prebuild
```

Expo Go cannot load Nitro native modules. Use an Expo development build or a
bare app.

## Expo Config

Add the plugin before prebuilding native iOS and Android apps:

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

Plugin options:

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

## React Hooks

```tsx
import { useSetStorage, useStorage } from "react-native-nitro-storage";

export function ThemeToggle() {
  const theme = useStorage(themeItem);
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

## Storage Scopes

| Scope                 | Use it for                                                                   |
| --------------------- | ---------------------------------------------------------------------------- |
| `StorageScope.Memory` | Session-only state and render-time caches.                                   |
| `StorageScope.Disk`   | Preferences, feature flags, onboarding state, and non-secret persisted data. |
| `StorageScope.Secure` | Refresh tokens, credentials, API tokens, and biometric-protected values.     |

Use a database or server-state cache instead for relational queries, sync,
pagination, conflict resolution, or large collections.

## Secure Storage

```ts
import {
  AccessControl,
  BiometricLevel,
  StorageScope,
  createStorageItem,
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
```

Secure scope uses iOS Keychain and Android Keystore-backed
EncryptedSharedPreferences. Keep values small, do not log them, and avoid
exporting secure values unless you are intentionally doing an in-memory
round-trip.

## Batch, Events, And Export

```ts
import {
  getBatch,
  removeBatch,
  setBatch,
  storage,
} from "react-native-nitro-storage";

const [theme, locale] = getBatch([themeItem, localeItem]);

setBatch([
  [themeItem, "dark"],
  [localeItem, "en-US"],
]);

const unsubscribe = storage.subscribeNamespace("settings", (event) => {
  console.log(event.key, event.newValue);
});

const snapshot = storage.export(StorageScope.Disk);
storage.import(snapshot, StorageScope.Disk);

removeBatch([themeItem, localeItem]);
unsubscribe();
```

`storage.export(StorageScope.Secure)` throws unless you explicitly opt into
including secure values.

## Migrations And Transactions

```ts
import {
  migrateToLatest,
  registerMigration,
  runTransaction,
} from "react-native-nitro-storage";

registerMigration(2, ({ getString, setString }) => {
  const oldValue = getString("legacyTheme", StorageScope.Disk);
  if (oldValue) {
    setString("settings:theme", oldValue, StorageScope.Disk);
  }
});

migrateToLatest(2);

runTransaction(() => {
  themeItem.set("dark");
  localeItem.set("en-US");
});
```

Transactions roll back local writes if the callback throws.

## Web Backends

```ts
import {
  setWebDiskStorageBackend,
  setWebSecureStorageBackend,
} from "react-native-nitro-storage";
import { createIndexedDBBackend } from "react-native-nitro-storage/indexeddb-backend";

const backend = await createIndexedDBBackend();

setWebDiskStorageBackend(backend);
setWebSecureStorageBackend(backend);
```

Browser storage cannot provide iOS Keychain or Android Keystore guarantees. Web
Secure scope is only as strong as the backend you configure.

## API

Main exports:

- `storage` raw API for strings, booleans, numbers, batches, namespaces,
  import/export, events, secure metadata, and diagnostics.
- `createStorageItem`.
- `useStorage`, `useStorageSelector`, and `useSetStorage`.
- `getBatch`, `setBatch`, and `removeBatch`.
- `runTransaction`, `registerMigration`, and `migrateToLatest`.
- `migrateFromMMKV`.
- `createSecureAuthStorage`.
- `setWebDiskStorageBackend`, `setWebSecureStorageBackend`,
  `flushWebStorageBackends`, and `createIndexedDBBackend`.
- `StorageScope`, `AccessControl`, `BiometricLevel`, and public TypeScript
  types.

## Platform Support

| Platform | Status                                             |
| -------- | -------------------------------------------------- |
| iOS      | Memory, Disk, and Keychain-backed Secure storage.  |
| Android  | Memory, Disk, and Keystore-backed Secure storage.  |
| Web      | Memory plus configurable Disk and Secure backends. |
| Expo     | Development builds with the config plugin.         |

## Troubleshooting

- **Expo Go error:** build a dev client; Expo Go cannot load Nitro modules.
- **Secure values fail after Android restore:** keep `configureAndroidBackup:
true` or provide equivalent backup exclusions.
- **Biometric prompt does not appear:** set `biometric: true` on the item and
  add native biometric permissions when your app needs them.
- **Web secure storage is unavailable:** configure a secure backend before using
  Secure scope on web.

## Development

```sh
bun install
bun run check
bun run release:preflight
bun run example:android
bun run example:ios
```

Run native example builds before release when changing plugin, native, Nitro,
secure storage, or packaging files.

## License

MIT
