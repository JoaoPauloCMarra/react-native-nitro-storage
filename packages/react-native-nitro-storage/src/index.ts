import { NitroModules } from "react-native-nitro-modules";
import type { Storage } from "./Storage.nitro";
import { StorageScope, AccessControl, BiometricLevel } from "./Storage.types";
import {
  MIGRATION_VERSION_KEY,
  type StoredEnvelope,
  isStoredEnvelope,
  assertBatchScope,
  assertValidScope,
  decodeNativeBatchValue,
  serializeWithPrimitiveFastPath,
  deserializeWithPrimitiveFastPath,
  toVersionToken,
  prefixKey,
  isNamespaced,
} from "./internal";
import type {
  WebDiskStorageBackend,
  WebSecureStorageBackend,
} from "./web-storage-backend";
import {
  getStorageErrorCode,
  isLockedStorageErrorCode,
  type SecureStorageMetadata,
  type SecurityCapabilities,
  type StorageCapabilities,
  type StorageErrorCode,
} from "./storage-runtime";

export { StorageScope, AccessControl, BiometricLevel } from "./Storage.types";
export type { Storage } from "./Storage.nitro";
export { migrateFromMMKV } from "./migration";
export {
  getStorageErrorCode,
  type SecureStorageMetadata,
  type SecurityCapabilities,
  type StorageCapabilities,
  type StorageErrorCode,
} from "./storage-runtime";
export type {
  WebStorageBackend,
  WebStorageChangeEvent,
  WebStorageScope,
} from "./web-storage-backend";

export type Validator<T> = (value: unknown) => value is T;
export type ExpirationConfig = {
  ttlMs: number;
};
export type StorageVersion = string;
export type VersionedValue<T> = {
  value: T;
  version: StorageVersion;
};
export type StorageMetricsEvent = {
  operation: string;
  scope: StorageScope;
  durationMs: number;
  keysCount: number;
};
export type StorageMetricsObserver = (event: StorageMetricsEvent) => void;
export type StorageMetricSummary = {
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
};
export type MigrationContext = {
  scope: StorageScope;
  getRaw: (key: string) => string | undefined;
  setRaw: (key: string, value: string) => void;
  removeRaw: (key: string) => void;
};

export type Migration = (context: MigrationContext) => void;

export type TransactionContext = {
  scope: StorageScope;
  getRaw: (key: string) => string | undefined;
  setRaw: (key: string, value: string) => void;
  removeRaw: (key: string) => void;
  getItem: <T>(item: Pick<StorageItem<T>, "scope" | "key" | "get">) => T;
  setItem: <T>(
    item: Pick<StorageItem<T>, "scope" | "key" | "set">,
    value: T,
  ) => void;
  removeItem: (
    item: Pick<StorageItem<unknown>, "scope" | "key" | "delete">,
  ) => void;
};

type KeyListenerRegistry = Map<string, Set<() => void>>;
type RawBatchPathItem = {
  _hasValidation?: boolean;
  _hasExpiration?: boolean;
  _isBiometric?: boolean;
  _secureAccessControl?: AccessControl;
};

function asInternal<T>(item: StorageItem<T>): StorageItemInternal<T> {
  return item as StorageItemInternal<T>;
}

function isUpdater<T>(
  valueOrFn: T | ((prev: T) => T),
): valueOrFn is (prev: T) => T {
  return typeof valueOrFn === "function";
}

function typedKeys<K extends string, V>(record: Record<K, V>): K[] {
  return Object.keys(record) as K[];
}
type NonMemoryScope = StorageScope.Disk | StorageScope.Secure;
type PendingDiskWrite = {
  key: string;
  value: string | undefined;
};
type PendingSecureWrite = {
  key: string;
  value: string | undefined;
  accessControl?: AccessControl;
};

const registeredMigrations = new Map<number, Migration>();
const runMicrotask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (task: () => void) => {
        Promise.resolve().then(task);
      };
const now =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

let _storageModule: Storage | null = null;

function getStorageModule(): Storage {
  if (!_storageModule) {
    _storageModule = NitroModules.createHybridObject<Storage>("Storage");
  }
  return _storageModule;
}

const memoryStore = new Map<string, unknown>();
const memoryListeners: KeyListenerRegistry = new Map();
const scopedListeners = new Map<NonMemoryScope, KeyListenerRegistry>([
  [StorageScope.Disk, new Map()],
  [StorageScope.Secure, new Map()],
]);
const scopedUnsubscribers = new Map<NonMemoryScope, () => void>();
const scopedRawCache = new Map<NonMemoryScope, Map<string, string | undefined>>(
  [
    [StorageScope.Disk, new Map()],
    [StorageScope.Secure, new Map()],
  ],
);
const pendingDiskWrites = new Map<string, PendingDiskWrite>();
let diskFlushScheduled = false;
let diskWritesAsync = false;
const pendingSecureWrites = new Map<string, PendingSecureWrite>();
let secureFlushScheduled = false;
let secureDefaultAccessControl: AccessControl = AccessControl.WhenUnlocked;
let metricsObserver: StorageMetricsObserver | undefined;
const metricsCounters = new Map<
  string,
  { count: number; totalDurationMs: number; maxDurationMs: number }
>();
const nativeSecureBackend = "platform-secure-storage";

function recordMetric(
  operation: string,
  scope: StorageScope,
  durationMs: number,
  keysCount = 1,
): void {
  const existing = metricsCounters.get(operation);
  if (!existing) {
    metricsCounters.set(operation, {
      count: 1,
      totalDurationMs: durationMs,
      maxDurationMs: durationMs,
    });
  } else {
    existing.count += 1;
    existing.totalDurationMs += durationMs;
    existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs);
  }

  metricsObserver?.({
    operation,
    scope,
    durationMs,
    keysCount,
  });
}

function measureOperation<T>(
  operation: string,
  scope: StorageScope,
  fn: () => T,
  keysCount = 1,
): T {
  if (!metricsObserver) {
    return fn();
  }
  const start = now();
  try {
    return fn();
  } finally {
    recordMetric(operation, scope, now() - start, keysCount);
  }
}

function getScopedListeners(scope: NonMemoryScope): KeyListenerRegistry {
  return scopedListeners.get(scope)!;
}

function getScopeRawCache(
  scope: NonMemoryScope,
): Map<string, string | undefined> {
  return scopedRawCache.get(scope)!;
}

function cacheRawValue(
  scope: NonMemoryScope,
  key: string,
  value: string | undefined,
): void {
  getScopeRawCache(scope).set(key, value);
}

function readCachedRawValue(
  scope: NonMemoryScope,
  key: string,
): string | undefined {
  return getScopeRawCache(scope).get(key);
}

function hasCachedRawValue(scope: NonMemoryScope, key: string): boolean {
  return getScopeRawCache(scope).has(key);
}

function clearScopeRawCache(scope: NonMemoryScope): void {
  getScopeRawCache(scope).clear();
}

function notifyKeyListeners(registry: KeyListenerRegistry, key: string): void {
  const listeners = registry.get(key);
  if (listeners) {
    for (const listener of listeners) {
      listener();
    }
  }
}

function notifyAllListeners(registry: KeyListenerRegistry): void {
  for (const listeners of registry.values()) {
    for (const listener of listeners) {
      listener();
    }
  }
}

function addKeyListener(
  registry: KeyListenerRegistry,
  key: string,
  listener: () => void,
): () => void {
  let listeners = registry.get(key);
  if (!listeners) {
    listeners = new Set();
    registry.set(key, listeners);
  }
  listeners.add(listener);

  return () => {
    const scopedListeners = registry.get(key);
    if (!scopedListeners) {
      return;
    }
    scopedListeners.delete(listener);
    if (scopedListeners.size === 0) {
      registry.delete(key);
    }
  };
}

function readPendingSecureWrite(key: string): string | undefined {
  return pendingSecureWrites.get(key)?.value;
}

function readPendingDiskWrite(key: string): string | undefined {
  return pendingDiskWrites.get(key)?.value;
}

function hasPendingDiskWrite(key: string): boolean {
  return pendingDiskWrites.has(key);
}

function hasPendingSecureWrite(key: string): boolean {
  return pendingSecureWrites.has(key);
}

function clearPendingDiskWrite(key: string): void {
  pendingDiskWrites.delete(key);
}

function clearPendingSecureWrite(key: string): void {
  pendingSecureWrites.delete(key);
}

function flushDiskWrites(): void {
  diskFlushScheduled = false;

  if (pendingDiskWrites.size === 0) {
    return;
  }

  const writes = Array.from(pendingDiskWrites.values());
  pendingDiskWrites.clear();

  const keysToSet: string[] = [];
  const valuesToSet: string[] = [];
  const keysToRemove: string[] = [];

  writes.forEach(({ key, value }) => {
    if (value === undefined) {
      keysToRemove.push(key);
      return;
    }

    keysToSet.push(key);
    valuesToSet.push(value);
  });

  const storageModule = getStorageModule();
  if (keysToSet.length > 0) {
    storageModule.setBatch(keysToSet, valuesToSet, StorageScope.Disk);
  }
  if (keysToRemove.length > 0) {
    storageModule.removeBatch(keysToRemove, StorageScope.Disk);
  }
}

function flushSecureWrites(): void {
  secureFlushScheduled = false;

  if (pendingSecureWrites.size === 0) {
    return;
  }

  const writes = Array.from(pendingSecureWrites.values());
  pendingSecureWrites.clear();

  const groupedSetWrites = new Map<
    AccessControl,
    { keys: string[]; values: string[] }
  >();
  const keysToRemove: string[] = [];

  writes.forEach(({ key, value, accessControl }) => {
    if (value === undefined) {
      keysToRemove.push(key);
    } else {
      const resolvedAccessControl = accessControl ?? secureDefaultAccessControl;
      const existingGroup = groupedSetWrites.get(resolvedAccessControl);
      const group = existingGroup ?? { keys: [], values: [] };
      group.keys.push(key);
      group.values.push(value);
      if (!existingGroup) {
        groupedSetWrites.set(resolvedAccessControl, group);
      }
    }
  });

  const storageModule = getStorageModule();
  groupedSetWrites.forEach((group, accessControl) => {
    storageModule.setSecureAccessControl(accessControl);
    storageModule.setBatch(group.keys, group.values, StorageScope.Secure);
  });
  if (keysToRemove.length > 0) {
    storageModule.removeBatch(keysToRemove, StorageScope.Secure);
  }
}

function scheduleDiskWrite(key: string, value: string | undefined): void {
  pendingDiskWrites.set(key, { key, value });
  if (diskFlushScheduled) {
    return;
  }
  diskFlushScheduled = true;
  runMicrotask(flushDiskWrites);
}

function scheduleSecureWrite(
  key: string,
  value: string | undefined,
  accessControl?: AccessControl,
): void {
  const pendingWrite: PendingSecureWrite = { key, value };
  if (accessControl !== undefined) {
    pendingWrite.accessControl = accessControl;
  }
  pendingSecureWrites.set(key, pendingWrite);
  if (secureFlushScheduled) {
    return;
  }
  secureFlushScheduled = true;
  runMicrotask(flushSecureWrites);
}

function ensureNativeScopeSubscription(scope: NonMemoryScope): void {
  if (scopedUnsubscribers.has(scope)) {
    return;
  }

  const unsubscribe = getStorageModule().addOnChange(scope, (key, value) => {
    if (scope === StorageScope.Disk) {
      if (key === "") {
        pendingDiskWrites.clear();
      } else {
        clearPendingDiskWrite(key);
      }
    }

    if (scope === StorageScope.Secure) {
      if (key === "") {
        pendingSecureWrites.clear();
      } else {
        clearPendingSecureWrite(key);
      }
    }

    if (key === "") {
      clearScopeRawCache(scope);
      notifyAllListeners(getScopedListeners(scope));
      return;
    }

    cacheRawValue(scope, key, value);
    notifyKeyListeners(getScopedListeners(scope), key);
  });
  scopedUnsubscribers.set(scope, unsubscribe);
}

function maybeCleanupNativeScopeSubscription(scope: NonMemoryScope): void {
  const listeners = getScopedListeners(scope);
  if (listeners.size > 0) {
    return;
  }

  const unsubscribe = scopedUnsubscribers.get(scope);
  if (!unsubscribe) {
    return;
  }

  unsubscribe();
  scopedUnsubscribers.delete(scope);
}

function getRawValue(key: string, scope: StorageScope): string | undefined {
  assertValidScope(scope);
  if (scope === StorageScope.Memory) {
    const value = memoryStore.get(key);
    return typeof value === "string" ? value : undefined;
  }

  if (scope === StorageScope.Disk && hasPendingDiskWrite(key)) {
    return readPendingDiskWrite(key);
  }

  if (scope === StorageScope.Secure && hasPendingSecureWrite(key)) {
    return readPendingSecureWrite(key);
  }

  return getStorageModule().get(key, scope);
}

function setRawValue(key: string, value: string, scope: StorageScope): void {
  assertValidScope(scope);
  if (scope === StorageScope.Memory) {
    memoryStore.set(key, value);
    notifyKeyListeners(memoryListeners, key);
    return;
  }

  if (scope === StorageScope.Disk) {
    cacheRawValue(scope, key, value);
    if (diskWritesAsync) {
      scheduleDiskWrite(key, value);
      return;
    }

    flushDiskWrites();
    clearPendingDiskWrite(key);
  }

  if (scope === StorageScope.Secure) {
    flushSecureWrites();
    clearPendingSecureWrite(key);
    getStorageModule().setSecureAccessControl(secureDefaultAccessControl);
  }

  getStorageModule().set(key, value, scope);
  cacheRawValue(scope, key, value);
}

function removeRawValue(key: string, scope: StorageScope): void {
  assertValidScope(scope);
  if (scope === StorageScope.Memory) {
    memoryStore.delete(key);
    notifyKeyListeners(memoryListeners, key);
    return;
  }

  if (scope === StorageScope.Disk) {
    cacheRawValue(scope, key, undefined);
    if (diskWritesAsync) {
      scheduleDiskWrite(key, undefined);
      return;
    }

    flushDiskWrites();
    clearPendingDiskWrite(key);
  }

  if (scope === StorageScope.Secure) {
    flushSecureWrites();
    clearPendingSecureWrite(key);
  }

  getStorageModule().remove(key, scope);
  cacheRawValue(scope, key, undefined);
}

function readMigrationVersion(scope: StorageScope): number {
  const raw = getRawValue(MIGRATION_VERSION_KEY, scope);
  if (raw === undefined) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function writeMigrationVersion(scope: StorageScope, version: number): void {
  setRawValue(MIGRATION_VERSION_KEY, String(version), scope);
}

export const storage = {
  clear: (scope: StorageScope) => {
    measureOperation("storage:clear", scope, () => {
      if (scope === StorageScope.Memory) {
        memoryStore.clear();
        notifyAllListeners(memoryListeners);
        return;
      }

      if (scope === StorageScope.Disk) {
        flushDiskWrites();
        pendingDiskWrites.clear();
      }

      if (scope === StorageScope.Secure) {
        flushSecureWrites();
        pendingSecureWrites.clear();
      }

      clearScopeRawCache(scope);
      getStorageModule().clear(scope);
    });
  },
  clearAll: () => {
    measureOperation(
      "storage:clearAll",
      StorageScope.Memory,
      () => {
        storage.clear(StorageScope.Memory);
        storage.clear(StorageScope.Disk);
        storage.clear(StorageScope.Secure);
      },
      3,
    );
  },
  clearNamespace: (namespace: string, scope: StorageScope) => {
    measureOperation("storage:clearNamespace", scope, () => {
      assertValidScope(scope);
      if (scope === StorageScope.Memory) {
        for (const key of memoryStore.keys()) {
          if (isNamespaced(key, namespace)) {
            memoryStore.delete(key);
          }
        }
        notifyAllListeners(memoryListeners);
        return;
      }

      const keyPrefix = prefixKey(namespace, "");
      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }

      const scopeCache = getScopeRawCache(scope);
      for (const key of scopeCache.keys()) {
        if (isNamespaced(key, namespace)) {
          scopeCache.delete(key);
        }
      }
      getStorageModule().removeByPrefix(keyPrefix, scope);
    });
  },
  clearBiometric: () => {
    measureOperation("storage:clearBiometric", StorageScope.Secure, () => {
      getStorageModule().clearSecureBiometric();
    });
  },
  has: (key: string, scope: StorageScope): boolean => {
    return measureOperation("storage:has", scope, () => {
      assertValidScope(scope);
      if (scope === StorageScope.Memory) {
        return memoryStore.has(key);
      }
      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }
      return getStorageModule().has(key, scope);
    });
  },
  getAllKeys: (scope: StorageScope): string[] => {
    return measureOperation("storage:getAllKeys", scope, () => {
      assertValidScope(scope);
      if (scope === StorageScope.Memory) {
        return Array.from(memoryStore.keys());
      }
      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }
      return getStorageModule().getAllKeys(scope);
    });
  },
  getKeysByPrefix: (prefix: string, scope: StorageScope): string[] => {
    return measureOperation("storage:getKeysByPrefix", scope, () => {
      assertValidScope(scope);
      if (scope === StorageScope.Memory) {
        return Array.from(memoryStore.keys()).filter((key) =>
          key.startsWith(prefix),
        );
      }
      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }
      return getStorageModule().getKeysByPrefix(prefix, scope);
    });
  },
  getByPrefix: (
    prefix: string,
    scope: StorageScope,
  ): Record<string, string> => {
    return measureOperation("storage:getByPrefix", scope, () => {
      const result: Record<string, string> = {};
      const keys = storage.getKeysByPrefix(prefix, scope);
      if (keys.length === 0) {
        return result;
      }

      if (scope === StorageScope.Memory) {
        keys.forEach((key) => {
          const value = memoryStore.get(key);
          if (typeof value === "string") {
            result[key] = value;
          }
        });
        return result;
      }

      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }
      const values = getStorageModule().getBatch(keys, scope);
      keys.forEach((key, idx) => {
        const value = decodeNativeBatchValue(values[idx]);
        if (value !== undefined) {
          result[key] = value;
        }
      });
      return result;
    });
  },
  getAll: (scope: StorageScope): Record<string, string> => {
    return measureOperation("storage:getAll", scope, () => {
      assertValidScope(scope);
      const result: Record<string, string> = {};
      if (scope === StorageScope.Memory) {
        memoryStore.forEach((value, key) => {
          if (typeof value === "string") result[key] = value;
        });
        return result;
      }
      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }
      const keys = getStorageModule().getAllKeys(scope);
      if (keys.length === 0) return result;
      const values = getStorageModule().getBatch(keys, scope);
      keys.forEach((key, idx) => {
        const val = decodeNativeBatchValue(values[idx]);
        if (val !== undefined) result[key] = val;
      });
      return result;
    });
  },
  size: (scope: StorageScope): number => {
    return measureOperation("storage:size", scope, () => {
      assertValidScope(scope);
      if (scope === StorageScope.Memory) {
        return memoryStore.size;
      }
      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }
      return getStorageModule().size(scope);
    });
  },
  setAccessControl: (level: AccessControl) => {
    measureOperation("storage:setAccessControl", StorageScope.Secure, () => {
      secureDefaultAccessControl = level;
      getStorageModule().setSecureAccessControl(level);
    });
  },
  setSecureWritesAsync: (enabled: boolean) => {
    measureOperation(
      "storage:setSecureWritesAsync",
      StorageScope.Secure,
      () => {
        getStorageModule().setSecureWritesAsync(enabled);
      },
    );
  },
  setDiskWritesAsync: (enabled: boolean) => {
    measureOperation("storage:setDiskWritesAsync", StorageScope.Disk, () => {
      diskWritesAsync = enabled;
      if (!enabled) {
        flushDiskWrites();
      }
    });
  },
  flushDiskWrites: () => {
    measureOperation("storage:flushDiskWrites", StorageScope.Disk, () => {
      flushDiskWrites();
    });
  },
  flushSecureWrites: () => {
    measureOperation("storage:flushSecureWrites", StorageScope.Secure, () => {
      flushSecureWrites();
    });
  },
  setKeychainAccessGroup: (group: string) => {
    measureOperation(
      "storage:setKeychainAccessGroup",
      StorageScope.Secure,
      () => {
        getStorageModule().setKeychainAccessGroup(group);
      },
    );
  },
  setMetricsObserver: (observer?: StorageMetricsObserver) => {
    metricsObserver = observer;
  },
  getMetricsSnapshot: (): Record<string, StorageMetricSummary> => {
    const snapshot: Record<string, StorageMetricSummary> = {};
    metricsCounters.forEach((value, key) => {
      snapshot[key] = {
        count: value.count,
        totalDurationMs: value.totalDurationMs,
        avgDurationMs:
          value.count === 0 ? 0 : value.totalDurationMs / value.count,
        maxDurationMs: value.maxDurationMs,
      };
    });
    return snapshot;
  },
  resetMetrics: () => {
    metricsCounters.clear();
  },
  getCapabilities: (): StorageCapabilities => ({
    platform: "native",
    backend: {
      disk: "platform-preferences",
      secure: nativeSecureBackend,
    },
    writeBuffering: {
      disk: true,
      secure: true,
    },
    errorClassification: true,
  }),
  getSecurityCapabilities: (): SecurityCapabilities => ({
    platform: "native",
    secureStorage: {
      backend: nativeSecureBackend,
      encrypted: "available",
      accessControl: "unknown",
      keychainAccessGroup: "unknown",
      hardwareBacked: "unknown",
    },
    biometric: {
      storage: "unknown",
      prompt: "unknown",
      biometryOnly: "unknown",
      biometryOrPasscode: "unknown",
    },
    metadata: {
      perKey: true,
      listsWithoutValues: true,
      persistsTimestamps: false,
    },
  }),
  getSecureMetadata: (key: string): SecureStorageMetadata => {
    return measureOperation(
      "storage:getSecureMetadata",
      StorageScope.Secure,
      () => {
        flushSecureWrites();
        const storageModule = getStorageModule();
        const biometricProtected = storageModule.hasSecureBiometric(key);
        const exists =
          biometricProtected || storageModule.has(key, StorageScope.Secure);
        let kind: SecureStorageMetadata["kind"] = "missing";
        if (exists) {
          kind = biometricProtected ? "biometric" : "secure";
        }

        return {
          key,
          exists,
          kind,
          backend: nativeSecureBackend,
          encrypted: "available",
          hardwareBacked: "unknown",
          biometricProtected,
          valueExposed: false,
        };
      },
    );
  },
  getAllSecureMetadata: (): SecureStorageMetadata[] => {
    return measureOperation(
      "storage:getAllSecureMetadata",
      StorageScope.Secure,
      () => {
        flushSecureWrites();
        return getStorageModule()
          .getAllKeys(StorageScope.Secure)
          .map((key) => storage.getSecureMetadata(key));
      },
    );
  },
  getString: (key: string, scope: StorageScope): string | undefined => {
    return measureOperation("storage:getString", scope, () => {
      return getRawValue(key, scope);
    });
  },
  setString: (key: string, value: string, scope: StorageScope): void => {
    measureOperation("storage:setString", scope, () => {
      setRawValue(key, value, scope);
    });
  },
  deleteString: (key: string, scope: StorageScope): void => {
    measureOperation("storage:deleteString", scope, () => {
      removeRawValue(key, scope);
    });
  },
  import: (data: Record<string, string>, scope: StorageScope): void => {
    const keys = Object.keys(data);
    measureOperation(
      "storage:import",
      scope,
      () => {
        assertValidScope(scope);
        if (keys.length === 0) return;
        const values = keys.map((k) => data[k]!);

        if (scope === StorageScope.Memory) {
          keys.forEach((key, index) => {
            memoryStore.set(key, values[index]);
          });
          keys.forEach((key) => notifyKeyListeners(memoryListeners, key));
          return;
        }

        if (scope === StorageScope.Secure) {
          flushSecureWrites();
          getStorageModule().setSecureAccessControl(secureDefaultAccessControl);
        }

        getStorageModule().setBatch(keys, values, scope);
        keys.forEach((key, index) => cacheRawValue(scope, key, values[index]));
      },
      keys.length,
    );
  },
};

export function setWebSecureStorageBackend(
  _backend?: WebSecureStorageBackend,
): void {
  // Native platforms do not use web secure backends.
}

export function getWebSecureStorageBackend():
  | WebSecureStorageBackend
  | undefined {
  return undefined;
}

export function setWebDiskStorageBackend(
  _backend?: WebDiskStorageBackend,
): void {
  // Native platforms do not use web disk backends.
}

export function getWebDiskStorageBackend(): WebDiskStorageBackend | undefined {
  return undefined;
}

export async function flushWebStorageBackends(): Promise<void> {
  // Native platforms do not use web storage backends.
}

export interface StorageItemConfig<T> {
  key: string;
  scope: StorageScope;
  defaultValue?: T;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
  validate?: Validator<T>;
  onValidationError?: (invalidValue: unknown) => T;
  expiration?: ExpirationConfig;
  onExpired?: (key: string) => void;
  readCache?: boolean;
  coalesceDiskWrites?: boolean;
  coalesceSecureWrites?: boolean;
  namespace?: string;
  biometric?: boolean;
  biometricLevel?: BiometricLevel;
  accessControl?: AccessControl;
}

export interface StorageItem<T> {
  get: () => T;
  getWithVersion: () => VersionedValue<T>;
  set: (value: T | ((prev: T) => T)) => void;
  setIfVersion: (
    version: StorageVersion,
    value: T | ((prev: T) => T),
  ) => boolean;
  delete: () => void;
  has: () => boolean;
  subscribe: (callback: () => void) => () => void;
  serialize: (value: T) => string;
  deserialize: (value: string) => T;
  scope: StorageScope;
  key: string;
}

type StorageItemInternal<T> = StorageItem<T> & {
  _triggerListeners: () => void;
  _invalidateParsedCacheOnly: () => void;
  _hasValidation: boolean;
  _hasExpiration: boolean;
  _readCacheEnabled: boolean;
  _isBiometric: boolean;
  _defaultValue: T;
  _secureAccessControl?: AccessControl;
};

function canUseRawBatchPath(item: RawBatchPathItem): boolean {
  return (
    item._hasExpiration === false &&
    item._hasValidation === false &&
    item._isBiometric !== true &&
    item._secureAccessControl === undefined
  );
}

function canUseSecureRawBatchPath(item: RawBatchPathItem): boolean {
  return (
    item._hasExpiration === false &&
    item._hasValidation === false &&
    item._isBiometric !== true
  );
}

function defaultSerialize<T>(value: T): string {
  return serializeWithPrimitiveFastPath(value);
}

function defaultDeserialize<T>(value: string): T {
  return deserializeWithPrimitiveFastPath(value);
}

export function createStorageItem<T = undefined>(
  config: StorageItemConfig<T>,
): StorageItem<T> {
  const storageKey = prefixKey(config.namespace, config.key);
  const serialize = config.serialize ?? defaultSerialize;
  const deserialize = config.deserialize ?? defaultDeserialize;
  const isMemory = config.scope === StorageScope.Memory;
  const resolvedBiometricLevel =
    config.scope === StorageScope.Secure
      ? (config.biometricLevel ??
        (config.biometric === true
          ? BiometricLevel.BiometryOnly
          : BiometricLevel.None))
      : BiometricLevel.None;
  const isBiometric = resolvedBiometricLevel !== BiometricLevel.None;
  const secureAccessControl = config.accessControl;
  const validate = config.validate;
  const onValidationError = config.onValidationError;
  const expiration = config.expiration;
  const onExpired = config.onExpired;
  const expirationTtlMs = expiration?.ttlMs;
  const memoryExpiration =
    expiration && isMemory ? new Map<string, number>() : null;
  const readCache = !isMemory && config.readCache === true;
  const coalesceDiskWrites =
    config.scope === StorageScope.Disk && config.coalesceDiskWrites === true;
  const coalesceSecureWrites =
    config.scope === StorageScope.Secure &&
    config.coalesceSecureWrites === true &&
    !isBiometric;
  const defaultValue = config.defaultValue as T;
  const nonMemoryScope: NonMemoryScope | null =
    config.scope === StorageScope.Disk
      ? StorageScope.Disk
      : config.scope === StorageScope.Secure
        ? StorageScope.Secure
        : null;

  if (expiration && expiration.ttlMs <= 0) {
    throw new Error("expiration.ttlMs must be greater than 0.");
  }

  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  let lastRaw: unknown = undefined;
  let lastValue: T | undefined;
  let hasLastValue = false;
  let lastExpiresAt: number | null | undefined = undefined;

  const invalidateParsedCache = () => {
    lastRaw = undefined;
    lastValue = undefined;
    hasLastValue = false;
    lastExpiresAt = undefined;
  };

  const ensureSubscription = () => {
    if (unsubscribe) {
      return;
    }

    const listener = () => {
      invalidateParsedCache();
      listeners.forEach((callback) => callback());
    };

    if (isMemory) {
      unsubscribe = addKeyListener(memoryListeners, storageKey, listener);
      return;
    }

    ensureNativeScopeSubscription(nonMemoryScope!);
    unsubscribe = addKeyListener(
      getScopedListeners(nonMemoryScope!),
      storageKey,
      listener,
    );
  };

  const readStoredRaw = (): unknown => {
    if (isMemory) {
      if (memoryExpiration) {
        const expiresAt = memoryExpiration.get(storageKey);
        if (expiresAt !== undefined && expiresAt <= Date.now()) {
          memoryExpiration.delete(storageKey);
          memoryStore.delete(storageKey);
          notifyKeyListeners(memoryListeners, storageKey);
          onExpired?.(storageKey);
          return undefined;
        }
      }
      return memoryStore.get(storageKey);
    }

    if (nonMemoryScope === StorageScope.Disk) {
      const pending = pendingDiskWrites.get(storageKey);
      if (pending !== undefined) {
        return pending.value;
      }
    }

    if (nonMemoryScope === StorageScope.Secure && !isBiometric) {
      const pending = pendingSecureWrites.get(storageKey);
      if (pending !== undefined) {
        return pending.value;
      }
    }

    if (readCache) {
      const cache = getScopeRawCache(nonMemoryScope!);
      const cached = cache.get(storageKey);
      if (cached !== undefined || cache.has(storageKey)) {
        return cached;
      }
    }

    if (isBiometric) {
      return getStorageModule().getSecureBiometric(storageKey);
    }

    const raw = getStorageModule().get(storageKey, config.scope);
    cacheRawValue(nonMemoryScope!, storageKey, raw);
    return raw;
  };

  const writeStoredRaw = (rawValue: string): void => {
    if (isBiometric) {
      getStorageModule().setSecureBiometricWithLevel(
        storageKey,
        rawValue,
        resolvedBiometricLevel,
      );
      return;
    }

    cacheRawValue(nonMemoryScope!, storageKey, rawValue);

    if (nonMemoryScope === StorageScope.Disk) {
      if (coalesceDiskWrites || diskWritesAsync) {
        scheduleDiskWrite(storageKey, rawValue);
        return;
      }

      clearPendingDiskWrite(storageKey);
    }

    if (coalesceSecureWrites) {
      scheduleSecureWrite(
        storageKey,
        rawValue,
        secureAccessControl ?? secureDefaultAccessControl,
      );
      return;
    }

    if (nonMemoryScope === StorageScope.Secure) {
      clearPendingSecureWrite(storageKey);
      getStorageModule().setSecureAccessControl(
        secureAccessControl ?? secureDefaultAccessControl,
      );
    }

    getStorageModule().set(storageKey, rawValue, config.scope);
  };

  const removeStoredRaw = (): void => {
    if (isBiometric) {
      getStorageModule().deleteSecureBiometric(storageKey);
      return;
    }

    cacheRawValue(nonMemoryScope!, storageKey, undefined);

    if (nonMemoryScope === StorageScope.Disk) {
      if (coalesceDiskWrites || diskWritesAsync) {
        scheduleDiskWrite(storageKey, undefined);
        return;
      }

      clearPendingDiskWrite(storageKey);
    }

    if (coalesceSecureWrites) {
      scheduleSecureWrite(
        storageKey,
        undefined,
        secureAccessControl ?? secureDefaultAccessControl,
      );
      return;
    }

    if (nonMemoryScope === StorageScope.Secure) {
      clearPendingSecureWrite(storageKey);
    }

    getStorageModule().remove(storageKey, config.scope);
  };

  const writeValueWithoutValidation = (value: T): void => {
    if (isMemory) {
      if (memoryExpiration) {
        memoryExpiration.set(storageKey, Date.now() + (expirationTtlMs ?? 0));
      }
      memoryStore.set(storageKey, value);
      notifyKeyListeners(memoryListeners, storageKey);
      return;
    }

    const serialized = serialize(value);
    if (expiration) {
      const envelope: StoredEnvelope = {
        __nitroStorageEnvelope: true,
        expiresAt: Date.now() + expiration.ttlMs,
        payload: serialized,
      };
      writeStoredRaw(JSON.stringify(envelope));
      return;
    }

    writeStoredRaw(serialized);
  };

  const resolveInvalidValue = (invalidValue: unknown): T => {
    if (onValidationError) {
      return onValidationError(invalidValue);
    }

    return defaultValue;
  };

  const ensureValidatedValue = (
    candidate: unknown,
    hadStoredValue: boolean,
  ): T => {
    if (!validate || validate(candidate)) {
      return candidate as T;
    }

    const resolved = resolveInvalidValue(candidate);
    if (validate && !validate(resolved)) {
      return defaultValue;
    }
    if (hadStoredValue) {
      writeValueWithoutValidation(resolved);
    }
    return resolved;
  };

  const getInternal = (): T => {
    const raw = readStoredRaw();

    if (!memoryExpiration && raw === lastRaw && hasLastValue) {
      if (!expiration || lastExpiresAt === null) {
        return lastValue as T;
      }

      if (typeof lastExpiresAt === "number") {
        if (lastExpiresAt > Date.now()) {
          return lastValue as T;
        }

        removeStoredRaw();
        invalidateParsedCache();
        onExpired?.(storageKey);
        lastValue = ensureValidatedValue(defaultValue, false);
        hasLastValue = true;
        listeners.forEach((cb) => cb());
        return lastValue;
      }
    }

    lastRaw = raw;

    if (raw === undefined) {
      lastExpiresAt = undefined;
      lastValue = ensureValidatedValue(defaultValue, false);
      hasLastValue = true;
      return lastValue;
    }

    if (isMemory) {
      lastExpiresAt = undefined;
      lastValue = ensureValidatedValue(raw, true);
      hasLastValue = true;
      return lastValue;
    }

    if (typeof raw !== "string") {
      lastExpiresAt = undefined;
      lastValue = ensureValidatedValue(defaultValue, false);
      hasLastValue = true;
      return lastValue;
    }

    let deserializableRaw = raw;

    if (expiration) {
      let envelopeExpiresAt: number | null = null;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (isStoredEnvelope(parsed)) {
          envelopeExpiresAt = parsed.expiresAt;
          if (parsed.expiresAt <= Date.now()) {
            removeStoredRaw();
            invalidateParsedCache();
            onExpired?.(storageKey);
            lastValue = ensureValidatedValue(defaultValue, false);
            hasLastValue = true;
            listeners.forEach((cb) => cb());
            return lastValue;
          }

          deserializableRaw = parsed.payload;
        }
      } catch {
        // Keep backward compatibility with legacy raw values.
      }
      lastExpiresAt = envelopeExpiresAt;
    } else {
      lastExpiresAt = undefined;
    }

    lastValue = ensureValidatedValue(deserialize(deserializableRaw), true);
    hasLastValue = true;
    return lastValue;
  };

  const getCurrentVersion = (): StorageVersion => {
    const raw = readStoredRaw();
    return toVersionToken(raw);
  };

  const get = (): T =>
    measureOperation("item:get", config.scope, () => getInternal());

  const getWithVersion = (): VersionedValue<T> =>
    measureOperation("item:getWithVersion", config.scope, () => ({
      value: getInternal(),
      version: getCurrentVersion(),
    }));

  const set = (valueOrFn: T | ((prev: T) => T)): void => {
    measureOperation("item:set", config.scope, () => {
      const newValue = isUpdater(valueOrFn)
        ? valueOrFn(getInternal())
        : valueOrFn;

      if (validate && !validate(newValue)) {
        throw new Error(
          `Validation failed for key "${storageKey}" in scope "${StorageScope[config.scope]}".`,
        );
      }

      invalidateParsedCache();
      writeValueWithoutValidation(newValue);
    });
  };

  const setIfVersion = (
    version: StorageVersion,
    valueOrFn: T | ((prev: T) => T),
  ): boolean =>
    measureOperation("item:setIfVersion", config.scope, () => {
      const currentVersion = getCurrentVersion();
      if (currentVersion !== version) {
        return false;
      }
      set(valueOrFn);
      return true;
    });

  const deleteItem = (): void => {
    measureOperation("item:delete", config.scope, () => {
      invalidateParsedCache();

      if (isMemory) {
        if (memoryExpiration) {
          memoryExpiration.delete(storageKey);
        }
        memoryStore.delete(storageKey);
        notifyKeyListeners(memoryListeners, storageKey);
        return;
      }

      removeStoredRaw();
    });
  };

  const hasItem = (): boolean =>
    measureOperation("item:has", config.scope, () => {
      if (isMemory) return memoryStore.has(storageKey);
      if (isBiometric) return getStorageModule().hasSecureBiometric(storageKey);
      if (nonMemoryScope === StorageScope.Disk) {
        const pending = pendingDiskWrites.get(storageKey);
        if (pending !== undefined) {
          return pending.value !== undefined;
        }
      }
      if (nonMemoryScope === StorageScope.Secure) {
        const pending = pendingSecureWrites.get(storageKey);
        if (pending !== undefined) {
          return pending.value !== undefined;
        }
      }
      return getStorageModule().has(storageKey, config.scope);
    });

  const subscribe = (callback: () => void): (() => void) => {
    ensureSubscription();
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0 && unsubscribe) {
        unsubscribe();
        if (!isMemory) {
          maybeCleanupNativeScopeSubscription(nonMemoryScope!);
        }
        unsubscribe = null;
      }
    };
  };

  const storageItem: StorageItemInternal<T> = {
    get,
    getWithVersion,
    set,
    setIfVersion,
    delete: deleteItem,
    has: hasItem,
    subscribe,
    serialize,
    deserialize,
    _triggerListeners: () => {
      invalidateParsedCache();
      listeners.forEach((listener) => listener());
    },
    _invalidateParsedCacheOnly: () => {
      invalidateParsedCache();
    },
    _hasValidation: validate !== undefined,
    _hasExpiration: expiration !== undefined,
    _readCacheEnabled: readCache,
    _isBiometric: isBiometric,
    _defaultValue: defaultValue,
    ...(secureAccessControl !== undefined
      ? { _secureAccessControl: secureAccessControl }
      : {}),
    scope: config.scope,
    key: storageKey,
  };

  return storageItem;
}

export { useStorage, useStorageSelector, useSetStorage } from "./storage-hooks";
export { createIndexedDBBackend } from "./indexeddb-backend";

type BatchReadItem<T> = Pick<
  StorageItem<T>,
  "key" | "scope" | "get" | "deserialize"
> & {
  _hasValidation?: boolean;
  _hasExpiration?: boolean;
  _readCacheEnabled?: boolean;
  _isBiometric?: boolean;
  _defaultValue?: unknown;
  _secureAccessControl?: AccessControl;
};
type BatchRemoveItem = Pick<StorageItem<unknown>, "key" | "scope" | "delete">;

export type StorageBatchSetItem<T> = {
  item: StorageItem<T>;
  value: T;
};

export function getBatch(
  items: readonly BatchReadItem<unknown>[],
  scope: StorageScope,
): unknown[] {
  return measureOperation(
    "batch:get",
    scope,
    () => {
      assertBatchScope(items, scope);

      if (scope === StorageScope.Memory) {
        return items.map((item) => item.get());
      }

      const useRawBatchPath = items.every((item) =>
        scope === StorageScope.Secure
          ? canUseSecureRawBatchPath(item)
          : canUseRawBatchPath(item),
      );
      if (!useRawBatchPath) {
        return items.map((item) => item.get());
      }

      const rawValues = new Array<string | undefined>(items.length);
      const keysToFetch: string[] = [];
      const keyIndexes: number[] = [];

      items.forEach((item, index) => {
        if (scope === StorageScope.Disk) {
          const pending = pendingDiskWrites.get(item.key);
          if (pending !== undefined) {
            rawValues[index] = pending.value;
            return;
          }
        }

        if (scope === StorageScope.Secure) {
          const pending = pendingSecureWrites.get(item.key);
          if (pending !== undefined) {
            rawValues[index] = pending.value;
            return;
          }
        }

        if (item._readCacheEnabled === true) {
          const cache = getScopeRawCache(scope);
          const cached = cache.get(item.key);
          if (cached !== undefined || cache.has(item.key)) {
            rawValues[index] = cached;
            return;
          }
        }

        keysToFetch.push(item.key);
        keyIndexes.push(index);
      });

      if (keysToFetch.length > 0) {
        const fetchedValues = getStorageModule()
          .getBatch(keysToFetch, scope)
          .map((value) => decodeNativeBatchValue(value));

        fetchedValues.forEach((value, index) => {
          const key = keysToFetch[index];
          const targetIndex = keyIndexes[index];
          if (key === undefined || targetIndex === undefined) {
            return;
          }
          rawValues[targetIndex] = value;
          cacheRawValue(scope, key, value);
        });
      }

      return items.map((item, index) => {
        const raw = rawValues[index];
        if (raw === undefined) {
          return asInternal(item as StorageItem<unknown>)._defaultValue;
        }
        return item.deserialize(raw);
      });
    },
    items.length,
  );
}

export function setBatch<T>(
  items: readonly StorageBatchSetItem<T>[],
  scope: StorageScope,
): void {
  measureOperation(
    "batch:set",
    scope,
    () => {
      assertBatchScope(
        items.map((batchEntry) => batchEntry.item),
        scope,
      );

      if (scope === StorageScope.Memory) {
        // Determine if any item needs per-item handling (validation or TTL)
        const needsIndividualSets = items.some(({ item }) => {
          const internal = asInternal(item as StorageItem<unknown>);
          return internal._hasValidation || internal._hasExpiration;
        });

        if (needsIndividualSets) {
          // Fall back to individual sets to preserve validation and TTL semantics
          items.forEach(({ item, value }) => item.set(value));
          return;
        }

        // Atomic write: update all values in memoryStore, invalidate caches, then batch-notify
        items.forEach(({ item, value }) => {
          memoryStore.set(item.key, value);
          asInternal(item as StorageItem<unknown>)._invalidateParsedCacheOnly();
        });
        items.forEach(({ item }) =>
          notifyKeyListeners(memoryListeners, item.key),
        );
        return;
      }

      if (scope === StorageScope.Secure) {
        const secureEntries = items.map(({ item, value }) => ({
          item,
          value,
          internal: asInternal(item),
        }));
        const canUseSecureBatchPath = secureEntries.every(({ internal }) =>
          canUseSecureRawBatchPath(internal),
        );
        if (!canUseSecureBatchPath) {
          items.forEach(({ item, value }) => item.set(value));
          return;
        }

        flushSecureWrites();
        const storageModule = getStorageModule();
        const groupedByAccessControl = new Map<
          number,
          { keys: string[]; values: string[] }
        >();

        secureEntries.forEach(({ item, value, internal }) => {
          const accessControl =
            internal._secureAccessControl ?? secureDefaultAccessControl;
          const existingGroup = groupedByAccessControl.get(accessControl);
          const group = existingGroup ?? { keys: [], values: [] };
          group.keys.push(item.key);
          group.values.push(item.serialize(value));
          if (!existingGroup) {
            groupedByAccessControl.set(accessControl, group);
          }
        });

        groupedByAccessControl.forEach((group, accessControl) => {
          storageModule.setSecureAccessControl(accessControl);
          storageModule.setBatch(group.keys, group.values, scope);
          group.keys.forEach((key, index) =>
            cacheRawValue(scope, key, group.values[index]),
          );
        });
        return;
      }

      flushDiskWrites();

      const useRawBatchPath = items.every(({ item }) =>
        canUseRawBatchPath(asInternal(item)),
      );
      if (!useRawBatchPath) {
        items.forEach(({ item, value }) => item.set(value));
        return;
      }

      const keys = items.map((entry) => entry.item.key);
      const values = items.map((entry) => entry.item.serialize(entry.value));

      getStorageModule().setBatch(keys, values, scope);
      keys.forEach((key, index) => cacheRawValue(scope, key, values[index]));
    },
    items.length,
  );
}

export function removeBatch(
  items: readonly BatchRemoveItem[],
  scope: StorageScope,
): void {
  measureOperation(
    "batch:remove",
    scope,
    () => {
      assertBatchScope(items, scope);

      if (scope === StorageScope.Memory) {
        items.forEach((item) => item.delete());
        return;
      }

      const keys = items.map((item) => item.key);
      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }
      getStorageModule().removeBatch(keys, scope);
      keys.forEach((key) => cacheRawValue(scope, key, undefined));
    },
    items.length,
  );
}

export function registerMigration(version: number, migration: Migration): void {
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error("Migration version must be a positive integer.");
  }

  if (registeredMigrations.has(version)) {
    throw new Error(`Migration version ${version} is already registered.`);
  }

  registeredMigrations.set(version, migration);
}

export function migrateToLatest(
  scope: StorageScope = StorageScope.Disk,
): number {
  return measureOperation("migration:run", scope, () => {
    assertValidScope(scope);
    const currentVersion = readMigrationVersion(scope);
    const versions = Array.from(registeredMigrations.keys())
      .filter((version) => version > currentVersion)
      .sort((a, b) => a - b);

    let appliedVersion = currentVersion;
    const context: MigrationContext = {
      scope,
      getRaw: (key) => getRawValue(key, scope),
      setRaw: (key, value) => setRawValue(key, value, scope),
      removeRaw: (key) => removeRawValue(key, scope),
    };

    versions.forEach((version) => {
      const migration = registeredMigrations.get(version);
      if (!migration) {
        return;
      }
      migration(context);
      appliedVersion = version;
    });

    if (appliedVersion !== currentVersion) {
      writeMigrationVersion(scope, appliedVersion);
    }

    return appliedVersion;
  });
}

export function runTransaction<T>(
  scope: StorageScope,
  transaction: (context: TransactionContext) => T,
): T {
  return measureOperation("transaction:run", scope, () => {
    assertValidScope(scope);
    if (scope === StorageScope.Disk) {
      flushDiskWrites();
    }
    if (scope === StorageScope.Secure) {
      flushSecureWrites();
    }

    const NOT_SET = Symbol();
    const rollback = new Map<string, unknown>();

    const rememberRollback = (key: string) => {
      if (rollback.has(key)) {
        return;
      }
      if (scope === StorageScope.Memory) {
        rollback.set(
          key,
          memoryStore.has(key) ? memoryStore.get(key) : NOT_SET,
        );
      } else {
        rollback.set(key, getRawValue(key, scope));
      }
    };

    const tx: TransactionContext = {
      scope,
      getRaw: (key) => getRawValue(key, scope),
      setRaw: (key, value) => {
        rememberRollback(key);
        setRawValue(key, value, scope);
      },
      removeRaw: (key) => {
        rememberRollback(key);
        removeRawValue(key, scope);
      },
      getItem: (item) => {
        assertBatchScope([item], scope);
        return item.get();
      },
      setItem: (item, value) => {
        assertBatchScope([item], scope);
        rememberRollback(item.key);
        item.set(value);
      },
      removeItem: (item) => {
        assertBatchScope([item], scope);
        rememberRollback(item.key);
        item.delete();
      },
    };

    try {
      return transaction(tx);
    } catch (error) {
      const rollbackEntries = Array.from(rollback.entries()).reverse();
      if (scope === StorageScope.Memory) {
        rollbackEntries.forEach(([key, previousValue]) => {
          if (previousValue === NOT_SET) {
            memoryStore.delete(key);
          } else {
            memoryStore.set(key, previousValue);
          }
          notifyKeyListeners(memoryListeners, key);
        });
      } else {
        const keysToSet: string[] = [];
        const valuesToSet: string[] = [];
        const keysToRemove: string[] = [];

        rollbackEntries.forEach(([key, previousValue]) => {
          if (previousValue === undefined) {
            keysToRemove.push(key);
          } else {
            keysToSet.push(key);
            valuesToSet.push(previousValue as string);
          }
        });

        if (scope === StorageScope.Disk) {
          flushDiskWrites();
        }
        if (scope === StorageScope.Secure) {
          flushSecureWrites();
        }
        if (keysToSet.length > 0) {
          getStorageModule().setBatch(keysToSet, valuesToSet, scope);
          keysToSet.forEach((key, index) =>
            cacheRawValue(scope, key, valuesToSet[index]),
          );
        }
        if (keysToRemove.length > 0) {
          getStorageModule().removeBatch(keysToRemove, scope);
          keysToRemove.forEach((key) => cacheRawValue(scope, key, undefined));
        }
      }
      throw error;
    }
  });
}

export type SecureAuthStorageConfig<K extends string = string> = Record<
  K,
  {
    ttlMs?: number;
    biometric?: boolean;
    biometricLevel?: BiometricLevel;
    accessControl?: AccessControl;
  }
>;

export function isKeychainLockedError(err: unknown): boolean {
  return isLockedStorageErrorCode(getStorageErrorCode(err));
}

export function createSecureAuthStorage<K extends string>(
  config: SecureAuthStorageConfig<K>,
  options?: { namespace?: string },
): Record<K, StorageItem<string>> {
  const ns = options?.namespace ?? "auth";
  const result: Partial<Record<K, StorageItem<string>>> = {};

  for (const key of typedKeys(config)) {
    const itemConfig = config[key];
    const expirationConfig =
      itemConfig.ttlMs !== undefined ? { ttlMs: itemConfig.ttlMs } : undefined;
    result[key] = createStorageItem<string>({
      key,
      scope: StorageScope.Secure,
      defaultValue: "",
      namespace: ns,
      ...(itemConfig.biometric !== undefined
        ? { biometric: itemConfig.biometric }
        : {}),
      ...(itemConfig.biometricLevel !== undefined
        ? { biometricLevel: itemConfig.biometricLevel }
        : {}),
      ...(itemConfig.accessControl !== undefined
        ? { accessControl: itemConfig.accessControl }
        : {}),
      ...(expirationConfig !== undefined
        ? { expiration: expirationConfig }
        : {}),
    });
  }

  return result as Record<K, StorageItem<string>>;
}
