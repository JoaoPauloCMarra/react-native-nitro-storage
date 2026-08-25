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

| Field                        | Type                             | Purpose                                                             |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| `key`                        | `string`                         | Storage key. Combined with `namespace` when provided.               |
| `scope`                      | `StorageScope`                   | Memory, Disk, or Secure.                                            |
| `defaultValue`               | `T`                              | Value returned when no stored value exists.                         |
| `serialize`                  | `(value: T) => string`           | Custom string encoder. Defaults to primitive/JSON serialization.    |
| `deserialize`                | `(value: string) => T`           | Custom string decoder.                                              |
| `validate`                   | `(value: unknown) => value is T` | Runtime guard for stored data.                                      |
| `onValidationError`          | `(invalidValue: unknown) => T`   | Replacement value when validation fails.                            |
| `expiration`                 | `{ ttlMs: number }`              | Time-to-live for the value.                                         |
| `onExpired`                  | `(key: string) => void`          | Called when a read detects TTL expiry.                              |
| `readCache`                  | `boolean`                        | Reuse raw cache entries for reads, including cached missing values. |
| `coalesceDiskWrites`         | `boolean`                        | Buffer Disk writes until the next flush.                            |
| `coalesceSecureWrites`       | `boolean`                        | Buffer Secure writes until the next flush.                          |
| `namespace`                  | `string`                         | Prefix keys as `namespace:key`.                                     |
| `biometric`                  | `boolean`                        | Store through biometric secure storage.                             |
| `biometricLevel`             | `BiometricLevel`                 | Require biometric/passcode or biometric-only access.                |
| `accessControl`              | `AccessControl`                  | Platform secure accessibility setting.                              |
| `group`                      | `string`                         | Register the item for group cleanup and inspection.                 |
| `renameFrom`                 | `string \| readonly string[]`    | Copy a legacy key on first read, then remove it.                    |
| `fallbackToCacheOnReadError` | `boolean`                        | Return the last cached value when a backend read fails.             |
| `onReadError`                | `(error: unknown) => void`       | Observe a backend read failure before fallback or rethrow.          |

`StorageItem<T>`:

| Method                         | Purpose                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `get()`                        | Return the typed value or the default value.                |
| `getWithVersion()`             | Return `{ value, version }` for optimistic writes.          |
| `set(value)`                   | Store a value. Accepts direct values or updater functions.  |
| `setIfVersion(version, value)` | Store only when the current version still matches.          |
| `merge(partial)`               | Shallow-merge an object value.                              |
| `reset()`                      | Delete the key so the next read returns the default.        |
| `setOrDelete(value)`           | Set a value or delete for `null`/`undefined`.               |
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

## createSetItem

```ts
const flags = createSetItem<"beta" | "compact">({
  key: "flags",
  scope: StorageScope.Memory,
  defaultValue: ["compact"],
});

flags.add("beta");
flags.has("compact");
flags.getTyped();
```

`get()` retains the compatibility shape `Record<string, true>`. Use
`getTyped()` when a precise member union is useful.

## React Hooks

```ts
const [value, setValue] = useStorage(item);
const [selected, setItem] = useStorageSelector(item, selector, isEqual);
const setOnly = useSetStorage(item);
```

See [react-hooks.md](react-hooks.md).

## storage

`storage` exposes raw and cross-item utilities:

| Method                                           | Purpose                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `clear(scope, options?)`                         | Clear one scope, optionally preserving selected keys.                                     |
| `clearAll()`                                     | Clear Memory, Disk, and Secure scopes.                                                    |
| `clearNamespace(namespace, scope)`               | Remove keys under `namespace:`.                                                           |
| `clearGroup(group)`                              | Remove registered items in a group across their scopes.                                   |
| `getGroupItems(group)`                           | List registered items in a group.                                                         |
| `subscribeExpired(scope, listener)`              | Receive item events caused by TTL expiry.                                                 |
| `findDuplicateKeys()`                            | Find duplicate registered `(scope, key)` definitions.                                     |
| `getRegisteredKeys()`                            | List registered `(scope, key)` definitions.                                               |
| `subscribe(scope, listener)`                     | Subscribe to raw scope-level change events.                                               |
| `subscribeKey(scope, key, listener)`             | Subscribe to raw events for one key.                                                      |
| `subscribePrefix(scope, prefix, listener)`       | Subscribe to raw events for matching key prefixes.                                        |
| `subscribeNamespace(namespace, scope, listener)` | Subscribe to raw events for `namespace:` keys.                                            |
| `setEventObserver(observer, options?)`           | Receive all change events for devtools or logging. Secure values are redacted by default. |
| `clearBiometric()`                               | Clear biometric Secure entries.                                                           |
| `has(key, scope)`                                | Check for a raw key.                                                                      |
| `getAllKeys(scope)`                              | List raw keys.                                                                            |
| `getKeysByPrefix(prefix, scope)`                 | List raw keys with a prefix.                                                              |
| `getByPrefix(prefix, scope)`                     | Read raw string values by prefix.                                                         |
| `getAll(scope)`                                  | Read all raw string values in a scope.                                                    |
| `size(scope)`                                    | Return approximate scope entry count.                                                     |
| `setAccessControl(accessControl)`                | Set the default Secure access control level.                                              |
| `setSecureWritesAsync(enabled)`                  | Toggle Android secure writes between sync and async modes.                                |
| `setDiskWritesAsync(enabled)`                    | Toggle coalesced Disk write behavior.                                                     |
| `flushDiskWrites()`                              | Flush pending Disk writes.                                                                |
| `flushSecureWrites()`                            | Flush pending Secure writes.                                                              |
| `setKeychainAccessGroup(group)`                  | Configure iOS Keychain access group.                                                      |
| `setMetricsObserver(observer)`                   | Receive operation timing events.                                                          |
| `getMetricsSnapshot()`                           | Read aggregated metrics.                                                                  |
| `getScopedMetricsSnapshot()`                     | Read metrics grouped by storage scope.                                                    |
| `resetMetrics()`                                 | Clear metrics counters.                                                                   |
| `getCapabilities()`                              | Read runtime storage capabilities.                                                        |
| `getSecurityCapabilities()`                      | Read secure backend capability metadata.                                                  |
| `getSecureMetadata(key)`                         | Read secure metadata for one key without returning its value.                             |
| `getAllSecureMetadata()`                         | Read secure metadata for all secure keys without values.                                  |
| `getString(key, scope)`                          | Read a raw string.                                                                        |
| `setString(key, value, scope)`                   | Write a raw string.                                                                       |
| `deleteString(key, scope)`                       | Remove a raw key.                                                                         |
| `export(scope, options?)`                        | Snapshot raw strings from one scope. Secure scope requires explicit unsafe opt-in.        |
| `exportSecureUnsafe()`                           | Snapshot raw Secure strings for short-lived migration workflows.                          |
| `import(data, scope)`                            | Bulk import raw strings.                                                                  |

Raw string APIs bypass item serialization and validation. Prefer `StorageItem<T>` unless you are migrating, exporting/importing, or writing a custom integration.

```ts
const diskSnapshot = storage.export(StorageScope.Disk);
storage.import(diskSnapshot, StorageScope.Disk);
```

Secure exports contain raw secret values. `storage.export(StorageScope.Secure)` throws unless called with `{ includeSecureValues: true }`; `storage.exportSecureUnsafe()` is the explicit equivalent. Do not log Secure exports or attach them to diagnostics, analytics, crash reports, or support bundles.

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

`setEventObserver()` redacts Secure `oldValue` and `newValue` fields by default. Pass `{ redactSecureValues: false }` only for in-memory debugging paths that never persist logs. Raw `subscribe*()` APIs preserve values for state integrations.

Local batch APIs emit one `type: "batch"` envelope to scope and prefix/namespace listeners. Key subscribers receive the matching per-key change so direct key integrations do not need to unpack batch envelopes. Failed transactions emit one batch envelope with `operation: "rollback"` whose changes carry the pre-rollback and restored raw values. Secure events can include raw secret values; do not log Secure event payloads in production.

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

`getBatch()` reuses enabled raw cache entries, including cached missing values,
and returns each item's default for a missing raw value without issuing a
per-item fallback read. Items that need validation, expiration, or migration
use their item-level read path to preserve those rules.

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

## Storage Error Classification

```ts
if (isStorageError(error, "keychain_locked")) {
  scheduleRetryAfterUnlock();
}
```

`getStorageErrorCode(error)` returns the stable `StorageErrorCode` embedded by
the native or web adapter. `isStorageError(error, code)` matches one exact code
without parsing platform message text. See [secure-storage.md](secure-storage.md)
for recovery semantics.

`isKeychainLockedError(error)` is deprecated. It remains available for
compatibility and returns `true` for `keychain_locked`,
`authentication_required`, and `key_invalidated`.

## Web Backend APIs

```ts
setWebDiskStorageBackend(backend);
getWebDiskStorageBackend();
setWebSecureStorageBackend(backend);
getWebSecureStorageBackend();
await flushWebStorageBackends();
```

The web entry also exports `describeWebBackendCapabilities(backend)` and
`isIndexedDBWebBackend(backend)`. The native entry keeps the web backend
setters, getters, and flush function as typed no-ops for shared code.

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
- `PlatformStorage`
- `PlatformScope`
- `WebBackendCapabilities`

`getCapabilities().writeBuffering` describes real per-mode durability:

- Native: Disk writes are buffered by the platform (`SharedPreferences.apply()` on Android, `NSUserDefaults` on iOS). Secure writes are buffered only when `setSecureWritesAsync(true)` is active on Android; iOS Keychain writes are synchronous.
- Web: buffering follows the configured backend; IndexedDB backends are buffered, localStorage backends are synchronous.

`describeWebBackendCapabilities(backend)` reports a backend's `buffered`, `flushable`, `closable`, and `subscribable` capabilities from the same typed contract used by the built-in backends.

The IndexedDB subpath exports `createIndexedDBBackend()` and `IndexedDBBackendOptions`.
