# Recipes

These examples cover the public features most apps reach for first.

## Persisted Preferences

```ts
import { createStorageItem, StorageScope } from "react-native-nitro-storage";

type Preferences = {
  theme: "system" | "light" | "dark";
  reduceMotion: boolean;
};

export const preferencesItem = createStorageItem<Preferences>({
  key: "preferences",
  scope: StorageScope.Disk,
  defaultValue: { theme: "system", reduceMotion: false },
  validate: (value): value is Preferences =>
    typeof value === "object" &&
    value !== null &&
    "theme" in value &&
    "reduceMotion" in value,
});
```

## Auth Tokens

```ts
import {
  AccessControl,
  createSecureAuthStorage,
} from "react-native-nitro-storage";

export const auth = createSecureAuthStorage(
  {
    accessToken: { ttlMs: 15 * 60 * 1000 },
    refreshToken: {
      accessControl: AccessControl.AfterFirstUnlockThisDeviceOnly,
    },
  },
  { namespace: "auth" },
);

auth.refreshToken.set("opaque-refresh-token");
```

## Feature Flags with Validation

```ts
type Flags = {
  newCheckout: boolean;
  paywallVariant: "control" | "variant-a" | "variant-b";
};

export const flagsItem = createStorageItem<Flags>({
  key: "remoteFlags",
  scope: StorageScope.Disk,
  defaultValue: { newCheckout: false, paywallVariant: "control" },
  validate: (value): value is Flags => {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const flags = value as Partial<Flags>;
    return (
      typeof flags.newCheckout === "boolean" &&
      (flags.paywallVariant === "control" ||
        flags.paywallVariant === "variant-a" ||
        flags.paywallVariant === "variant-b")
    );
  },
  onValidationError: () => ({ newCheckout: false, paywallVariant: "control" }),
});
```

## Biometric Secret

```ts
import {
  BiometricLevel,
  createStorageItem,
  StorageScope,
} from "react-native-nitro-storage";

export const vaultKeyItem = createStorageItem<string>({
  key: "vaultKey",
  scope: StorageScope.Secure,
  defaultValue: "",
  biometric: true,
  biometricLevel: BiometricLevel.BiometryOrPasscode,
});
```

## Multi-tenant State

```ts
function createTenantThemeItem(tenantId: string) {
  return createStorageItem({
    key: "theme",
    namespace: `tenant:${tenantId}`,
    scope: StorageScope.Disk,
    defaultValue: "system",
  });
}

storage.clearNamespace("tenant:42", StorageScope.Disk);
```

## Temporary OTP

```ts
export const otpItem = createStorageItem<string>({
  key: "otp",
  scope: StorageScope.Memory,
  defaultValue: "",
  expiration: { ttlMs: 2 * 60 * 1000 },
  onExpired: () => {
    showOtpExpiredMessage();
  },
});
```

## Bulk Bootstrap

```ts
const [preferences, flags] = getBatch(
  [preferencesItem, flagsItem],
  StorageScope.Disk,
);

setBatch(
  [
    { item: preferencesItem, value: { theme: "dark", reduceMotion: false } },
    {
      item: flagsItem,
      value: { newCheckout: true, paywallVariant: "variant-a" },
    },
  ],
  StorageScope.Disk,
);
```

## Transactional Balance Transfer

```ts
runTransaction(StorageScope.Disk, (tx) => {
  const from = tx.getItem(fromBalanceItem);

  if (from < 25) {
    throw new Error("Insufficient balance");
  }

  tx.setItem(fromBalanceItem, from - 25);
  tx.setItem(toBalanceItem, tx.getItem(toBalanceItem) + 25);
});
```

## Custom Codec

```ts
type CompactFlag = {
  id: number;
  active: boolean;
};

const compactFlagItem = createStorageItem<CompactFlag>({
  key: "compactFlag",
  scope: StorageScope.Disk,
  defaultValue: { id: 0, active: false },
  serialize: (value) => `${value.id}|${value.active ? "1" : "0"}`,
  deserialize: (value) => {
    const [id, active] = value.split("|");
    return { id: Number(id), active: active === "1" };
  },
});
```

## Coalesced Writes

```ts
const draftItem = createStorageItem({
  key: "draft",
  scope: StorageScope.Disk,
  defaultValue: "",
  coalesceDiskWrites: true,
});

draftItem.set("first edit");
draftItem.set("second edit");
storage.flushDiskWrites();
```

For Secure scope:

```ts
const tokenItem = createStorageItem({
  key: "token",
  scope: StorageScope.Secure,
  defaultValue: "",
  coalesceSecureWrites: true,
});

tokenItem.set("token");
storage.flushSecureWrites();
```

## Raw Import and Export

```ts
const snapshot = storage.export(StorageScope.Disk);

storage.import(snapshot, StorageScope.Disk);
```

Raw export/import reads and writes strings exactly as stored. It does not run item serializers. Secure exports contain raw secret values, so do not log them or attach them to diagnostics.

## Snapshot and Cleanup

```ts
const allDiskValues = storage.getAll(StorageScope.Disk);
const allDiskKeys = storage.getAllKeys(StorageScope.Disk);

storage.clearNamespace("settings", StorageScope.Disk);
```

## Prefix Inspection

```ts
const flagKeys = storage.getKeysByPrefix("flags:", StorageScope.Disk);
const flagValues = storage.getByPrefix("flags:", StorageScope.Disk);
```

## Optimistic Writes

```ts
const current = preferencesItem.getWithVersion();

const didWrite = preferencesItem.setIfVersion(current.version, {
  ...current.value,
  theme: "dark",
});
```

## Metrics

```ts
storage.setMetricsObserver((event) => {
  console.log(event.operation, event.scope, event.durationMs);
});

preferencesItem.get();

const snapshot = storage.getMetricsSnapshot();
storage.resetMetrics();
```

## Event Logging

```ts
const unsubscribe = storage.subscribePrefix(
  StorageScope.Disk,
  "settings:",
  (event) => {
    if (event.type === "batch") {
      console.log("settings changed", event.changes.length);
      return;
    }

    console.log(event.key, event.operation);
  },
);

storage.setEventObserver((event) => {
  if (event.scope !== StorageScope.Secure) {
    console.log(event.type, event.operation);
  }
});
```

Use `subscribePrefix()` or `subscribeNamespace()` for targeted integrations. Use `setEventObserver()` for devtools-style logging. Secure events can include raw secret values, so filter them out of logs.

## Capability Checks

```ts
const capabilities = storage.getCapabilities();
const security = storage.getSecurityCapabilities();

if (security.secureStorage !== "available") {
  console.warn("Secure storage is not available on this runtime");
}
```

## Low-level Raw API

```ts
storage.setString("raw-key", "raw-value", StorageScope.Disk);
const rawValue = storage.getString("raw-key", StorageScope.Disk);
storage.deleteString("raw-key", StorageScope.Disk);
```

Use raw APIs for migrations and integrations. Use `createStorageItem` for app state.
