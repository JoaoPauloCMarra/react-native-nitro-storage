# MMKV Migration

Use `migrateFromMMKV(mmkv, item, deleteAfterMigration?)` when an app already stores values with `react-native-mmkv` and you want to move one key at a time into Nitro Storage.

The helper reads in this order:

1. `mmkv.getString(key)`
2. `mmkv.getNumber(key)`
3. `mmkv.getBoolean(key)`

It writes through `item.set()`, so custom serialization, validation, TTL behavior, and listeners remain active.

## Basic Migration

```ts
import {
  createStorageItem,
  migrateFromMMKV,
  StorageScope,
} from "react-native-nitro-storage";
import { MMKV } from "react-native-mmkv";

const mmkv = new MMKV();

const usernameItem = createStorageItem({
  key: "username",
  scope: StorageScope.Disk,
  defaultValue: "",
});

const migrated = migrateFromMMKV(mmkv, usernameItem, true);
```

`migrated` is `true` when a value was found and written. The third argument deletes the MMKV key after a successful write.

## Type Conversion

MMKV numbers and booleans are converted through the target item's serializer.

```ts
const launchCountItem = createStorageItem({
  key: "launchCount",
  scope: StorageScope.Disk,
  defaultValue: 0,
});

migrateFromMMKV(mmkv, launchCountItem, true);
```

## Custom Serialized Values

```ts
type Settings = {
  compactMode: boolean;
};

const settingsItem = createStorageItem<Settings>({
  key: "settings",
  scope: StorageScope.Disk,
  defaultValue: { compactMode: false },
  serialize: JSON.stringify,
  deserialize: JSON.parse,
  validate: (value): value is Settings =>
    typeof value === "object" &&
    value !== null &&
    "compactMode" in value &&
    typeof value.compactMode === "boolean",
});

migrateFromMMKV(mmkv, settingsItem, true);
```

## Migration Strategy

- Migrate stable keys first: preferences, feature flags, and local settings.
- Keep secure credentials in Secure scope instead of moving them to Disk scope.
- Run migration once during startup, before components read the target item.
- Delete the MMKV key only after you have shipped and observed the migration path.

For larger data-shape upgrades, use the versioned migration APIs in [batch-transactions-migrations.md](batch-transactions-migrations.md).
