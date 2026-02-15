import { useSyncExternalStore } from "react";

export enum StorageScope {
  Memory = 0,
  Disk = 1,
  Secure = 2,
}

export { migrateFromMMKV } from "./migration";

const MIGRATION_VERSION_KEY = "__nitro_storage_migration_version__";

type StoredEnvelope = {
  __nitroStorageEnvelope: true;
  expiresAt: number;
  payload: string;
};

function isStoredEnvelope(value: unknown): value is StoredEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<StoredEnvelope>;
  return (
    candidate.__nitroStorageEnvelope === true &&
    typeof candidate.expiresAt === "number" &&
    typeof candidate.payload === "string"
  );
}

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
    item: Pick<StorageItem<T>, "scope" | "key" | "serialize">,
    value: T
  ) => void;
  removeItem: (
    item: Pick<StorageItem<unknown>, "scope" | "key">
  ) => void;
};

const registeredMigrations = new Map<number, Migration>();

function assertValidScope(scope: StorageScope): void {
  if (
    scope !== StorageScope.Memory &&
    scope !== StorageScope.Disk &&
    scope !== StorageScope.Secure
  ) {
    throw new Error(`Invalid storage scope: ${String(scope)}`);
  }
}

export interface Storage {
  name: string;
  equals: (other: any) => boolean;
  dispose: () => void;
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
}

const diskListeners = new Map<string, Set<() => void>>();
const secureListeners = new Map<string, Set<() => void>>();

function notifyDiskListeners(key: string) {
  diskListeners.get(key)?.forEach((cb) => cb());
}

function notifySecureListeners(key: string) {
  secureListeners.get(key)?.forEach((cb) => cb());
}

const WebStorage: Storage = {
  name: "Storage",
  equals: (other) => other === WebStorage,
  dispose: () => {},
  set: (key: string, value: string, scope: number) => {
    if (scope === StorageScope.Disk) {
      localStorage?.setItem(key, value);
      notifyDiskListeners(key);
    } else if (scope === StorageScope.Secure) {
      sessionStorage?.setItem(key, value);
      notifySecureListeners(key);
    }
  },

  get: (key: string, scope: number) => {
    if (scope === StorageScope.Disk) {
      return localStorage?.getItem(key) ?? undefined;
    } else if (scope === StorageScope.Secure) {
      return sessionStorage?.getItem(key) ?? undefined;
    }
    return undefined;
  },
  remove: (key: string, scope: number) => {
    if (scope === StorageScope.Disk) {
      localStorage?.removeItem(key);
      notifyDiskListeners(key);
    } else if (scope === StorageScope.Secure) {
      sessionStorage?.removeItem(key);
      notifySecureListeners(key);
    }
  },

  clear: (scope: number) => {
    if (scope === StorageScope.Disk) {
      localStorage?.clear();
      diskListeners.forEach((listeners) => {
        listeners.forEach((cb) => cb());
      });
    } else if (scope === StorageScope.Secure) {
      sessionStorage?.clear();
      secureListeners.forEach((listeners) => {
        listeners.forEach((cb) => cb());
      });
    }
  },
  setBatch: (keys: string[], values: string[], scope: number) => {
    keys.forEach((key, i) => WebStorage.set(key, values[i], scope));
  },
  getBatch: (keys: string[], scope: number) => {
    return keys.map((key) => WebStorage.get(key, scope));
  },
  removeBatch: (keys: string[], scope: number) => {
    keys.forEach((key) => WebStorage.remove(key, scope));
  },
  addOnChange: (
    _scope: number,
    _callback: (key: string, value: string | undefined) => void
  ) => {
    return () => {};
  },
};

const memoryStore = new Map<string, any>();
const memoryListeners = new Set<(key: string, value: any) => void>();

function notifyMemoryListeners(key: string, value: any) {
  memoryListeners.forEach((listener) => listener(key, value));
}

function getRawValue(key: string, scope: StorageScope): string | undefined {
  assertValidScope(scope);
  if (scope === StorageScope.Memory) {
    const value = memoryStore.get(key);
    return typeof value === "string" ? value : undefined;
  }

  return WebStorage.get(key, scope);
}

function setRawValue(key: string, value: string, scope: StorageScope): void {
  assertValidScope(scope);
  if (scope === StorageScope.Memory) {
    memoryStore.set(key, value);
    notifyMemoryListeners(key, value);
    return;
  }

  WebStorage.set(key, value, scope);
}

function removeRawValue(key: string, scope: StorageScope): void {
  assertValidScope(scope);
  if (scope === StorageScope.Memory) {
    memoryStore.delete(key);
    notifyMemoryListeners(key, undefined);
    return;
  }

  WebStorage.remove(key, scope);
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
      notifyMemoryListeners("", undefined);
    } else {
      WebStorage.clear(scope);
    }
  },
  clearAll: () => {
    storage.clear(StorageScope.Memory);
    storage.clear(StorageScope.Disk);
    storage.clear(StorageScope.Secure);
  },
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
}

export interface StorageItem<T> {
  get: () => T;
  set: (value: T | ((prev: T) => T)) => void;
  delete: () => void;
  subscribe: (callback: () => void) => () => void;
  serialize: (value: T) => string;
  deserialize: (value: string) => T;
  _triggerListeners: () => void;
  scope: StorageScope;
  key: string;
}

function defaultSerialize<T>(value: T): string {
  return JSON.stringify(value);
}

function defaultDeserialize<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function createStorageItem<T = undefined>(
  config: StorageItemConfig<T>
): StorageItem<T> {
  const serialize = config.serialize ?? defaultSerialize;
  const deserialize = config.deserialize ?? defaultDeserialize;
  const isMemory = config.scope === StorageScope.Memory;
  const validate = config.validate;
  const onValidationError = config.onValidationError;
  const expiration = config.expiration;
  const expirationTtlMs = expiration?.ttlMs;
  const memoryExpiration = expiration && isMemory ? new Map<string, number>() : null;

  if (expiration && expiration.ttlMs <= 0) {
    throw new Error("expiration.ttlMs must be greater than 0.");
  }

  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  let lastRaw: string | undefined;
  let lastValue: T | undefined;

  const writeValueWithoutValidation = (value: T): void => {
    if (isMemory) {
      if (memoryExpiration) {
        memoryExpiration.set(config.key, Date.now() + (expirationTtlMs ?? 0));
      }
      memoryStore.set(config.key, value);
      notifyMemoryListeners(config.key, value);
      return;
    }

    const serialized = serialize(value);
    if (expiration) {
      const envelope: StoredEnvelope = {
        __nitroStorageEnvelope: true,
        expiresAt: Date.now() + expiration.ttlMs,
        payload: serialized,
      };
      WebStorage.set(config.key, JSON.stringify(envelope), config.scope);
    } else {
      WebStorage.set(config.key, serialized, config.scope);
    }
  };

  const resolveInvalidValue = (invalidValue: unknown): T => {
    if (onValidationError) {
      return onValidationError(invalidValue);
    }

    return config.defaultValue as T;
  };

  const ensureValidatedValue = (
    candidate: unknown,
    hadStoredValue: boolean
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

  const ensureSubscription = () => {
    if (!unsubscribe) {
      if (isMemory) {
        const listener = (key: string) => {
          if (key === "" || key === config.key) {
            lastRaw = undefined;
            lastValue = undefined;
            listeners.forEach((l) => l());
          }
        };
        memoryListeners.add(listener);
        unsubscribe = () => memoryListeners.delete(listener);
      } else if (config.scope === StorageScope.Disk) {
        const listener = () => {
          lastRaw = undefined;
          lastValue = undefined;
          listeners.forEach((l) => l());
        };
        if (!diskListeners.has(config.key)) {
          diskListeners.set(config.key, new Set());
        }
        diskListeners.get(config.key)!.add(listener);
        unsubscribe = () => diskListeners.get(config.key)?.delete(listener);
      } else if (config.scope === StorageScope.Secure) {
        const listener = () => {
          lastRaw = undefined;
          lastValue = undefined;
          listeners.forEach((l) => l());
        };
        if (!secureListeners.has(config.key)) {
          secureListeners.set(config.key, new Set());
        }
        secureListeners.get(config.key)!.add(listener);
        unsubscribe = () => secureListeners.get(config.key)?.delete(listener);
      }
    }
  };

  const get = (): T => {
    let raw: string | undefined;
    if (isMemory) {
      if (memoryExpiration) {
        const expiresAt = memoryExpiration.get(config.key);
        if (expiresAt !== undefined && expiresAt <= Date.now()) {
          memoryExpiration.delete(config.key);
          memoryStore.delete(config.key);
          notifyMemoryListeners(config.key, undefined);
          raw = undefined;
        } else {
          raw = memoryStore.get(config.key);
        }
      } else {
        raw = memoryStore.get(config.key);
      }
    } else {
      raw = WebStorage.get(config.key, config.scope);
    }

    const canUseCachedValue = !expiration && !memoryExpiration;
    if (canUseCachedValue && raw === lastRaw && lastValue !== undefined) {
      return lastValue;
    }

    lastRaw = raw;

    if (raw === undefined) {
      lastValue = ensureValidatedValue(config.defaultValue, false);
      return lastValue;
    }

    if (isMemory) {
      lastValue = ensureValidatedValue(raw, true);
      return lastValue;
    }

    let deserializableRaw = raw;

    if (expiration) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (isStoredEnvelope(parsed)) {
          if (parsed.expiresAt <= Date.now()) {
            WebStorage.remove(config.key, config.scope);
            lastRaw = undefined;
            lastValue = ensureValidatedValue(config.defaultValue, false);
            return lastValue;
          }

          deserializableRaw = parsed.payload;
        }
      } catch {
        // Keep backward compatibility with legacy raw values.
      }
    }

    lastValue = ensureValidatedValue(deserialize(deserializableRaw), true);
    return lastValue;
  };

  const set = (valueOrFn: T | ((prev: T) => T)): void => {
    const currentValue = get();
    const newValue =
      typeof valueOrFn === "function"
        ? (valueOrFn as (prev: T) => T)(currentValue)
        : valueOrFn;

    lastRaw = undefined;

    if (validate && !validate(newValue)) {
      throw new Error(
        `Validation failed for key "${config.key}" in scope "${StorageScope[config.scope]}".`
      );
    }

    writeValueWithoutValidation(newValue);
  };

  const deleteItem = (): void => {
    lastRaw = undefined;
    lastValue = undefined;

    if (isMemory) {
      if (memoryExpiration) {
        memoryExpiration.delete(config.key);
      }
      memoryStore.delete(config.key);
      notifyMemoryListeners(config.key, undefined);
    } else {
      WebStorage.remove(config.key, config.scope);
    }
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

  return {
    get,
    set,
    delete: deleteItem,
    subscribe,
    serialize,
    deserialize,
    _triggerListeners: () => {
      lastRaw = undefined;
      lastValue = undefined;
      listeners.forEach((l) => l());
    },
    scope: config.scope,
    key: config.key,
  };
}

export function useStorage<T>(
  item: StorageItem<T>
): [T, (value: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(item.subscribe, item.get, item.get);
  return [value, item.set];
}

export function useSetStorage<T>(item: StorageItem<T>) {
  return item.set;
}

type ScopedBatchItem = Pick<StorageItem<unknown>, "key" | "scope">;
type BatchReadItem<T> = Pick<StorageItem<T>, "key" | "scope" | "get" | "deserialize">;
type BatchRemoveItem = Pick<StorageItem<unknown>, "key" | "scope" | "delete">;

export type StorageBatchSetItem<T> = {
  item: StorageItem<T>;
  value: T;
};

function assertBatchScope(
  items: readonly ScopedBatchItem[],
  scope: StorageScope
): void {
  const mismatchedItem = items.find((item) => item.scope !== scope);
  if (!mismatchedItem) {
    return;
  }

  const expectedScope = StorageScope[scope] ?? String(scope);
  const actualScope =
    StorageScope[mismatchedItem.scope] ?? String(mismatchedItem.scope);
  throw new Error(
    `Batch scope mismatch for "${mismatchedItem.key}": expected ${expectedScope}, received ${actualScope}.`
  );
}

export function getBatch(
  items: readonly BatchReadItem<unknown>[],
  scope: StorageScope
): unknown[] {
  assertBatchScope(items, scope);

  if (scope === StorageScope.Memory) {
    return items.map((item) => item.get());
  }

  const keys = items.map((item) => item.key);
  const rawValues = WebStorage.getBatch(keys, scope);

  return items.map((item, idx) => {
    const raw = rawValues[idx];
    if (raw === undefined) {
      return item.get();
    }
    return item.deserialize(raw);
  });
}

export function setBatch<T>(
  items: readonly StorageBatchSetItem<T>[],
  scope: StorageScope
): void {
  assertBatchScope(
    items.map((batchEntry) => batchEntry.item),
    scope
  );

  if (scope === StorageScope.Memory) {
    items.forEach(({ item, value }) => item.set(value));
    return;
  }

  const keys = items.map((i) => i.item.key);
  const values = items.map((i) => i.item.serialize(i.value));
  WebStorage.setBatch(keys, values, scope);

  items.forEach(({ item }) => {
    item._triggerListeners();
  });
}

export function removeBatch(
  items: readonly BatchRemoveItem[],
  scope: StorageScope
): void {
  assertBatchScope(items, scope);

  if (scope === StorageScope.Memory) {
    items.forEach((item) => item.delete());
    return;
  }

  const keys = items.map((item) => item.key);
  WebStorage.removeBatch(keys, scope);
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

export function migrateToLatest(scope: StorageScope = StorageScope.Disk): number {
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
  transaction: (context: TransactionContext) => T
): T {
  assertValidScope(scope);

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
      setRawValue(item.key, item.serialize(value), scope);
    },
    removeItem: (item) => {
      assertBatchScope([item], scope);
      rememberRollback(item.key);
      removeRawValue(item.key, scope);
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
