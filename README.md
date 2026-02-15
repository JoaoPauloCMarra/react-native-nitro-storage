# react-native-nitro-storage

Synchronous storage for React Native with a unified API for memory, disk, and secure data.

## Requirements

- `react-native >= 0.75.0`
- `react-native-nitro-modules >= 0.33.7`
- `react`

## Installation

```bash
bun add react-native-nitro-storage react-native-nitro-modules
```

### Expo

```bash
bunx expo install react-native-nitro-storage react-native-nitro-modules
```

`app.json`:

```json
{
  "expo": {
    "plugins": ["react-native-nitro-storage"]
  }
}
```

Then:

```bash
bunx expo prebuild
```

### Bare React Native

iOS:

```bash
cd ios && pod install
```

Android (`MainApplication.kt`):

```kotlin
import com.nitrostorage.AndroidStorageAdapter

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    AndroidStorageAdapter.init(this)
  }
}
```

## Quick Start

```ts
import { createStorageItem, StorageScope, useStorage } from "react-native-nitro-storage";

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

## What Is Exported

- `StorageScope`
- `storage`
- `createStorageItem`
- `useStorage`
- `useSetStorage`
- `getBatch`
- `setBatch`
- `removeBatch`
- `registerMigration`
- `migrateToLatest`
- `runTransaction`
- `migrateFromMMKV`

Exported types:

- `Storage`
- `StorageItemConfig<T>`
- `StorageItem<T>`
- `StorageBatchSetItem<T>`
- `Validator<T>`
- `ExpirationConfig`
- `MigrationContext`
- `Migration`
- `TransactionContext`
- `MMKVLike`

## API Reference

### `StorageScope`

```ts
enum StorageScope {
  Memory = 0,
  Disk = 1,
  Secure = 2,
}
```

### `Storage` (low-level native/web adapter type)

```ts
type Storage = {
  set(key: string, value: string, scope: number): void;
  get(key: string, scope: number): string | undefined;
  remove(key: string, scope: number): void;
  clear(scope: number): void;
  setBatch(keys: string[], values: string[], scope: number): void;
  getBatch(keys: string[], scope: number): (string | undefined)[];
  removeBatch(keys: string[], scope: number): void;
  addOnChange(
    scope: number,
    callback: (key: string, value: string | undefined) => void
  ): () => void;
};
```

Notes:

- Exported for typing/integration use cases.
- Most app code should use `createStorageItem` + hooks instead of this low-level API.

### `StorageItemConfig<T>`

```ts
type StorageItemConfig<T> = {
  key: string;
  scope: StorageScope;
  defaultValue?: T;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
  validate?: Validator<T>;
  onValidationError?: (invalidValue: unknown) => T;
  expiration?: ExpirationConfig;
};
```

### `StorageItem<T>`

```ts
type StorageItem<T> = {
  get: () => T;
  set: (value: T | ((prev: T) => T)) => void;
  delete: () => void;
  subscribe: (callback: () => void) => () => void;
  serialize: (value: T) => string;
  deserialize: (value: string) => T;
  _triggerListeners: () => void;
  scope: StorageScope;
  key: string;
};
```

### `createStorageItem<T>(config)`

```ts
function createStorageItem<T = undefined>(config: StorageItemConfig<T>): StorageItem<T>
```

Notes:

- `Memory` stores values directly.
- `Disk` and `Secure` store serialized values.
- If `expiration` is enabled, values are wrapped internally and expired lazily on read.
- If `validate` fails on a stored value, fallback is:
1. `onValidationError(invalidValue)` if provided
2. `defaultValue` otherwise
- Fallback values are written back only when the source was stored data and the resolved fallback also passes `validate`.

Throws:

- `Error("expiration.ttlMs must be greater than 0.")` when `expiration.ttlMs <= 0`.

### `useStorage(item)`

```ts
function useStorage<T>(
  item: StorageItem<T>
): [T, (value: T | ((prev: T) => T)) => void]
```

### `useSetStorage(item)`

```ts
function useSetStorage<T>(
  item: StorageItem<T>
): (value: T | ((prev: T) => T)) => void
```

### `storage`

```ts
const storage: {
  clear: (scope: StorageScope) => void;
  clearAll: () => void;
};
```

Behavior:

- `clear(scope)` clears all keys in a single scope.
- `clearAll()` clears `Memory`, `Disk`, and `Secure`.

### Batch Operations

```ts
type StorageBatchSetItem<T> = {
  item: StorageItem<T>;
  value: T;
};

function getBatch(
  items: readonly Pick<StorageItem<unknown>, "key" | "scope" | "get" | "deserialize">[],
  scope: StorageScope
): unknown[];

function setBatch<T>(
  items: readonly StorageBatchSetItem<T>[],
  scope: StorageScope
): void;

function removeBatch(
  items: readonly Pick<StorageItem<unknown>, "key" | "scope" | "delete" | "_triggerListeners">[],
  scope: StorageScope
): void;
```

Rules:

- All items must match the batch `scope`.
- Mixed-scope calls throw:
  - `Batch scope mismatch for "<key>": expected <Scope>, received <Scope>.`

### Migrations

```ts
type MigrationContext = {
  scope: StorageScope;
  getRaw: (key: string) => string | undefined;
  setRaw: (key: string, value: string) => void;
  removeRaw: (key: string) => void;
};

type Migration = (context: MigrationContext) => void;

function registerMigration(version: number, migration: Migration): void;
function migrateToLatest(scope?: StorageScope): number;
```

Behavior:

- Versions must be positive integers.
- Duplicate versions throw.
- Migration version is tracked per scope using key `__nitro_storage_migration_version__`.
- `migrateToLatest` applies pending migrations in ascending version order and returns applied/latest version.

Throws:

- `registerMigration`: throws when version is not a positive integer.
- `registerMigration`: throws when version is already registered.
- `migrateToLatest`: throws on invalid scope.

### Transactions

```ts
type TransactionContext = {
  scope: StorageScope;
  getRaw: (key: string) => string | undefined;
  setRaw: (key: string, value: string) => void;
  removeRaw: (key: string) => void;
  getItem: <T>(item: Pick<StorageItem<T>, "scope" | "key" | "get">) => T;
  setItem: <T>(
    item: Pick<StorageItem<T>, "scope" | "key" | "serialize">,
    value: T
  ) => void;
  removeItem: (item: Pick<StorageItem<unknown>, "scope" | "key">) => void;
};

function runTransaction<T>(
  scope: StorageScope,
  transaction: (context: TransactionContext) => T
): T;
```

Behavior:

- On exception, it rolls back keys modified in that transaction.
- Rollback is best-effort within process lifetime.

Throws:

- Throws on invalid scope.
- Rethrows any error thrown by the transaction callback after rollback.

### Validation and Expiration Types

```ts
type Validator<T> = (value: unknown) => value is T;

type ExpirationConfig = {
  ttlMs: number;
};
```

### MMKV Migration

```ts
type MMKVLike = {
  getString: (key: string) => string | undefined;
  getNumber: (key: string) => number | undefined;
  getBoolean: (key: string) => boolean | undefined;
  contains: (key: string) => boolean;
  delete: (key: string) => void;
  getAllKeys: () => string[];
};

function migrateFromMMKV<T>(
  mmkv: MMKVLike,
  item: StorageItem<T>,
  deleteFromMMKV?: boolean
): boolean;
```

Behavior:

- Returns `true` when a value is found and copied, `false` otherwise.
- Read priority is: `getString` -> `getNumber` -> `getBoolean`.
- Uses `item.set(...)`, so schema validation on the target item still applies.
- If `deleteFromMMKV` is `true`, deletes only when migration succeeds.

## Examples

### Schema Validation + Fallback

```ts
const userIdItem = createStorageItem<number>({
  key: "user-id",
  scope: StorageScope.Disk,
  defaultValue: 0,
  validate: (v): v is number => typeof v === "number" && v > 0,
  onValidationError: () => 1,
});
```

### TTL

```ts
const otpItem = createStorageItem<string | undefined>({
  key: "otp",
  scope: StorageScope.Secure,
  expiration: { ttlMs: 60_000 },
});
```

### Transaction

```ts
runTransaction(StorageScope.Disk, (tx) => {
  tx.setRaw("a", JSON.stringify(1));
  tx.setRaw("b", JSON.stringify(2));
});
```

### Versioned Migrations

```ts
registerMigration(1, ({ setRaw }) => {
  setRaw("seed", JSON.stringify({ ready: true }));
});

registerMigration(2, ({ getRaw, setRaw }) => {
  const raw = getRaw("seed");
  if (!raw) return;
  const value = JSON.parse(raw) as { ready: boolean };
  setRaw("seed", JSON.stringify({ ...value, migrated: true }));
});

migrateToLatest(StorageScope.Disk);
```

## Scope Semantics

- `Memory`: in-memory only, not persisted.
- `Disk`: UserDefaults (iOS), SharedPreferences (Android), `localStorage` (web).
- `Secure`: Keychain (iOS), EncryptedSharedPreferences (Android), `sessionStorage` fallback (web).

## Dev Commands

From repo root:

```bash
bun run test -- --filter=react-native-nitro-storage
bun run typecheck -- --filter=react-native-nitro-storage
bun run build -- --filter=react-native-nitro-storage
```

Inside package:

```bash
bun run test
bun run test:coverage
bun run typecheck
bun run build
```

## License

MIT
