# react-native-nitro-storage

The fastest, most complete storage solution for React Native.
Synchronous Memory, Disk, and Secure storage in one unified API — powered by [Nitro Modules](https://github.com/mrousavy/nitro) and JSI.

## Highlights

- **Three storage scopes** — in-memory, persistent disk, and hardware-encrypted secure storage
- **Synchronous reads & writes** — no `async/await`, no bridge, zero serialization overhead for primitives
- **React hooks** — `useStorage`, `useStorageSelector`, `useSetStorage` with automatic re-renders
- **Type-safe** — full TypeScript generics, custom serializers, schema validation with fallback
- **Namespaces** — isolate keys by feature, user, or tenant with automatic prefixing
- **TTL expiration** — time-based auto-expiry with optional `onExpired` callback
- **Biometric storage** — hardware-backed biometric protection on iOS & Android
- **Auth storage factory** — `createSecureAuthStorage` for multi-token auth flows
- **Batch operations** — atomic multi-key get/set/remove via native batch APIs
- **Transactions** — grouped writes with automatic rollback on error
- **Migrations** — versioned data migrations with `registerMigration` / `migrateToLatest`
- **MMKV migration** — drop-in `migrateFromMMKV` for painless migration from MMKV
- **Cross-platform** — iOS, Android, and web (`localStorage` fallback)

## Requirements

| Dependency                   | Version     |
| ---------------------------- | ----------- |
| `react-native`               | `>= 0.75.0` |
| `react-native-nitro-modules` | `>= 0.33.9` |
| `react`                      | `>= 18.2.0` |

## Installation

```bash
bun add react-native-nitro-storage react-native-nitro-modules
```

or:

```bash
npm install react-native-nitro-storage react-native-nitro-modules
```

### Expo

```bash
bunx expo install react-native-nitro-storage react-native-nitro-modules
```

Add the config plugin to `app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "react-native-nitro-storage",
        {
          "faceIDPermission": "Allow $(PRODUCT_NAME) to use Face ID for secure authentication",
          "addBiometricPermissions": false
        }
      ]
    ]
  }
}
```

> `faceIDPermission` sets `NSFaceIDUsageDescription` only when missing. Android biometric permissions are opt-in via `addBiometricPermissions: true`.

Then run:

```bash
bunx expo prebuild
```

### Bare React Native

**iOS:**

```bash
cd ios && pod install
```

**Android** — initialize the native adapter in `MainApplication.kt`:

```kotlin
import com.nitrostorage.AndroidStorageAdapter

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    AndroidStorageAdapter.init(this)
  }
}
```

---

## Quick Start

```ts
import { createStorageItem, StorageScope, useStorage } from "react-native-nitro-storage";

// define a storage item outside of components
const counterItem = createStorageItem({
  key: "counter",
  scope: StorageScope.Memory,
  defaultValue: 0,
});

export function Counter() {
  const [count, setCount] = useStorage(counterItem);

  return (
    <Button
      title={`Count: ${count}`}
      onPress={() => setCount((prev) => prev + 1)}
    />
  );
}
```

---

## Storage Scopes

| Scope    | Backend (iOS)            | Backend (Android)          | Backend (Web)                                    | Persisted |
| -------- | ------------------------ | -------------------------- | ------------------------------------------------ | --------- |
| `Memory` | In-process JS Map        | In-process JS Map          | In-process JS Map                                | No        |
| `Disk`   | UserDefaults (app suite) | SharedPreferences          | `localStorage`                                   | Yes       |
| `Secure` | Keychain (AES-256 GCM)   | EncryptedSharedPreferences | `localStorage` (`__secure_` + `__bio_` prefixes) | Yes       |

```ts
import { StorageScope } from "react-native-nitro-storage";

StorageScope.Memory; // 0 — ephemeral, fastest
StorageScope.Disk; // 1 — persistent, fast
StorageScope.Secure; // 2 — encrypted, slightly slower
```

---

## API Reference

### `createStorageItem<T>(config)`

The core factory. Creates a reactive storage item that can be used standalone or with hooks.

```ts
function createStorageItem<T = undefined>(
  config: StorageItemConfig<T>,
): StorageItem<T>;
```

**Config options:**

| Property               | Type                             | Default        | Description                                                    |
| ---------------------- | -------------------------------- | -------------- | -------------------------------------------------------------- |
| `key`                  | `string`                         | _required_     | Storage key identifier                                         |
| `scope`                | `StorageScope`                   | _required_     | Where to store the data                                        |
| `defaultValue`         | `T`                              | `undefined`    | Value returned when no data exists                             |
| `serialize`            | `(value: T) => string`           | JSON fast path | Custom serialization                                           |
| `deserialize`          | `(value: string) => T`           | JSON fast path | Custom deserialization                                         |
| `validate`             | `(value: unknown) => value is T` | —              | Type guard run on every read                                   |
| `onValidationError`    | `(invalidValue: unknown) => T`   | —              | Recovery function when validation fails                        |
| `expiration`           | `{ ttlMs: number }`              | —              | Time-to-live in milliseconds                                   |
| `onExpired`            | `(key: string) => void`          | —              | Callback fired when a TTL value expires on read                |
| `readCache`            | `boolean`                        | `false`        | Cache deserialized values in JS (avoids repeated native reads) |
| `coalesceSecureWrites` | `boolean`                        | `false`        | Batch same-tick Secure writes per key                          |
| `namespace`            | `string`                         | —              | Prefix key as `namespace:key` for isolation                    |
| `biometric`            | `boolean`                        | `false`        | Require biometric auth (Secure scope only)                     |
| `accessControl`        | `AccessControl`                  | —              | Keychain access control level (native only)                    |

**Returned `StorageItem<T>`:**

| Method / Property | Type                                     | Description                                        |
| ----------------- | ---------------------------------------- | -------------------------------------------------- |
| `get()`           | `() => T`                                | Read current value (synchronous)                   |
| `set(value)`      | `(value: T \| ((prev: T) => T)) => void` | Write a value or updater function                  |
| `delete()`        | `() => void`                             | Remove the stored value (resets to `defaultValue`) |
| `has()`           | `() => boolean`                          | Check if a value exists in storage                 |
| `subscribe(cb)`   | `(cb: () => void) => () => void`         | Listen for changes, returns unsubscribe            |
| `serialize`       | `(v: T) => string`                       | The item's serializer                              |
| `deserialize`     | `(v: string) => T`                       | The item's deserializer                            |
| `scope`           | `StorageScope`                           | The item's scope                                   |
| `key`             | `string`                                 | The resolved key (includes namespace prefix)       |

---

### React Hooks

#### `useStorage(item)`

Full reactive binding. Re-renders when the value changes.

```ts
const [value, setValue] = useStorage(item);
```

#### `useStorageSelector(item, selector, isEqual?)`

Subscribe to a derived slice. Only re-renders when the selected value changes.

```ts
const [theme, setSettings] = useStorageSelector(settingsItem, (s) => s.theme);
```

#### `useSetStorage(item)`

Write-only hook. Useful when a component needs to update a value but doesn't depend on it.

```ts
const setToken = useSetStorage(tokenItem);
setToken("new-token");
```

---

### `storage` — Global Utilities

```ts
import { storage, StorageScope } from "react-native-nitro-storage";
```

| Method                                  | Description                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `storage.clear(scope)`                  | Clear all keys in a scope (`Secure` also clears biometric entries)           |
| `storage.clearAll()`                    | Clear Memory + Disk + Secure                                                 |
| `storage.clearNamespace(ns, scope)`     | Remove only keys matching a namespace                                        |
| `storage.clearBiometric()`              | Remove all biometric-prefixed keys                                           |
| `storage.has(key, scope)`               | Check if a key exists                                                        |
| `storage.getAllKeys(scope)`             | Get all key names                                                            |
| `storage.getAll(scope)`                 | Get all key-value pairs as `Record<string, string>`                          |
| `storage.size(scope)`                   | Number of stored keys                                                        |
| `storage.setAccessControl(level)`       | Set default secure access control for subsequent secure writes (native only) |
| `storage.setKeychainAccessGroup(group)` | Set keychain access group for app sharing (native only)                      |

> `storage.getAll(StorageScope.Secure)` returns regular secure entries. Biometric-protected values are not included in this snapshot API.

---

### `createSecureAuthStorage<K>(config, options?)`

One-liner factory for authentication flows. Creates multiple `StorageItem<string>` entries in Secure scope.

```ts
function createSecureAuthStorage<K extends string>(
  config: SecureAuthStorageConfig<K>,
  options?: { namespace?: string },
): Record<K, StorageItem<string>>;
```

- Default namespace: `"auth"`
- Each key is a separate `StorageItem<string>` with `StorageScope.Secure`
- Supports per-key TTL, biometric, and access control

---

### Batch Operations

Atomic multi-key operations. Uses native batch APIs for best performance.

```ts
import { getBatch, setBatch, removeBatch } from "react-native-nitro-storage";

// Read multiple items at once
const [a, b, c] = getBatch([itemA, itemB, itemC], StorageScope.Disk);

// Write multiple items atomically
setBatch(
  [
    { item: itemA, value: "hello" },
    { item: itemB, value: "world" },
  ],
  StorageScope.Disk,
);

// Remove multiple items
removeBatch([itemA, itemB], StorageScope.Disk);
```

> All items in a batch must share the same scope. Items with `validate` or `expiration` automatically use per-item paths to preserve semantics.

---

### Transactions

Grouped writes with automatic rollback on error.

```ts
import { runTransaction, StorageScope } from "react-native-nitro-storage";

runTransaction(StorageScope.Disk, (tx) => {
  const balance = tx.getItem(balanceItem);
  tx.setItem(balanceItem, balance - 50);
  tx.setItem(logItem, `Deducted 50 at ${new Date().toISOString()}`);

  if (balance - 50 < 0) throw new Error("Insufficient funds");
  // if this throws, both writes are rolled back
});
```

**TransactionContext methods:**

| Method                 | Description                 |
| ---------------------- | --------------------------- |
| `getItem(item)`        | Read a StorageItem's value  |
| `setItem(item, value)` | Write a StorageItem's value |
| `removeItem(item)`     | Delete a StorageItem        |
| `getRaw(key)`          | Read raw string by key      |
| `setRaw(key, value)`   | Write raw string by key     |
| `removeRaw(key)`       | Delete raw key              |

---

### Migrations

Versioned, sequential data migrations.

```ts
import {
  registerMigration,
  migrateToLatest,
  StorageScope,
} from "react-native-nitro-storage";

registerMigration(1, ({ setRaw }) => {
  setRaw("onboarding-complete", "false");
});

registerMigration(2, ({ getRaw, setRaw, removeRaw }) => {
  const raw = getRaw("legacy-key");
  if (raw) {
    setRaw("new-key", raw);
    removeRaw("legacy-key");
  }
});

// apply all pending migrations (runs once per scope)
migrateToLatest(StorageScope.Disk);
```

- Versions must be positive integers, registered in any order, applied ascending
- Version state is tracked per scope via `__nitro_storage_migration_version__`
- Duplicate versions throw at registration time

---

### MMKV Migration

Drop-in helper for migrating from `react-native-mmkv`.

```ts
import { migrateFromMMKV } from "react-native-nitro-storage";
import { MMKV } from "react-native-mmkv";

const mmkv = new MMKV();

const migrated = migrateFromMMKV(mmkv, myStorageItem, true);
// true  → value found and copied, original deleted from MMKV
// false → no matching key in MMKV
```

- Read priority: `getString` → `getNumber` → `getBoolean`
- Uses `item.set()` so validation still applies
- Only deletes from MMKV when migration succeeds

---

### Enums

#### `AccessControl`

Controls keychain item access requirements (iOS Keychain / Android Keystore). No-op on web.

```ts
enum AccessControl {
  WhenUnlocked = 0,
  AfterFirstUnlock = 1,
  WhenPasscodeSetThisDeviceOnly = 2,
  WhenUnlockedThisDeviceOnly = 3,
  AfterFirstUnlockThisDeviceOnly = 4,
}
```

#### `BiometricLevel`

```ts
enum BiometricLevel {
  None = 0,
  BiometryOrPasscode = 1,
  BiometryOnly = 2,
}
```

---

## Use Cases

### Persisted User Preferences

```ts
interface UserPreferences {
  theme: "light" | "dark" | "system";
  language: string;
  notifications: boolean;
}

const prefsItem = createStorageItem<UserPreferences>({
  key: "prefs",
  scope: StorageScope.Disk,
  defaultValue: { theme: "system", language: "en", notifications: true },
});

// in a component — only re-renders when theme changes
const [theme, setPrefs] = useStorageSelector(prefsItem, (p) => p.theme);
```

### Auth Token Management

```ts
const auth = createSecureAuthStorage(
  {
    accessToken: { ttlMs: 15 * 60_000, biometric: true },
    refreshToken: { ttlMs: 7 * 24 * 60 * 60_000 },
    idToken: {},
  },
  { namespace: "myapp-auth" },
);

// after login
auth.accessToken.set(response.accessToken);
auth.refreshToken.set(response.refreshToken);
auth.idToken.set(response.idToken);

// check if token exists and hasn't expired
if (auth.accessToken.has()) {
  const token = auth.accessToken.get();
  // use token
} else {
  // refresh or re-login
}

// logout
storage.clearNamespace("myapp-auth", StorageScope.Secure);
```

### Feature Flags with Validation

```ts
interface FeatureFlags {
  darkMode: boolean;
  betaFeature: boolean;
  maxUploadMb: number;
}

const flagsItem = createStorageItem<FeatureFlags>({
  key: "feature-flags",
  scope: StorageScope.Disk,
  defaultValue: { darkMode: false, betaFeature: false, maxUploadMb: 10 },
  validate: (v): v is FeatureFlags =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as any).darkMode === "boolean" &&
    typeof (v as any).maxUploadMb === "number",
  onValidationError: () => ({
    darkMode: false,
    betaFeature: false,
    maxUploadMb: 10,
  }),
  expiration: { ttlMs: 60 * 60_000 }, // refresh from server every hour
  onExpired: () => fetchAndStoreFlags(),
});
```

### Multi-Tenant / Namespaced Storage

```ts
function createUserStorage(userId: string) {
  return {
    cart: createStorageItem<string[]>({
      key: "cart",
      scope: StorageScope.Disk,
      defaultValue: [],
      namespace: `user-${userId}`,
    }),
    draft: createStorageItem<string>({
      key: "draft",
      scope: StorageScope.Disk,
      defaultValue: "",
      namespace: `user-${userId}`,
    }),
  };
}

// clear all data for a specific user
storage.clearNamespace("user-123", StorageScope.Disk);
```

### OTP / Temporary Codes

```ts
const otpItem = createStorageItem<string>({
  key: "otp-code",
  scope: StorageScope.Secure,
  defaultValue: "",
  expiration: { ttlMs: 5 * 60_000 }, // 5 minutes
  onExpired: (key) => {
    console.log(`${key} expired — prompt user to request a new code`);
  },
});

// store the code
otpItem.set("482917");

// later — returns "" if expired
const code = otpItem.get();
```

### Atomic Balance Transfer

```ts
const fromBalance = createStorageItem({
  key: "from",
  scope: StorageScope.Disk,
  defaultValue: 100,
});
const toBalance = createStorageItem({
  key: "to",
  scope: StorageScope.Disk,
  defaultValue: 0,
});

function transfer(amount: number) {
  runTransaction(StorageScope.Disk, (tx) => {
    const from = tx.getItem(fromBalance);
    if (from < amount) throw new Error("Insufficient funds");

    tx.setItem(fromBalance, from - amount);
    tx.setItem(toBalance, tx.getItem(toBalance) + amount);
  });
}
```

### Custom Binary Codec

```ts
const compactItem = createStorageItem<{ id: number; active: boolean }>({
  key: "compact",
  scope: StorageScope.Disk,
  defaultValue: { id: 0, active: false },
  serialize: (v) => `${v.id}|${v.active ? "1" : "0"}`,
  deserialize: (v) => {
    const [id, flag] = v.split("|");
    return { id: Number(id), active: flag === "1" };
  },
});
```

### Migrating From MMKV

```ts
import { MMKV } from "react-native-mmkv";

const mmkv = new MMKV();

const usernameItem = createStorageItem({
  key: "username",
  scope: StorageScope.Disk,
  defaultValue: "",
});

// run once at app startup
migrateFromMMKV(mmkv, usernameItem, true); // true = delete from MMKV after
```

---

## Exported Types

```ts
import type {
  Storage,
  StorageItemConfig,
  StorageItem,
  StorageBatchSetItem,
  Validator,
  ExpirationConfig,
  MigrationContext,
  Migration,
  TransactionContext,
  MMKVLike,
  SecureAuthStorageConfig,
} from "react-native-nitro-storage";
```

---

## Dev Commands

From repository root:

```bash
bun run test -- --filter=react-native-nitro-storage
bun run typecheck -- --filter=react-native-nitro-storage
bun run build -- --filter=react-native-nitro-storage
```

Inside `packages/react-native-nitro-storage`:

```bash
bun run test            # run tests
bun run test:coverage   # run tests with coverage
bun run lint            # eslint (expo-magic rules)
bun run format:check    # prettier check
bun run typecheck       # tsc --noEmit
bun run build           # tsup build
bun run benchmark       # performance benchmarks
```

## License

MIT
