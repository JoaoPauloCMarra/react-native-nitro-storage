# API Reference

This page lists the public API surface. For copy-ready workflows, see [recipes.md](recipes.md).

## createStorageItem

```ts
const item = createStorageItem<T>({
  key: "theme",
  scope: StorageScope.Disk,
  defaultValue: "system",
});
```

`StorageItemConfig<T>`:

| Field                  | Type                             | Purpose                                                          |
| ---------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `key`                  | `string`                         | Storage key. Combined with `namespace` when provided.            |
| `scope`                | `StorageScope`                   | Memory, Disk, or Secure.                                         |
| `defaultValue`         | `T`                              | Value returned when no stored value exists.                      |
| `serialize`            | `(value: T) => string`           | Custom string encoder. Defaults to primitive/JSON serialization. |
| `deserialize`          | `(value: string) => T`           | Custom string decoder.                                           |
| `validate`             | `(value: unknown) => value is T` | Runtime guard for stored data.                                   |
| `onValidationError`    | `(invalidValue: unknown) => T`   | Replacement value when validation fails.                         |
| `expiration`           | `{ ttlMs: number }`              | Time-to-live for the value.                                      |
| `onExpired`            | `(key: string) => void`          | Called when a read detects TTL expiry.                           |
| `readCache`            | `boolean`                        | Cache parsed values in memory.                                   |
| `coalesceDiskWrites`   | `boolean`                        | Buffer Disk writes until the next flush.                         |
| `coalesceSecureWrites` | `boolean`                        | Buffer Secure writes until the next flush.                       |
| `namespace`            | `string`                         | Prefix keys as `namespace:key`.                                  |
| `biometric`            | `boolean`                        | Store through biometric secure storage.                          |
| `biometricLevel`       | `BiometricLevel`                 | Require biometric/passcode or biometric-only access.             |
| `accessControl`        | `AccessControl`                  | Platform secure accessibility setting.                           |

`StorageItem<T>`:

| Method                         | Purpose                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `get()`                        | Return the typed value or the default value.                |
| `getWithVersion()`             | Return `{ value, version }` for optimistic writes.          |
| `set(value)`                   | Store a value. Accepts direct values or updater functions.  |
| `setIfVersion(version, value)` | Store only when the current version still matches.          |
| `delete()`                     | Remove the key.                                             |
| `has()`                        | Check whether the key exists.                               |
| `subscribe(callback)`          | Subscribe to item changes. Returns an unsubscribe function. |
| `subscribeSelector(...)`       | Subscribe to a selected value with an equality check.       |
| `serialize(value)`             | Serialize a value with the item encoder.                    |
| `deserialize(value)`           | Deserialize a raw string with the item decoder.             |

```ts
const unsubscribe = profileItem.subscribeSelector(
  (profile) => profile.name,
  (name, previousName) => {
    console.log("Profile name changed", { name, previousName });
  },
  { fireImmediately: true },
);
```

## React Hooks

```ts
const [value, setValue] = useStorage(item);
const [selected, setItem] = useStorageSelector(item, selector, isEqual);
const setOnly = useSetStorage(item);
```

See [react-hooks.md](react-hooks.md).

## storage

`storage` exposes raw and cross-item utilities:

| Method                                           | Purpose                                                       |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `clear(scope)`                                   | Clear one scope.                                              |
| `clearAll()`                                     | Clear Memory, Disk, and Secure scopes.                        |
| `clearNamespace(namespace, scope)`               | Remove keys under `namespace:`.                               |
| `subscribe(scope, listener)`                     | Subscribe to raw scope-level change events.                   |
| `subscribeKey(scope, key, listener)`             | Subscribe to raw events for one key.                          |
| `subscribePrefix(scope, prefix, listener)`       | Subscribe to raw events for matching key prefixes.            |
| `subscribeNamespace(namespace, scope, listener)` | Subscribe to raw events for `namespace:` keys.                |
| `setEventObserver(observer)`                     | Receive all change events for devtools or logging.            |
| `clearBiometric()`                               | Clear biometric Secure entries.                               |
| `has(key, scope)`                                | Check for a raw key.                                          |
| `getAllKeys(scope)`                              | List raw keys.                                                |
| `getKeysByPrefix(prefix, scope)`                 | List raw keys with a prefix.                                  |
| `getByPrefix(prefix, scope)`                     | Read raw string values by prefix.                             |
| `getAll(scope)`                                  | Read all raw string values in a scope.                        |
| `size(scope)`                                    | Return approximate scope entry count.                         |
| `setAccessControl(accessControl)`                | Set the default Secure access control level.                  |
| `setSecureWritesAsync(enabled)`                  | Toggle Android secure writes between sync and async modes.    |
| `setDiskWritesAsync(enabled)`                    | Toggle coalesced Disk write behavior.                         |
| `flushDiskWrites()`                              | Flush pending Disk writes.                                    |
| `flushSecureWrites()`                            | Flush pending Secure writes.                                  |
| `setKeychainAccessGroup(group)`                  | Configure iOS Keychain access group.                          |
| `setMetricsObserver(observer)`                   | Receive operation timing events.                              |
| `getMetricsSnapshot()`                           | Read aggregated metrics.                                      |
| `resetMetrics()`                                 | Clear metrics counters.                                       |
| `getCapabilities()`                              | Read runtime storage capabilities.                            |
| `getSecurityCapabilities()`                      | Read secure backend capability metadata.                      |
| `getSecureMetadata(key)`                         | Read secure metadata for one key without returning its value. |
| `getAllSecureMetadata()`                         | Read secure metadata for all secure keys without values.      |
| `getString(key, scope)`                          | Read a raw string.                                            |
| `setString(key, value, scope)`                   | Write a raw string.                                           |
| `deleteString(key, scope)`                       | Remove a raw key.                                             |
| `export(scope)`                                  | Snapshot raw strings from one scope.                          |
| `import(data, scope)`                            | Bulk import raw strings.                                      |

Raw string APIs bypass item serialization and validation. Prefer `StorageItem<T>` unless you are migrating, exporting/importing, or writing a custom integration.

```ts
const diskSnapshot = storage.export(StorageScope.Disk);
storage.import(diskSnapshot, StorageScope.Disk);
```

Secure exports contain raw secret values. Do not log `storage.export(StorageScope.Secure)` output or attach it to diagnostics, analytics, crash reports, or support bundles.

## Event Subscriptions

Use raw subscriptions when integrating Nitro Storage with state managers, sync engines, debug tooling, or non-React code.

```ts
const unsubscribe = storage.subscribeNamespace(
  "auth",
  StorageScope.Secure,
  (event) => {
    if (event.type === "batch") {
      console.log(
        "Auth keys changed",
        event.changes.map((change) => change.key),
      );
      return;
    }

    console.log("Auth key changed", event.key, event.operation);
  },
);
```

For whole-app debug tooling, install one observer:

```ts
storage.setEventObserver((event) => {
  if (event.scope !== StorageScope.Secure) {
    console.log(event);
  }
});
```

Local batch APIs emit one `type: "batch"` envelope to scope and prefix/namespace listeners. Key subscribers receive the matching per-key change so direct key integrations do not need to unpack batch envelopes. Secure events can include raw secret values; do not log Secure event payloads in production.

## Batch Operations

```ts
const values = getBatch([themeItem, localeItem], StorageScope.Disk);

setBatch(
  [
    { item: themeItem, value: "dark" },
    { item: localeItem, value: "en-US" },
  ],
  StorageScope.Disk,
);

removeBatch([themeItem, localeItem], StorageScope.Disk);
```

See [batch-transactions-migrations.md](batch-transactions-migrations.md).

## Transactions

```ts
runTransaction(StorageScope.Disk, (tx) => {
  const current = tx.getItem(balanceItem);
  tx.setItem(balanceItem, current + 10);
});
```

If the callback throws, previously changed keys in that transaction are rolled back synchronously.

## Migrations

```ts
registerMigration(2, (ctx) => {
  const oldTheme = ctx.getRaw("theme");
  if (oldTheme === "black") {
    ctx.setRaw("theme", "dark");
  }
});

migrateToLatest(StorageScope.Disk);
```

Migration versions are tracked per scope.

## Secure Auth Storage

```ts
const auth = createSecureAuthStorage({
  accessToken: { ttlMs: 15 * 60 * 1000 },
  refreshToken: { accessControl: AccessControl.AfterFirstUnlockThisDeviceOnly },
});

auth.accessToken.set("token");
```

The returned object is a typed record of secure string `StorageItem`s.

## Web Backend APIs

```ts
setWebDiskStorageBackend(backend);
getWebDiskStorageBackend();
setWebSecureStorageBackend(backend);
getWebSecureStorageBackend();
await flushWebStorageBackends();
```

See [web-backends.md](web-backends.md).

## Enums

```ts
enum StorageScope {
  Memory = 0,
  Disk = 1,
  Secure = 2,
}

enum BiometricLevel {
  None = 0,
  BiometryOrPasscode = 1,
  BiometryOnly = 2,
}
```

`AccessControl` values:

- `WhenUnlocked`
- `AfterFirstUnlock`
- `WhenPasscodeSetThisDeviceOnly`
- `WhenUnlockedThisDeviceOnly`
- `AfterFirstUnlockThisDeviceOnly`

## Exported Types

Common public types:

- `Storage`
- `Validator<T>`
- `ExpirationConfig`
- `StorageItem<T>`
- `StorageItemConfig<T>`
- `StorageBatchSetItem<T>`
- `StorageVersion`
- `VersionedValue<T>`
- `StorageMetricsEvent`
- `StorageMetricsObserver`
- `StorageMetricSummary`
- `StorageChangeEvent`
- `StorageKeyChangeEvent`
- `StorageBatchChangeEvent`
- `StorageChangeOperation`
- `StorageChangeSource`
- `StorageEventListener`
- `MigrationContext`
- `Migration`
- `TransactionContext`
- `SecureAuthStorageConfig<K>`
- `SecurityCapabilities`
- `SecureStorageMetadata`
- `StorageErrorCode`
- `WebStorageBackend`
- `WebDiskStorageBackend`
- `WebSecureStorageBackend`
- `WebStorageChangeEvent`
- `WebStorageScope`

The IndexedDB subpath exports `createIndexedDBBackend()` and `IndexedDBBackendOptions`.
