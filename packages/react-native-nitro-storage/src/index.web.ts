import { useRef, useSyncExternalStore } from "react";
import { StorageScope, AccessControl, BiometricLevel } from "./Storage.types";
import {
  MIGRATION_VERSION_KEY,
  type StoredEnvelope,
  isStoredEnvelope,
  assertBatchScope,
  assertValidScope,
  serializeWithPrimitiveFastPath,
  deserializeWithPrimitiveFastPath,
  prefixKey,
  isNamespaced,
} from "./internal";

export { StorageScope, AccessControl, BiometricLevel } from "./Storage.types";
export { migrateFromMMKV } from "./migration";

export type Validator<T> = (value: unknown) => value is T;
export type ExpirationConfig = {
  ttlMs: number;
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

function asInternal(item: StorageItem<any>): StorageItemInternal<any> {
  return item as unknown as StorageItemInternal<any>;
}
type NonMemoryScope = StorageScope.Disk | StorageScope.Secure;
type PendingSecureWrite = { key: string; value: string | undefined };
type BrowserStorageLike = {
  setItem: (key: string, value: string) => void;
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  clear: () => void;
  key: (index: number) => string | null;
  readonly length: number;
};

const registeredMigrations = new Map<number, Migration>();
const runMicrotask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (task: () => void) => {
        Promise.resolve().then(task);
      };

export interface Storage {
  name: string;
  equals: (other: unknown) => boolean;
  dispose: () => void;
  set(key: string, value: string, scope: number): void;
  get(key: string, scope: number): string | undefined;
  remove(key: string, scope: number): void;
  clear(scope: number): void;
  has(key: string, scope: number): boolean;
  getAllKeys(scope: number): string[];
  size(scope: number): number;
  setBatch(keys: string[], values: string[], scope: number): void;
  getBatch(keys: string[], scope: number): (string | undefined)[];
  removeBatch(keys: string[], scope: number): void;
  addOnChange(
    scope: number,
    callback: (key: string, value: string | undefined) => void,
  ): () => void;
  setSecureAccessControl(level: number): void;
  setKeychainAccessGroup(group: string): void;
  setSecureBiometric(key: string, value: string): void;
  getSecureBiometric(key: string): string | undefined;
  deleteSecureBiometric(key: string): void;
  hasSecureBiometric(key: string): boolean;
  clearSecureBiometric(): void;
}

const memoryStore = new Map<string, unknown>();
const memoryListeners: KeyListenerRegistry = new Map();
const webScopeListeners = new Map<NonMemoryScope, KeyListenerRegistry>([
  [StorageScope.Disk, new Map()],
  [StorageScope.Secure, new Map()],
]);
const scopedRawCache = new Map<NonMemoryScope, Map<string, string | undefined>>(
  [
    [StorageScope.Disk, new Map()],
    [StorageScope.Secure, new Map()],
  ],
);
const pendingSecureWrites = new Map<string, PendingSecureWrite>();
let secureFlushScheduled = false;
const SECURE_WEB_PREFIX = "__secure_";
const BIOMETRIC_WEB_PREFIX = "__bio_";
let hasWarnedAboutWebBiometricFallback = false;

function getBrowserStorage(scope: number): BrowserStorageLike | undefined {
  if (scope === StorageScope.Disk) {
    return globalThis.localStorage;
  }
  if (scope === StorageScope.Secure) {
    return globalThis.localStorage;
  }
  return undefined;
}

function toSecureStorageKey(key: string): string {
  return `${SECURE_WEB_PREFIX}${key}`;
}

function fromSecureStorageKey(key: string): string {
  return key.slice(SECURE_WEB_PREFIX.length);
}

function toBiometricStorageKey(key: string): string {
  return `${BIOMETRIC_WEB_PREFIX}${key}`;
}

function fromBiometricStorageKey(key: string): string {
  return key.slice(BIOMETRIC_WEB_PREFIX.length);
}

function getScopedListeners(scope: NonMemoryScope): KeyListenerRegistry {
  return webScopeListeners.get(scope)!;
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
  registry.get(key)?.forEach((listener) => listener());
}

function notifyAllListeners(registry: KeyListenerRegistry): void {
  registry.forEach((listeners) => {
    listeners.forEach((listener) => listener());
  });
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

function hasPendingSecureWrite(key: string): boolean {
  return pendingSecureWrites.has(key);
}

function clearPendingSecureWrite(key: string): void {
  pendingSecureWrites.delete(key);
}

function flushSecureWrites(): void {
  secureFlushScheduled = false;

  if (pendingSecureWrites.size === 0) {
    return;
  }

  const writes = Array.from(pendingSecureWrites.values());
  pendingSecureWrites.clear();

  const keysToSet: string[] = [];
  const valuesToSet: string[] = [];
  const keysToRemove: string[] = [];

  writes.forEach(({ key, value }) => {
    if (value === undefined) {
      keysToRemove.push(key);
    } else {
      keysToSet.push(key);
      valuesToSet.push(value);
    }
  });

  if (keysToSet.length > 0) {
    WebStorage.setBatch(keysToSet, valuesToSet, StorageScope.Secure);
  }
  if (keysToRemove.length > 0) {
    WebStorage.removeBatch(keysToRemove, StorageScope.Secure);
  }
}

function scheduleSecureWrite(key: string, value: string | undefined): void {
  pendingSecureWrites.set(key, { key, value });
  if (secureFlushScheduled) {
    return;
  }
  secureFlushScheduled = true;
  runMicrotask(flushSecureWrites);
}

const WebStorage: Storage = {
  name: "Storage",
  equals: (other) => other === WebStorage,
  dispose: () => {},
  set: (key: string, value: string, scope: number) => {
    const storage = getBrowserStorage(scope);
    if (!storage) {
      return;
    }
    const storageKey =
      scope === StorageScope.Secure ? toSecureStorageKey(key) : key;
    storage.setItem(storageKey, value);
    if (scope === StorageScope.Disk || scope === StorageScope.Secure) {
      notifyKeyListeners(getScopedListeners(scope), key);
    }
  },
  get: (key: string, scope: number) => {
    const storage = getBrowserStorage(scope);
    const storageKey =
      scope === StorageScope.Secure ? toSecureStorageKey(key) : key;
    return storage?.getItem(storageKey) ?? undefined;
  },
  remove: (key: string, scope: number) => {
    const storage = getBrowserStorage(scope);
    if (!storage) {
      return;
    }
    if (scope === StorageScope.Secure) {
      storage.removeItem(toSecureStorageKey(key));
      storage.removeItem(toBiometricStorageKey(key));
    } else {
      storage.removeItem(key);
    }
    if (scope === StorageScope.Disk || scope === StorageScope.Secure) {
      notifyKeyListeners(getScopedListeners(scope), key);
    }
  },
  clear: (scope: number) => {
    const storage = getBrowserStorage(scope);
    if (!storage) {
      return;
    }
    if (scope === StorageScope.Secure) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (
          key?.startsWith(SECURE_WEB_PREFIX) ||
          key?.startsWith(BIOMETRIC_WEB_PREFIX)
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => storage.removeItem(key));
    } else if (scope === StorageScope.Disk) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (
          key &&
          !key.startsWith(SECURE_WEB_PREFIX) &&
          !key.startsWith(BIOMETRIC_WEB_PREFIX)
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => storage.removeItem(key));
    } else {
      storage.clear();
    }
    if (scope === StorageScope.Disk || scope === StorageScope.Secure) {
      notifyAllListeners(getScopedListeners(scope));
    }
  },
  setBatch: (keys: string[], values: string[], scope: number) => {
    const storage = getBrowserStorage(scope);
    if (!storage) {
      return;
    }

    keys.forEach((key, index) => {
      const storageKey =
        scope === StorageScope.Secure ? toSecureStorageKey(key) : key;
      storage.setItem(storageKey, values[index]);
    });
    if (scope === StorageScope.Disk || scope === StorageScope.Secure) {
      const listeners = getScopedListeners(scope);
      keys.forEach((key) => notifyKeyListeners(listeners, key));
    }
  },
  getBatch: (keys: string[], scope: number) => {
    const storage = getBrowserStorage(scope);
    return keys.map((key) => {
      const storageKey =
        scope === StorageScope.Secure ? toSecureStorageKey(key) : key;
      return storage?.getItem(storageKey) ?? undefined;
    });
  },
  removeBatch: (keys: string[], scope: number) => {
    keys.forEach((key) => {
      WebStorage.remove(key, scope);
    });
  },
  addOnChange: (
    _scope: number,
    _callback: (key: string, value: string | undefined) => void,
  ) => {
    return () => {};
  },
  has: (key: string, scope: number) => {
    const storage = getBrowserStorage(scope);
    if (scope === StorageScope.Secure) {
      return (
        storage?.getItem(toSecureStorageKey(key)) !== null ||
        storage?.getItem(toBiometricStorageKey(key)) !== null
      );
    }
    return storage?.getItem(key) !== null;
  },
  getAllKeys: (scope: number) => {
    const storage = getBrowserStorage(scope);
    if (!storage) return [];
    const keys = new Set<string>();
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k) {
        continue;
      }
      if (scope === StorageScope.Secure) {
        if (k.startsWith(SECURE_WEB_PREFIX)) {
          keys.add(fromSecureStorageKey(k));
        } else if (k.startsWith(BIOMETRIC_WEB_PREFIX)) {
          keys.add(fromBiometricStorageKey(k));
        }
        continue;
      }
      if (
        k.startsWith(SECURE_WEB_PREFIX) ||
        k.startsWith(BIOMETRIC_WEB_PREFIX)
      ) {
        continue;
      }
      keys.add(k);
    }
    return Array.from(keys);
  },
  size: (scope: number) => {
    return WebStorage.getAllKeys(scope).length;
  },
  setSecureAccessControl: () => {},
  setKeychainAccessGroup: () => {},
  setSecureBiometric: (key: string, value: string) => {
    if (
      typeof __DEV__ !== "undefined" &&
      __DEV__ &&
      !hasWarnedAboutWebBiometricFallback
    ) {
      hasWarnedAboutWebBiometricFallback = true;
      console.warn(
        "[NitroStorage] Biometric storage is not supported on web. Using localStorage.",
      );
    }
    globalThis.localStorage?.setItem(toBiometricStorageKey(key), value);
    notifyKeyListeners(getScopedListeners(StorageScope.Secure), key);
  },
  getSecureBiometric: (key: string) => {
    return (
      globalThis.localStorage?.getItem(toBiometricStorageKey(key)) ?? undefined
    );
  },
  deleteSecureBiometric: (key: string) => {
    globalThis.localStorage?.removeItem(toBiometricStorageKey(key));
    notifyKeyListeners(getScopedListeners(StorageScope.Secure), key);
  },
  hasSecureBiometric: (key: string) => {
    return (
      globalThis.localStorage?.getItem(toBiometricStorageKey(key)) !== null
    );
  },
  clearSecureBiometric: () => {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const keysToNotify: string[] = [];
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(BIOMETRIC_WEB_PREFIX)) {
        toRemove.push(k);
        keysToNotify.push(fromBiometricStorageKey(k));
      }
    }
    toRemove.forEach((k) => storage.removeItem(k));
    const listeners = getScopedListeners(StorageScope.Secure);
    keysToNotify.forEach((key) => notifyKeyListeners(listeners, key));
  },
};

function getRawValue(key: string, scope: StorageScope): string | undefined {
  assertValidScope(scope);
  if (scope === StorageScope.Memory) {
    const value = memoryStore.get(key);
    return typeof value === "string" ? value : undefined;
  }

  if (scope === StorageScope.Secure && hasPendingSecureWrite(key)) {
    return readPendingSecureWrite(key);
  }

  return WebStorage.get(key, scope);
}

function setRawValue(key: string, value: string, scope: StorageScope): void {
  assertValidScope(scope);
  if (scope === StorageScope.Memory) {
    memoryStore.set(key, value);
    notifyKeyListeners(memoryListeners, key);
    return;
  }

  if (scope === StorageScope.Secure) {
    flushSecureWrites();
    clearPendingSecureWrite(key);
  }

  WebStorage.set(key, value, scope);
  cacheRawValue(scope, key, value);
}

function removeRawValue(key: string, scope: StorageScope): void {
  assertValidScope(scope);
  if (scope === StorageScope.Memory) {
    memoryStore.delete(key);
    notifyKeyListeners(memoryListeners, key);
    return;
  }

  if (scope === StorageScope.Secure) {
    flushSecureWrites();
    clearPendingSecureWrite(key);
  }

  WebStorage.remove(key, scope);
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
    if (scope === StorageScope.Memory) {
      memoryStore.clear();
      notifyAllListeners(memoryListeners);
      return;
    }

    if (scope === StorageScope.Secure) {
      flushSecureWrites();
      pendingSecureWrites.clear();
    }

    clearScopeRawCache(scope);
    WebStorage.clear(scope);
    if (scope === StorageScope.Secure) {
      WebStorage.clearSecureBiometric();
    }
  },
  clearAll: () => {
    storage.clear(StorageScope.Memory);
    storage.clear(StorageScope.Disk);
    storage.clear(StorageScope.Secure);
  },
  clearNamespace: (namespace: string, scope: StorageScope) => {
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
    if (scope === StorageScope.Secure) {
      flushSecureWrites();
    }
    const keys = WebStorage.getAllKeys(scope);
    const namespacedKeys = keys.filter((k) => isNamespaced(k, namespace));
    if (namespacedKeys.length > 0) {
      WebStorage.removeBatch(namespacedKeys, scope);
      namespacedKeys.forEach((k) => cacheRawValue(scope, k, undefined));
      if (scope === StorageScope.Secure) {
        namespacedKeys.forEach((k) => clearPendingSecureWrite(k));
      }
    }
  },
  clearBiometric: () => {
    WebStorage.clearSecureBiometric();
  },
  has: (key: string, scope: StorageScope): boolean => {
    assertValidScope(scope);
    if (scope === StorageScope.Memory) return memoryStore.has(key);
    return WebStorage.has(key, scope);
  },
  getAllKeys: (scope: StorageScope): string[] => {
    assertValidScope(scope);
    if (scope === StorageScope.Memory) return Array.from(memoryStore.keys());
    return WebStorage.getAllKeys(scope);
  },
  getAll: (scope: StorageScope): Record<string, string> => {
    assertValidScope(scope);
    const result: Record<string, string> = {};
    if (scope === StorageScope.Memory) {
      memoryStore.forEach((value, key) => {
        if (typeof value === "string") result[key] = value;
      });
      return result;
    }
    const keys = WebStorage.getAllKeys(scope);
    keys.forEach((key) => {
      const val = WebStorage.get(key, scope);
      if (val !== undefined) result[key] = val;
    });
    return result;
  },
  size: (scope: StorageScope): number => {
    assertValidScope(scope);
    if (scope === StorageScope.Memory) return memoryStore.size;
    return WebStorage.size(scope);
  },
  setAccessControl: (_level: AccessControl) => {},
  setKeychainAccessGroup: (_group: string) => {},
};

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
  coalesceSecureWrites?: boolean;
  namespace?: string;
  biometric?: boolean;
  accessControl?: AccessControl;
}

export interface StorageItem<T> {
  get: () => T;
  set: (value: T | ((prev: T) => T)) => void;
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
  _hasValidation: boolean;
  _hasExpiration: boolean;
  _readCacheEnabled: boolean;
  _isBiometric: boolean;
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
  const isBiometric =
    config.biometric === true && config.scope === StorageScope.Secure;
  const secureAccessControl = config.accessControl;
  const validate = config.validate;
  const onValidationError = config.onValidationError;
  const expiration = config.expiration;
  const onExpired = config.onExpired;
  const expirationTtlMs = expiration?.ttlMs;
  const memoryExpiration =
    expiration && isMemory ? new Map<string, number>() : null;
  const readCache = !isMemory && config.readCache === true;
  const coalesceSecureWrites =
    config.scope === StorageScope.Secure &&
    config.coalesceSecureWrites === true &&
    !isBiometric &&
    secureAccessControl === undefined;
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

  const invalidateParsedCache = () => {
    lastRaw = undefined;
    lastValue = undefined;
    hasLastValue = false;
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
      return memoryStore.get(storageKey) as T | undefined;
    }

    if (
      nonMemoryScope === StorageScope.Secure &&
      !isBiometric &&
      hasPendingSecureWrite(storageKey)
    ) {
      return readPendingSecureWrite(storageKey);
    }

    if (readCache) {
      if (hasCachedRawValue(nonMemoryScope!, storageKey)) {
        return readCachedRawValue(nonMemoryScope!, storageKey);
      }
    }

    if (isBiometric) {
      return WebStorage.getSecureBiometric(storageKey);
    }

    const raw = WebStorage.get(storageKey, config.scope);
    cacheRawValue(nonMemoryScope!, storageKey, raw);
    return raw;
  };

  const writeStoredRaw = (rawValue: string): void => {
    if (isBiometric) {
      WebStorage.setSecureBiometric(storageKey, rawValue);
      return;
    }

    cacheRawValue(nonMemoryScope!, storageKey, rawValue);

    if (coalesceSecureWrites) {
      scheduleSecureWrite(storageKey, rawValue);
      return;
    }

    if (nonMemoryScope === StorageScope.Secure) {
      clearPendingSecureWrite(storageKey);
    }

    WebStorage.set(storageKey, rawValue, config.scope);
  };

  const removeStoredRaw = (): void => {
    if (isBiometric) {
      WebStorage.deleteSecureBiometric(storageKey);
      return;
    }

    cacheRawValue(nonMemoryScope!, storageKey, undefined);

    if (coalesceSecureWrites) {
      scheduleSecureWrite(storageKey, undefined);
      return;
    }

    if (nonMemoryScope === StorageScope.Secure) {
      clearPendingSecureWrite(storageKey);
    }

    WebStorage.remove(storageKey, config.scope);
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

    return config.defaultValue as T;
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
      return config.defaultValue as T;
    }
    if (hadStoredValue) {
      writeValueWithoutValidation(resolved);
    }
    return resolved;
  };

  const get = (): T => {
    const raw = readStoredRaw();

    const canUseCachedValue = !expiration && !memoryExpiration;
    if (canUseCachedValue && raw === lastRaw && hasLastValue) {
      return lastValue as T;
    }

    lastRaw = raw;

    if (raw === undefined) {
      lastValue = ensureValidatedValue(config.defaultValue, false);
      hasLastValue = true;
      return lastValue;
    }

    if (isMemory) {
      lastValue = ensureValidatedValue(raw, true);
      hasLastValue = true;
      return lastValue;
    }

    let deserializableRaw = raw as string;

    if (expiration) {
      try {
        const parsed = JSON.parse(raw as string) as unknown;
        if (isStoredEnvelope(parsed)) {
          if (parsed.expiresAt <= Date.now()) {
            removeStoredRaw();
            invalidateParsedCache();
            onExpired?.(storageKey);
            lastValue = ensureValidatedValue(config.defaultValue, false);
            hasLastValue = true;
            return lastValue;
          }

          deserializableRaw = parsed.payload;
        }
      } catch {
        // Keep backward compatibility with legacy raw values.
      }
    }

    lastValue = ensureValidatedValue(deserialize(deserializableRaw), true);
    hasLastValue = true;
    return lastValue;
  };

  const set = (valueOrFn: T | ((prev: T) => T)): void => {
    const currentValue = get();
    const newValue =
      typeof valueOrFn === "function"
        ? (valueOrFn as (prev: T) => T)(currentValue)
        : valueOrFn;

    invalidateParsedCache();

    if (validate && !validate(newValue)) {
      throw new Error(
        `Validation failed for key "${storageKey}" in scope "${StorageScope[config.scope]}".`,
      );
    }

    writeValueWithoutValidation(newValue);
  };

  const deleteItem = (): void => {
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
  };

  const hasItem = (): boolean => {
    if (isMemory) return memoryStore.has(storageKey);
    if (isBiometric) return WebStorage.hasSecureBiometric(storageKey);
    return WebStorage.has(storageKey, config.scope);
  };

  const subscribe = (callback: () => void): (() => void) => {
    ensureSubscription();
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0 && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
  };

  const storageItem: StorageItemInternal<T> = {
    get,
    set,
    delete: deleteItem,
    has: hasItem,
    subscribe,
    serialize,
    deserialize,
    _triggerListeners: () => {
      invalidateParsedCache();
      listeners.forEach((listener) => listener());
    },
    _hasValidation: validate !== undefined,
    _hasExpiration: expiration !== undefined,
    _readCacheEnabled: readCache,
    _isBiometric: isBiometric,
    _secureAccessControl: secureAccessControl,
    scope: config.scope,
    key: storageKey,
  };

  return storageItem as StorageItem<T>;
}

export function useStorage<T>(
  item: StorageItem<T>,
): [T, (value: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(item.subscribe, item.get, item.get);
  return [value, item.set];
}

export function useStorageSelector<T, TSelected>(
  item: StorageItem<T>,
  selector: (value: T) => TSelected,
  isEqual: (prev: TSelected, next: TSelected) => boolean = Object.is,
): [TSelected, (value: T | ((prev: T) => T)) => void] {
  const selectedRef = useRef<
    { hasValue: false } | { hasValue: true; value: TSelected }
  >({
    hasValue: false,
  });

  const getSelectedSnapshot = () => {
    const nextSelected = selector(item.get());
    const current = selectedRef.current;
    if (current.hasValue && isEqual(current.value, nextSelected)) {
      return current.value;
    }

    selectedRef.current = { hasValue: true, value: nextSelected };
    return nextSelected;
  };

  const selectedValue = useSyncExternalStore(
    item.subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot,
  );
  return [selectedValue, item.set];
}

export function useSetStorage<T>(item: StorageItem<T>) {
  return item.set;
}

type BatchReadItem<T> = Pick<
  StorageItem<T>,
  "key" | "scope" | "get" | "deserialize"
> & {
  _hasValidation?: boolean;
  _hasExpiration?: boolean;
  _readCacheEnabled?: boolean;
  _isBiometric?: boolean;
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
  assertBatchScope(items, scope);

  if (scope === StorageScope.Memory) {
    return items.map((item) => item.get());
  }

  const useRawBatchPath = items.every((item) => canUseRawBatchPath(item));
  if (!useRawBatchPath) {
    return items.map((item) => item.get());
  }
  const useBatchCache = items.every((item) => item._readCacheEnabled === true);

  const rawValues = new Array<string | undefined>(items.length);
  const keysToFetch: string[] = [];
  const keyIndexes: number[] = [];

  items.forEach((item, index) => {
    if (scope === StorageScope.Secure) {
      if (hasPendingSecureWrite(item.key)) {
        rawValues[index] = readPendingSecureWrite(item.key);
        return;
      }
    }

    if (useBatchCache) {
      if (hasCachedRawValue(scope, item.key)) {
        rawValues[index] = readCachedRawValue(scope, item.key);
        return;
      }
    }

    keysToFetch.push(item.key);
    keyIndexes.push(index);
  });

  if (keysToFetch.length > 0) {
    const fetchedValues = WebStorage.getBatch(keysToFetch, scope);
    fetchedValues.forEach((value, index) => {
      const key = keysToFetch[index];
      const targetIndex = keyIndexes[index];
      rawValues[targetIndex] = value;
      cacheRawValue(scope, key, value);
    });
  }

  return items.map((item, index) => {
    const raw = rawValues[index];
    if (raw === undefined) {
      return item.get();
    }
    return item.deserialize(raw);
  });
}

export function setBatch<T>(
  items: readonly StorageBatchSetItem<T>[],
  scope: StorageScope,
): void {
  assertBatchScope(
    items.map((batchEntry) => batchEntry.item),
    scope,
  );

  if (scope === StorageScope.Memory) {
    items.forEach(({ item, value }) => item.set(value));
    return;
  }

  const useRawBatchPath = items.every(({ item }) =>
    canUseRawBatchPath(asInternal(item)),
  );
  if (!useRawBatchPath) {
    items.forEach(({ item, value }) => item.set(value));
    return;
  }

  const keys = items.map((entry) => entry.item.key);
  const values = items.map((entry) => entry.item.serialize(entry.value));
  if (scope === StorageScope.Secure) {
    flushSecureWrites();
  }
  WebStorage.setBatch(keys, values, scope);
  keys.forEach((key, index) => cacheRawValue(scope, key, values[index]));
}

export function removeBatch(
  items: readonly BatchRemoveItem[],
  scope: StorageScope,
): void {
  assertBatchScope(items, scope);

  if (scope === StorageScope.Memory) {
    items.forEach((item) => item.delete());
    return;
  }

  const keys = items.map((item) => item.key);
  if (scope === StorageScope.Secure) {
    flushSecureWrites();
  }
  WebStorage.removeBatch(keys, scope);
  keys.forEach((key) => cacheRawValue(scope, key, undefined));
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
    writeMigrationVersion(scope, version);
    appliedVersion = version;
  });

  return appliedVersion;
}

export function runTransaction<T>(
  scope: StorageScope,
  transaction: (context: TransactionContext) => T,
): T {
  assertValidScope(scope);
  if (scope === StorageScope.Secure) {
    flushSecureWrites();
  }

  const rollback = new Map<string, string | undefined>();

  const rememberRollback = (key: string) => {
    if (rollback.has(key)) {
      return;
    }
    rollback.set(key, getRawValue(key, scope));
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
    Array.from(rollback.entries())
      .reverse()
      .forEach(([key, previousValue]) => {
        if (previousValue === undefined) {
          removeRawValue(key, scope);
        } else {
          setRawValue(key, previousValue, scope);
        }
      });
    throw error;
  }
}

export type SecureAuthStorageConfig<K extends string = string> = Record<
  K,
  {
    ttlMs?: number;
    biometric?: boolean;
    accessControl?: AccessControl;
  }
>;

export function createSecureAuthStorage<K extends string>(
  config: SecureAuthStorageConfig<K>,
  options?: { namespace?: string },
): Record<K, StorageItem<string>> {
  const ns = options?.namespace ?? "auth";
  const result = {} as Record<K, StorageItem<string>>;

  for (const key of Object.keys(config) as K[]) {
    const itemConfig = config[key];
    result[key] = createStorageItem<string>({
      key,
      scope: StorageScope.Secure,
      defaultValue: "",
      namespace: ns,
      biometric: itemConfig.biometric,
      accessControl: itemConfig.accessControl,
      expiration: itemConfig.ttlMs ? { ttlMs: itemConfig.ttlMs } : undefined,
    });
  }

  return result;
}
