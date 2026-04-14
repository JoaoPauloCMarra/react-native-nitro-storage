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
- **Prefix queries** — fast key/value scans with `storage.getKeysByPrefix` and `storage.getByPrefix`
- **Versioned writes** — optimistic concurrency with `item.getWithVersion()` and `item.setIfVersion(...)`
- **Performance metrics** — observe operation timings and aggregate snapshots
- **Web secure backend override** — plug custom secure storage backend on web
- **IndexedDB backend** — drop-in `createIndexedDBBackend` factory for persistent web Secure storage with large payloads
- **Bulk import** — load a raw `Record<string, string>` into any scope atomically with `storage.import`
- **Transactions** — grouped writes with automatic rollback on error
- **Migrations** — versioned data migrations with `registerMigration` / `migrateToLatest`
- **MMKV migration** — drop-in `migrateFromMMKV` for painless migration from MMKV
- **Cross-platform** — iOS, Android, and web (`localStorage` fallback)

## Feature Coverage

Every feature in this package is documented with at least one runnable example in this README:

- Core item API (`createStorageItem`, `get/set/delete/has/subscribe`) — see Quick Start and Low-level subscription use case
- Hooks (`useStorage`, `useStorageSelector`, `useSetStorage`) — see Quick Start and Persisted User Preferences
- Scopes (`Memory`, `Disk`, `Secure`) — see Storage Scopes and multiple use cases
- Namespaces — see Multi-Tenant / Namespaced Storage
- TTL expiration + callbacks — see OTP / Temporary Codes
- Validation + recovery — see Feature Flags with Validation
- Biometric + access control — see Biometric-protected Secrets
- Global storage utilities (`clear*`, `has`, `getAll*`, `size`, secure write settings) — see Global utility examples and Storage Snapshots and Cleanup
- Prefix utilities (`getKeysByPrefix`, `getByPrefix`) — see Prefix Queries and Namespace Inspection
- Versioned item API (`getWithVersion`, `setIfVersion`) — see Optimistic Versioned Writes
- Metrics API (`setMetricsObserver`, `getMetricsSnapshot`, `resetMetrics`) — see Storage Metrics Instrumentation
- Runtime capability introspection (`storage.getCapabilities()`) — see Global utility examples
- Structured storage error codes (`getStorageErrorCode`, `isKeychainLockedError`) — see Error Classification
- Web disk backend override (`setWebDiskStorageBackend`, `getWebDiskStorageBackend`) — see Custom Web Disk and Secure Backends
- Web secure backend override (`setWebSecureStorageBackend`, `getWebSecureStorageBackend`) — see Custom Web Secure Backend
- Web backend durability (`flushWebStorageBackends`) — see Custom Web Disk and Secure Backends
- IndexedDB backend factory (`createIndexedDBBackend`) — see IndexedDB Backend for Web
- Bulk import (`storage.import`) — see Bulk Data Import
- Batch APIs (`getBatch`, `setBatch`, `removeBatch`) — see Batch Operations and Bulk Bootstrap with Batch APIs
- Transactions — see Transactions and Atomic Balance Transfer
- Migrations (`registerMigration`, `migrateToLatest`) — see Migrations
- MMKV migration (`migrateFromMMKV`) — see MMKV Migration and Migrating From MMKV
- Raw string API (`getString`, `setString`, `deleteString`) — see Raw String API
- Keychain locked detection (`isKeychainLockedError`) — see `isKeychainLockedError(err)`
- Auth storage factory (`createSecureAuthStorage`) — see Auth Token Management

## Requirements

| Dependency                   | Version     |
| ---------------------------- | ----------- |
| `react-native`               | `>= 0.75.0` |
| `react-native-nitro-modules` | `>= 0.35.4` |
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
| `coalesceDiskWrites`   | `boolean`                        | `false`        | Batch same-tick Disk writes per key until `flushDiskWrites()`  |
| `coalesceSecureWrites` | `boolean`                        | `false`        | Batch same-tick Secure writes per key                          |
| `namespace`            | `string`                         | —              | Prefix key as `namespace:key` for isolation                    |
| `biometric`            | `boolean`                        | `false`        | Require biometric auth (Secure scope only)                     |
| `biometricLevel`       | `BiometricLevel`                 | `None`         | Biometric policy (`BiometryOrPasscode` / `BiometryOnly`)       |
| `accessControl`        | `AccessControl`                  | —              | Keychain access control level (native only)                    |

**Returned `StorageItem<T>`:**

| Method / Property   | Type                                                                 | Description                                            |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| `get()`             | `() => T`                                                            | Read current value (synchronous)                       |
| `getWithVersion()`  | `() => { value: T; version: StorageVersion }`                        | Read value plus current storage version token          |
| `set(value)`        | `(value: T \| ((prev: T) => T)) => void`                             | Write a value or updater function                      |
| `setIfVersion(...)` | `(version: StorageVersion, value: T \| ((prev: T) => T)) => boolean` | Write only if version matches (optimistic concurrency) |
| `delete()`          | `() => void`                                                         | Remove the stored value (resets to `defaultValue`)     |
| `has()`             | `() => boolean`                                                      | Check if a value exists in storage                     |
| `subscribe(cb)`     | `(cb: () => void) => () => void`                                     | Listen for changes, returns unsubscribe                |
| `serialize`         | `(v: T) => string`                                                   | The item's serializer                                  |
| `deserialize`       | `(v: string) => T`                                                   | The item's deserializer                                |
| `scope`             | `StorageScope`                                                       | The item's scope                                       |
| `key`               | `string`                                                             | The resolved key (includes namespace prefix)           |

**Non-React subscription example:**

```ts
const unsubscribe = sessionItem.subscribe(() => {
  console.log("session changed:", sessionItem.get());
});

sessionItem.set("next-session");
unsubscribe();
```

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

| Method                                   | Description                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `storage.clear(scope)`                   | Clear all keys in a scope (`Secure` also clears biometric entries)           |
| `storage.clearAll()`                     | Clear Memory + Disk + Secure                                                 |
| `storage.clearNamespace(ns, scope)`      | Remove only keys matching a namespace                                        |
| `storage.clearBiometric()`               | Remove all biometric-prefixed keys                                           |
| `storage.has(key, scope)`                | Check if a key exists                                                        |
| `storage.getAllKeys(scope)`              | Get all key names                                                            |
| `storage.getKeysByPrefix(prefix, scope)` | Get keys that start with a prefix                                            |
| `storage.getByPrefix(prefix, scope)`     | Get raw key-value pairs for keys matching a prefix                           |
| `storage.getAll(scope)`                  | Get all key-value pairs as `Record<string, string>`                          |
| `storage.size(scope)`                    | Number of stored keys                                                        |
| `storage.getCapabilities()`              | Read runtime backend metadata and buffering support                          |
| `storage.setAccessControl(level)`        | Set default secure access control for subsequent secure writes (native only) |
| `storage.setDiskWritesAsync(enabled)`    | Buffer raw Disk writes in JS until flushed (all platforms)                   |
| `storage.flushDiskWrites()`              | Force flush queued Disk writes from raw APIs / coalesced items               |
| `storage.setSecureWritesAsync(enabled)`  | Toggle async secure writes on Android (`false` by default)                   |
| `storage.flushSecureWrites()`            | Force flush of queued secure writes when coalescing is enabled               |
| `storage.setKeychainAccessGroup(group)`  | Set keychain access group for app sharing (native only)                      |
| `storage.getString(key, scope)`          | Read a raw string value directly (bypasses serialization)                    |
| `storage.setString(key, value, scope)`   | Write a raw string value directly (bypasses serialization)                   |
| `storage.deleteString(key, scope)`       | Delete a raw string value by key                                             |
| `storage.import(data, scope)`            | Bulk-load a `Record<string, string>` of raw key/value pairs into a scope     |
| `storage.setMetricsObserver(observer?)`  | Subscribe to per-operation timing events                                     |
| `storage.getMetricsSnapshot()`           | Get aggregate counters/latency stats keyed by operation                      |
| `storage.resetMetrics()`                 | Reset in-memory metrics counters                                             |

| Web helper                             | Description                                                          |
| -------------------------------------- | -------------------------------------------------------------------- |
| `setWebDiskStorageBackend(backend?)`   | Override the web Disk backend (web only)                             |
| `getWebDiskStorageBackend()`           | Read the active web Disk backend (web only)                          |
| `setWebSecureStorageBackend(backend?)` | Override the web Secure backend (web only)                           |
| `getWebSecureStorageBackend()`         | Read the active web Secure backend (web only)                        |
| `flushWebStorageBackends()`            | Await optional backend durability hooks for Disk + Secure (web only) |

> `storage.getAll(StorageScope.Secure)` returns regular secure entries. Biometric-protected values are not included in this snapshot API.

#### Global utility examples

```ts
import {
  AccessControl,
  storage,
  StorageScope,
} from "react-native-nitro-storage";

storage.has("session", StorageScope.Disk);
storage.getAllKeys(StorageScope.Disk);
storage.getKeysByPrefix("user-42:", StorageScope.Disk);
storage.getByPrefix("user-42:", StorageScope.Disk);
storage.getAll(StorageScope.Disk);
storage.size(StorageScope.Disk);
storage.getCapabilities();

storage.clearNamespace("user-42", StorageScope.Disk);
storage.clearBiometric();

storage.setAccessControl(AccessControl.WhenUnlockedThisDeviceOnly);
storage.setKeychainAccessGroup("group.com.example.shared");

storage.clear(StorageScope.Memory);
storage.clearAll();
```

#### Disk write buffering

Disk writes can now be buffered in JS, similar to secure write coalescing, which is useful when you are doing bursty persistence and want an explicit durability boundary.

```ts
import {
  createStorageItem,
  storage,
  StorageScope,
} from "react-native-nitro-storage";

const bufferedDraft = createStorageItem({
  key: "draft",
  scope: StorageScope.Disk,
  defaultValue: "",
  coalesceDiskWrites: true,
});

bufferedDraft.set("hello");
storage.setDiskWritesAsync(true);
storage.setString("draft:raw", "value", StorageScope.Disk);

storage.flushDiskWrites(); // commit queued Disk writes
storage.setDiskWritesAsync(false);
```

#### Android secure write mode

`storage.setSecureWritesAsync(true)` switches secure writes from synchronous `commit()` to asynchronous `apply()` on Android.  
Use this for non-critical secure writes when lower latency matters more than immediate durability.

Call `storage.flushSecureWrites()` when you need deterministic persistence boundaries (for example before namespace clears, process handoff, or strict test assertions).

```ts
import { storage } from "react-native-nitro-storage";

storage.setSecureWritesAsync(true);

// ...multiple secure writes happen (including coalesced item writes)

storage.flushSecureWrites(); // deterministic durability boundary
```

#### Custom Web Disk and Secure Backends

By default, web Disk and Secure scopes use `localStorage`. Disk excludes Nitro's secure prefixes, and Secure stores under `__secure_` / `__bio_` prefixes.

You can replace either backend with a custom implementation. The minimal backend contract is:

```ts
type WebStorageBackend = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  getAllKeys(): string[];
  getMany?: (keys: string[]) => (string | null)[];
  setMany?: (entries: ReadonlyArray<readonly [string, string]>) => void;
  removeMany?: (keys: string[]) => void;
  size?: () => number;
  subscribe?: (
    listener: (event: { key: string | null; newValue: string | null }) => void,
  ) => () => void;
  flush?: () => Promise<void>;
  name?: string;
};
```

Optional hooks are used for faster batch operations, custom cross-tab sync, and explicit durability boundaries.

```ts
import {
  flushWebStorageBackends,
  getWebDiskStorageBackend,
  getWebSecureStorageBackend,
  setWebDiskStorageBackend,
  setWebSecureStorageBackend,
} from "react-native-nitro-storage";

setWebDiskStorageBackend({
  getItem: (key) => diskStore.get(key) ?? null,
  setItem: (key, value) => diskStore.set(key, value),
  removeItem: (key) => diskStore.delete(key),
  clear: () => diskStore.clear(),
  getAllKeys: () => Array.from(diskStore.keys()),
});

setWebSecureStorageBackend({
  getItem: (key) => encryptedStore.get(key) ?? null,
  setItem: (key, value) => encryptedStore.set(key, value),
  removeItem: (key) => encryptedStore.delete(key),
  clear: () => encryptedStore.clear(),
  getAllKeys: () => Array.from(encryptedStore.keys()),
});

await flushWebStorageBackends();

const diskBackend = getWebDiskStorageBackend();
const backend = getWebSecureStorageBackend();
console.log("custom disk backend active:", diskBackend !== undefined);
console.log("custom backend active:", backend !== undefined);
```

---

### IndexedDB Backend for Web

The default web Secure backend uses `localStorage`, which is synchronous and size-limited. For large payloads or when you need true persistence across tab reloads, use the built-in IndexedDB-backed factory.

```ts
import { setWebSecureStorageBackend } from "react-native-nitro-storage";
import { createIndexedDBBackend } from "react-native-nitro-storage/indexeddb-backend";

// call once at app startup, before rendering any components that read secure items
const backend = await createIndexedDBBackend();
setWebSecureStorageBackend(backend);
```

**How it works:**

- **Async init**: `createIndexedDBBackend()` opens (or creates) the IndexedDB database and hydrates an in-memory cache from all stored entries before resolving.
- **Synchronous reads**: all `getItem` calls are served from the in-memory cache — no async overhead after init.
- **Queued writes + durability**: writes update the cache synchronously, persist in the background, and can be awaited via `await backend.flush()` or `await flushWebStorageBackends()`.
- **Cross-tab sync**: backend instances on the same `dbName`/`storeName` coordinate through `BroadcastChannel` so cache invalidation reaches other tabs.
- **Custom database/store**: optionally pass `dbName` and `storeName` to isolate databases per environment or tenant.

```ts
const backend = await createIndexedDBBackend("my-app-db", "secure-kv");
setWebSecureStorageBackend(backend);
await backend.flush?.();
```

You can also pass an optional third argument to receive async persistence failures:

```ts
const backend = await createIndexedDBBackend("my-app-db", "secure-kv", {
  onError: (error) => {
    console.error("indexeddb persistence failed", error);
  },
});
```

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
- Supports per-key TTL, biometric level policy, and access control

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

### Raw String API

For cases where you want to bypass `createStorageItem` serialization entirely and work with raw key/value strings:

```ts
import { storage, StorageScope } from "react-native-nitro-storage";

storage.setString("raw-key", "raw-value", StorageScope.Disk);
const value = storage.getString("raw-key", StorageScope.Disk); // "raw-value" | undefined
storage.deleteString("raw-key", StorageScope.Disk);
```

These are synchronous and go directly to the native backend without any serialize/deserialize step.

---

### Error Classification

`getStorageErrorCode(err)` returns a stable classification for common native/web storage failures. Native bridges now emit stable `[nitro-error:<code>]` tags so the classification path does not depend on platform exception wording alone.
`isKeychainLockedError(err)` remains the convenience helper for retry-after-unlock flows and now delegates to the structured code path.

```ts
import {
  getStorageErrorCode,
  isKeychainLockedError,
} from "react-native-nitro-storage";

try {
  secureItem.get();
} catch (err) {
  const code = getStorageErrorCode(err);
  // "keychain_locked" | "authentication_required" | ...

  if (isKeychainLockedError(err)) {
    // device is locked — retry after unlock
  }
}
```

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
type UserPreferences = {
  theme: "light" | "dark" | "system";
  language: string;
  notifications: boolean;
};

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
type FeatureFlags = {
  darkMode: boolean;
  betaFeature: boolean;
  maxUploadMb: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isFeatureFlags = (value: unknown): value is FeatureFlags => {
  if (!isRecord(value)) return false;
  return (
    typeof value.darkMode === "boolean" &&
    typeof value.betaFeature === "boolean" &&
    typeof value.maxUploadMb === "number"
  );
};

const flagsItem = createStorageItem<FeatureFlags>({
  key: "feature-flags",
  scope: StorageScope.Disk,
  defaultValue: { darkMode: false, betaFeature: false, maxUploadMb: 10 },
  validate: isFeatureFlags,
  onValidationError: () => ({
    darkMode: false,
    betaFeature: false,
    maxUploadMb: 10,
  }),
  expiration: { ttlMs: 60 * 60_000 }, // refresh from server every hour
  onExpired: () => fetchAndStoreFlags(),
});
```

### Biometric-protected Secrets

```ts
import {
  AccessControl,
  BiometricLevel,
  createStorageItem,
  StorageScope,
} from "react-native-nitro-storage";

const paymentPin = createStorageItem<string>({
  key: "payment-pin",
  scope: StorageScope.Secure,
  defaultValue: "",
  biometricLevel: BiometricLevel.BiometryOnly,
  accessControl: AccessControl.WhenPasscodeSetThisDeviceOnly,
});

paymentPin.set("4829");
const pin = paymentPin.get();
paymentPin.delete();
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

### Bulk Bootstrap with Batch APIs

```ts
import {
  createStorageItem,
  getBatch,
  removeBatch,
  setBatch,
  StorageScope,
} from "react-native-nitro-storage";

const firstName = createStorageItem({
  key: "first-name",
  scope: StorageScope.Disk,
  defaultValue: "",
});
const lastName = createStorageItem({
  key: "last-name",
  scope: StorageScope.Disk,
  defaultValue: "",
});

setBatch(
  [
    { item: firstName, value: "Ada" },
    { item: lastName, value: "Lovelace" },
  ],
  StorageScope.Disk,
);

const [first, last] = getBatch([firstName, lastName], StorageScope.Disk);
removeBatch([firstName, lastName], StorageScope.Disk);
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

### Coalesced Secure Writes with Deterministic Flush

```ts
import {
  createStorageItem,
  storage,
  StorageScope,
} from "react-native-nitro-storage";

const sessionToken = createStorageItem<string>({
  key: "session-token",
  scope: StorageScope.Secure,
  defaultValue: "",
  coalesceSecureWrites: true,
});

sessionToken.set("token-v1");
sessionToken.set("token-v2");

// force pending secure writes to native persistence
storage.flushSecureWrites();
```

### Bulk Data Import

Load server-fetched data into storage in one atomic call. All keys become visible simultaneously before any listener fires.

```ts
import { storage, StorageScope } from "react-native-nitro-storage";

// seed local cache from a server response
const serverData = await fetchInitialData(); // Record<string, string>
storage.import(serverData, StorageScope.Disk);

// all imported keys are immediately readable
const value = storage.has("remote-config", StorageScope.Disk);
```

> `storage.import` writes raw string values directly — serialization is bypassed. Use it for bootstrapping data that was already serialized by the server or exported via `storage.getAll`.

---

### Storage Snapshots and Cleanup

```ts
import { storage, StorageScope } from "react-native-nitro-storage";

const diskKeys = storage.getAllKeys(StorageScope.Disk);
const diskValues = storage.getAll(StorageScope.Disk);
const secureCount = storage.size(StorageScope.Secure);

if (storage.has("legacy-flag", StorageScope.Disk)) {
  storage.clearNamespace("legacy", StorageScope.Disk);
}

storage.clearBiometric();
```

### Prefix Queries and Namespace Inspection

```ts
import { storage, StorageScope } from "react-native-nitro-storage";

const userKeys = storage.getKeysByPrefix("user-42:", StorageScope.Disk);
const userRawEntries = storage.getByPrefix("user-42:", StorageScope.Disk);

console.log(userKeys);
console.log(userRawEntries);
```

### Optimistic Versioned Writes

```ts
import { createStorageItem, StorageScope } from "react-native-nitro-storage";

const profileItem = createStorageItem({
  key: "profile",
  scope: StorageScope.Disk,
  defaultValue: { name: "Guest" },
});

const snapshot = profileItem.getWithVersion();
const didWrite = profileItem.setIfVersion(snapshot.version, {
  ...snapshot.value,
  name: "Ada",
});

if (!didWrite) {
  // value changed since snapshot; reload and retry
}
```

### Storage Metrics Instrumentation

```ts
import { storage } from "react-native-nitro-storage";

storage.setMetricsObserver((event) => {
  console.log(
    `[nitro-storage] ${event.operation} scope=${event.scope} duration=${event.durationMs}ms keys=${event.keysCount}`,
  );
});

const metrics = storage.getMetricsSnapshot();
console.log(metrics["item:get"]?.avgDurationMs);

storage.resetMetrics();
storage.setMetricsObserver(undefined);
```

### Low-level Subscription (outside React)

```ts
import { createStorageItem, StorageScope } from "react-native-nitro-storage";

const notificationsItem = createStorageItem<boolean>({
  key: "notifications-enabled",
  scope: StorageScope.Disk,
  defaultValue: true,
});

const unsubscribe = notificationsItem.subscribe(() => {
  console.log("notifications changed:", notificationsItem.get());
});

notificationsItem.set(false);
unsubscribe();
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
  StorageVersion,
  VersionedValue,
  StorageMetricsEvent,
  StorageMetricsObserver,
  StorageMetricSummary,
  WebSecureStorageBackend,
  MMKVLike,
  SecureAuthStorageConfig,
} from "react-native-nitro-storage";
```

---

## Dev Commands

From repository root:

```bash
bun run test -- --filter=react-native-nitro-storage
bun run lint -- --filter=react-native-nitro-storage
bun run format:check -- --filter=react-native-nitro-storage
bun run typecheck -- --filter=react-native-nitro-storage
bun run test:types -- --filter=react-native-nitro-storage
bun run test:cpp -- --filter=react-native-nitro-storage
bun run build -- --filter=react-native-nitro-storage
```

Inside `packages/react-native-nitro-storage`:

```bash
bun run test            # run tests
bun run test:coverage   # run tests with coverage
bun run lint            # eslint (expo-magic rules)
bun run format:check    # prettier check
bun run typecheck       # tsc --noEmit
bun run test:types      # public type-level API tests
bun run test:cpp        # C++ binding/core tests
bun run check:pack      # npm pack content guard
bun run build           # bob build
bun run benchmark       # performance benchmarks
```

## License

MIT
