# Batch, Transactions, and Migrations

Use these APIs when a workflow touches several keys or needs a controlled upgrade path.

## Batch Reads

```ts
import {
  createStorageItem,
  getBatch,
  StorageScope,
} from "react-native-nitro-storage";

const themeItem = createStorageItem({
  key: "theme",
  scope: StorageScope.Disk,
  defaultValue: "system",
});

const localeItem = createStorageItem({
  key: "locale",
  scope: StorageScope.Disk,
  defaultValue: "en-US",
});

const [theme, locale] = getBatch([themeItem, localeItem], StorageScope.Disk);
```

All items in a batch must use the same scope.

## Batch Writes

```ts
import { setBatch, StorageScope } from "react-native-nitro-storage";

setBatch(
  [
    { item: themeItem, value: "dark" },
    { item: localeItem, value: "pt-BR" },
  ],
  StorageScope.Disk,
);
```

Memory-scope batch writes are two-phase: all values are written first, then listeners are notified. Items with validation or TTL fall back to per-item writes so those rules still run.

## Batch Removes

```ts
import { removeBatch, StorageScope } from "react-native-nitro-storage";

removeBatch([themeItem, localeItem], StorageScope.Disk);
```

## Raw Import

`storage.import(data, scope)` writes raw strings. It does not serialize values.

```ts
import { storage, StorageScope } from "react-native-nitro-storage";

storage.import(
  {
    "flags:newOnboarding": "true",
    "flags:paywall": "control",
  },
  StorageScope.Disk,
);
```

For Memory scope, import is atomic: all keys are written before listeners fire. For Disk and Secure, import delegates to native or web batch paths.

## Transactions

Use `runTransaction(scope, callback)` when several raw or item writes should roll back together if the callback throws.

```ts
import { runTransaction, StorageScope } from "react-native-nitro-storage";

const fromBalanceItem = createStorageItem({
  key: "account:from",
  scope: StorageScope.Disk,
  defaultValue: 100,
});

const toBalanceItem = createStorageItem({
  key: "account:to",
  scope: StorageScope.Disk,
  defaultValue: 0,
});

runTransaction(StorageScope.Disk, (tx) => {
  const from = tx.getItem(fromBalanceItem);

  if (from < 25) {
    throw new Error("Insufficient balance");
  }

  tx.setItem(fromBalanceItem, from - 25);
  tx.setItem(toBalanceItem, tx.getItem(toBalanceItem) + 25);
});
```

Transaction context methods:

- `getRaw(key)`
- `setRaw(key, value)`
- `removeRaw(key)`
- `getItem(item)`
- `setItem(item, value)`
- `removeItem(item)`

If the callback throws, Nitro Storage restores the keys it changed during that transaction.

## Migrations

Register migrations with monotonically increasing versions, then migrate a scope to the latest known version.

```ts
import {
  migrateToLatest,
  registerMigration,
  StorageScope,
} from "react-native-nitro-storage";

registerMigration(1, (ctx) => {
  const oldValue = ctx.getRaw("theme");
  if (oldValue === "black") {
    ctx.setRaw("theme", "dark");
  }
});

registerMigration(2, (ctx) => {
  const token = ctx.getRaw("token");
  if (token) {
    ctx.setRaw("auth:accessToken", token);
    ctx.removeRaw("token");
  }
});

migrateToLatest(StorageScope.Disk);
```

Migration context methods work with raw strings. Use item serializers manually when migrating structured data.

```ts
registerMigration(3, (ctx) => {
  const raw = ctx.getRaw("settings");
  if (!raw) {
    return;
  }

  const settings = JSON.parse(raw) as { mode?: string };
  ctx.setRaw(
    "settings",
    JSON.stringify({
      ...settings,
      theme: settings.mode ?? "system",
    }),
  );
});
```

## Prefix Queries and Cleanup

```ts
const keys = storage.getKeysByPrefix("tenant:42:", StorageScope.Disk);
const values = storage.getByPrefix("tenant:42:", StorageScope.Disk);

storage.clearNamespace("tenant:42", StorageScope.Disk);
```

Use namespaces for multi-account or tenant-specific state so cleanup is predictable.

## Optimistic Versioned Writes

```ts
const current = themeItem.getWithVersion();

const didWrite = themeItem.setIfVersion(
  current.version,
  current.value === "dark" ? "light" : "dark",
);
```

`setIfVersion()` returns `false` if another write changed the item after `getWithVersion()`.
