import { createDurabilityCoordinator } from "./core/durability";
import { createMetricsRegistry } from "./core/metrics";
import {
  MIGRATION_VERSION_KEY,
  type StoredEnvelope,
  isStoredEnvelope,
  assertBatchScope,
  assertValidScope,
  toVersionToken,
  prefixKey,
  isNamespaced,
  escapeCollidingRawValue,
  unescapeCollidingRawValue,
} from "./internal";
import {
  assertAccessControlLevel,
  assertBiometricLevel,
  canUseRawBatchPath,
  canUseSecureRawBatchPath,
  createKeyChange,
  defaultDeserialize,
  defaultSerialize,
  isKeychainLockedError,
  isUpdater,
  notifyAllListeners,
  notifyKeyListeners,
  redactSecureKeyChange,
  typedKeys,
  type ExpirationConfig,
  type KeyListenerRegistry,
  type Migration,
  type NonMemoryScope,
  type RollbackRecord,
  type SecureAuthStorageConfig,
  type StorageEventObserverOptions,
  type StorageExportOptions,
  type StorageMetricSummary,
  type StorageMetricsObserver,
  type StorageSelectorListener,
  type StorageSelectorSubscribeOptions,
  type StorageVersion,
  type Validator,
  type VersionedValue,
} from "./shared";
import {
  StorageEventRegistry,
  type StorageBatchChangeEvent,
  type StorageChangeEvent,
  type StorageChangeOperation,
  type StorageChangeSource,
  type StorageEventListener,
  type StorageKeyChangeEvent,
} from "./storage-events";
import type { StorageSetter } from "./storage-hooks";
import type { SecureStorageMetadata } from "./storage-runtime";
import { StorageScope, AccessControl, BiometricLevel } from "./Storage.types";

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

export type StorageItemConfig<T> = {
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
  group?: string;
  renameFrom?: string | readonly string[];
  fallbackToCacheOnReadError?: boolean;
  onReadError?: (error: unknown) => void;
};

export type StorageItem<T> = {
  get: () => T;
  getWithVersion: () => VersionedValue<T>;
  set: StorageSetter<T>;
  setIfVersion: (
    version: StorageVersion,
    value: T | ((prev: T) => T),
  ) => boolean;
  merge: (partial: Partial<T>) => void;
  reset: () => void;
  setOrDelete: (value: T | null | undefined) => void;
  delete: () => void;
  has: () => boolean;
  subscribe: (callback: () => void) => () => void;
  subscribeSelector: <TSelected>(
    selector: (value: T) => TSelected,
    listener: StorageSelectorListener<TSelected>,
    options?: StorageSelectorSubscribeOptions<TSelected>,
  ) => () => void;
  serialize: (value: T) => string;
  deserialize: (value: string) => T;
  scope: StorageScope;
  key: string;
};

type StorageItemInternal<T> = StorageItem<T> & {
  _triggerListeners: () => void;
  _invalidateParsedCacheOnly: () => void;
  _deleteMemoryEntry: () => void;
  _hasValidation: boolean;
  _hasExpiration: boolean;
  _readCacheEnabled: boolean;
  _isBiometric: boolean;
  _biometricLevel: BiometricLevel;
  _defaultValue: T;
  _secureAccessControl?: AccessControl;
  _group?: string;
};

export type BatchReadItem<T> = Pick<
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
export type BatchRemoveItem = Pick<
  StorageItem<unknown>,
  "key" | "scope" | "delete"
>;
export type BatchValues<TItems extends readonly BatchReadItem<unknown>[]> = {
  [Index in keyof TItems]: TItems[Index] extends BatchReadItem<infer Value>
    ? Value
    : never;
};

export type StorageBatchSetItem<T> = {
  item: StorageItem<T>;
  value: T;
};

type StorageBatchSetCandidate = {
  get: () => unknown;
};

type StorageBatchSetEntries<
  TItems extends readonly StorageBatchSetCandidate[],
> = {
  [Index in keyof TItems]: {
    item: TItems[Index] & StorageItem<ReturnType<TItems[Index]["get"]>>;
    value: ReturnType<TItems[Index]["get"]>;
  };
};

export type StorageKeyRef = string | { readonly key: string };

export type StorageClearOptions = {
  except?: readonly StorageKeyRef[];
};

export type SetItemConfig<TMember extends string = string> = Omit<
  StorageItemConfig<Record<string, true>>,
  "defaultValue" | "serialize" | "deserialize"
> & {
  defaultValue?: readonly TMember[];
};

export type SetStorageItem<TMember extends string = string> = {
  get: () => Record<string, true>;
  has: (id: TMember) => boolean;
  add: (id: TMember) => void;
  delete: (id: TMember) => void;
  toggle: (id: TMember) => boolean;
  values: () => TMember[];
  size: () => number;
  clear: () => void;
  reset: () => void;
  subscribe: (callback: () => void) => () => void;
  scope: StorageScope;
  key: string;
  item: StorageItem<Record<string, true>>;
};

export type StorageCoreBackend = {
  get(key: string, scope: StorageScope): string | undefined;
  set(key: string, value: string, scope: StorageScope): void;
  remove(key: string, scope: StorageScope): void;
  clear(scope: StorageScope): void;
  has(key: string, scope: StorageScope): boolean;
  getAllKeys(scope: StorageScope): string[];
  getKeysByPrefix(prefix: string, scope: StorageScope): string[];
  size(scope: StorageScope): number;
  setBatch(keys: string[], values: string[], scope: StorageScope): void;
  getBatch(keys: string[], scope: StorageScope): (string | undefined)[];
  removeBatch(keys: string[], scope: StorageScope): void;
  removeByPrefix(prefix: string, scope: StorageScope): void;
  setSecureAccessControl(level: AccessControl): void;
  getSecureBiometric(key: string): string | undefined;
  setSecureBiometricWithLevel(
    key: string,
    value: string,
    level: BiometricLevel,
  ): void;
  deleteSecureBiometric(key: string): void;
  hasSecureBiometric(key: string): boolean;
  clearSecureBiometric(): void;
};

export type StorageCoreAdapter = {
  backend: StorageCoreBackend;
  changeSource: StorageChangeSource;
  applyAccessControlOnSecureRawWrite: boolean;
  ensureScopeSubscription(scope: NonMemoryScope): void;
  maybeCleanupScopeSubscription(scope: NonMemoryScope): void;
  onWillEmitChanges(
    scope: StorageScope,
    keys: readonly string[],
    operation: StorageChangeOperation,
    source: StorageChangeSource,
  ): void;
  getSecureMetadataProfile(): Pick<
    SecureStorageMetadata,
    "backend" | "encrypted" | "hardwareBacked"
  >;
};

export type StorageCoreInternals = {
  getScopedListeners(scope: NonMemoryScope): KeyListenerRegistry;
  cacheRawValue(
    scope: NonMemoryScope,
    key: string,
    value: string | undefined,
  ): void;
  readCachedRawValue(scope: NonMemoryScope, key: string): string | undefined;
  clearScopeRawCache(scope: NonMemoryScope): void;
  clearPendingDiskWrite(key: string): void;
  clearPendingSecureWrite(key: string): void;
  clearAllPendingDiskWrites(): void;
  clearAllPendingSecureWrites(): void;
  flushDiskWrites(): void;
  flushSecureWrites(): void;
  emitKeyChange(
    scope: StorageScope,
    key: string,
    oldValue: string | undefined,
    newValue: string | undefined,
    operation: StorageChangeOperation,
    source: StorageChangeSource,
  ): void;
  hasEventObserver(): boolean;
  hasScopeEventListeners(scope: StorageScope): boolean;
  measureOperation<T>(
    operation: string,
    scope: StorageScope,
    fn: () => T,
    keysCount?: number,
  ): T;
  recordMetric(
    operation: string,
    scope: StorageScope,
    durationMs: number,
    keysCount?: number,
  ): void;
  getSecureDefaultAccessControl(): AccessControl;
  setSecureDefaultAccessControl(level: AccessControl): void;
};

const EMPTY_KEYS: readonly string[] = Object.freeze([]);

function asInternal<T>(item: StorageItem<T>): StorageItemInternal<T> {
  return item as StorageItemInternal<T>;
}

export function createStorageCore(
  buildAdapter: (internals: StorageCoreInternals) => StorageCoreAdapter,
) {
  const registeredMigrations = new Map<number, Migration>();
  const itemGroups = new Map<string, Set<StorageItemInternal<unknown>>>();
  const registeredKeyCounts = new Map<string, number>();
  const memoryStore = new Map<string, unknown>();
  const memoryListeners: KeyListenerRegistry = new Map();
  const scopedListeners: Record<NonMemoryScope, KeyListenerRegistry> = {
    [StorageScope.Disk]: new Map(),
    [StorageScope.Secure]: new Map(),
  };
  const scopedRawCache: Record<
    NonMemoryScope,
    Map<string, string | undefined>
  > = {
    [StorageScope.Disk]: new Map(),
    [StorageScope.Secure]: new Map(),
  };
  let secureDefaultAccessControl: AccessControl = AccessControl.WhenUnlocked;
  let eventObserver: StorageEventListener | undefined;
  let eventObserverRedactSecureValues = true;
  const storageEvents = new StorageEventRegistry();
  const metrics = createMetricsRegistry();
  const durability = createDurabilityCoordinator({
    backend: {
      setBatch: (keys, values, scope) => {
        adapter.backend.setBatch(keys, values, scope);
      },
      removeBatch: (keys, scope) => {
        adapter.backend.removeBatch(keys, scope);
      },
      setSecureAccessControl: (level) => {
        adapter.backend.setSecureAccessControl(level);
      },
    },
    resolveSecureDefaultAccessControl: () => secureDefaultAccessControl,
  });

  function getScopedListeners(scope: NonMemoryScope): KeyListenerRegistry {
    return scopedListeners[scope];
  }

  function getScopeRawCache(
    scope: NonMemoryScope,
  ): Map<string, string | undefined> {
    return scopedRawCache[scope];
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

  function clearScopeRawCache(scope: NonMemoryScope): void {
    getScopeRawCache(scope).clear();
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
      const keyListeners = registry.get(key);
      if (!keyListeners) {
        return;
      }
      keyListeners.delete(listener);
      if (keyListeners.size === 0) {
        registry.delete(key);
      }
    };
  }

  function getEventRawValue(
    scope: StorageScope,
    key: string,
  ): string | undefined {
    if (scope === StorageScope.Memory) {
      const value = memoryStore.get(key);
      return typeof value === "string"
        ? unescapeCollidingRawValue(value)
        : undefined;
    }

    return getRawValue(key, scope);
  }

  function shouldReadPreviousEventValues(scope: StorageScope): boolean {
    if (storageEvents.hasListeners(scope)) {
      return true;
    }
    if (!eventObserver) {
      return false;
    }
    return scope !== StorageScope.Secure || !eventObserverRedactSecureValues;
  }

  function eventForGlobalObserver(
    event: StorageChangeEvent,
  ): StorageChangeEvent {
    if (
      !eventObserverRedactSecureValues ||
      event.scope !== StorageScope.Secure
    ) {
      return event;
    }

    if (event.type === "key") {
      return redactSecureKeyChange(event);
    }

    return {
      ...event,
      changes: event.changes.map(redactSecureKeyChange),
    };
  }

  function emitKeyChange(
    scope: StorageScope,
    key: string,
    oldValue: string | undefined,
    newValue: string | undefined,
    operation: StorageChangeOperation,
    source: StorageChangeSource,
  ): void {
    adapter.onWillEmitChanges(scope, [key], operation, source);
    const event = createKeyChange(
      scope,
      key,
      oldValue,
      newValue,
      operation,
      source,
    );
    storageEvents.emitKey(event);
    eventObserver?.(eventForGlobalObserver(event));
  }

  function emitBatchChange(
    scope: StorageScope,
    operation: StorageChangeOperation,
    source: StorageChangeSource,
    changes: StorageKeyChangeEvent[],
  ): void {
    if (changes.length === 0) {
      return;
    }

    adapter.onWillEmitChanges(
      scope,
      changes.map((change) => change.key),
      operation,
      source,
    );

    const event: StorageBatchChangeEvent = {
      type: "batch",
      scope,
      operation,
      source,
      changes,
    };
    storageEvents.emitBatch(event);
    eventObserver?.(eventForGlobalObserver(event));
  }

  function measureOperation<T>(
    operation: string,
    scope: StorageScope,
    fn: () => T,
    keysCount = 1,
  ): T {
    return metrics.measure(operation, scope, fn, keysCount);
  }

  function recordMetric(
    operation: string,
    scope: StorageScope,
    durationMs: number,
    keysCount = 1,
  ): void {
    metrics.record(operation, scope, durationMs, keysCount);
  }

  function readPendingSecureWrite(key: string): string | undefined {
    return durability.readPendingSecureWrite(key);
  }

  function readPendingDiskWrite(key: string): string | undefined {
    return durability.readPendingDiskWrite(key);
  }

  function hasPendingDiskWrite(key: string): boolean {
    return durability.hasPendingDiskWrite(key);
  }

  function hasPendingSecureWrite(key: string): boolean {
    return durability.hasPendingSecureWrite(key);
  }

  function clearPendingDiskWrite(key: string): void {
    durability.clearPendingDiskWrite(key);
  }

  function clearPendingSecureWrite(key: string): void {
    durability.clearPendingSecureWrite(key);
  }

  function flushDiskWrites(): void {
    durability.flushDiskWrites();
  }

  function flushSecureWrites(): void {
    durability.flushSecureWrites();
  }

  function scheduleDiskWrite(key: string, value: string | undefined): void {
    durability.scheduleDiskWrite(key, value);
  }

  function scheduleSecureWrite(
    key: string,
    value: string | undefined,
    accessControl?: AccessControl,
  ): void {
    durability.scheduleSecureWrite(key, value, accessControl);
  }

  function setDiskWritesAsyncMode(enabled: boolean): void {
    durability.setDiskWritesAsync(enabled);
  }

  function isDiskWritesAsync(): boolean {
    return durability.isDiskWritesAsync();
  }

  function getStoredRawValue(
    key: string,
    scope: StorageScope,
  ): string | undefined {
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

    return adapter.backend.get(key, scope);
  }

  function getRawValue(key: string, scope: StorageScope): string | undefined {
    assertValidScope(scope);
    if (scope === StorageScope.Memory) {
      const value = memoryStore.get(key);
      return typeof value === "string"
        ? unescapeCollidingRawValue(value)
        : undefined;
    }

    if (scope === StorageScope.Disk && hasPendingDiskWrite(key)) {
      const pending = readPendingDiskWrite(key);
      return pending === undefined
        ? undefined
        : unescapeCollidingRawValue(pending);
    }

    if (scope === StorageScope.Secure && hasPendingSecureWrite(key)) {
      const pending = readPendingSecureWrite(key);
      return pending === undefined
        ? undefined
        : unescapeCollidingRawValue(pending);
    }

    const raw = adapter.backend.get(key, scope);
    return raw === undefined ? undefined : unescapeCollidingRawValue(raw);
  }

  function setRawValue(key: string, value: string, scope: StorageScope): void {
    assertValidScope(scope);
    const storedValue = escapeCollidingRawValue(value);
    const oldValue =
      scope === StorageScope.Memory ? getEventRawValue(scope, key) : undefined;
    if (scope === StorageScope.Memory) {
      memoryStore.set(key, storedValue);
      notifyKeyListeners(memoryListeners, key);
      emitKeyChange(scope, key, oldValue, value, "set", "memory");
      return;
    }

    if (scope === StorageScope.Disk) {
      cacheRawValue(scope, key, storedValue);
      if (isDiskWritesAsync()) {
        scheduleDiskWrite(key, storedValue);
        emitKeyChange(scope, key, oldValue, value, "set", adapter.changeSource);
        return;
      }

      flushDiskWrites();
      clearPendingDiskWrite(key);
    }

    if (scope === StorageScope.Secure) {
      flushSecureWrites();
      clearPendingSecureWrite(key);
      if (adapter.applyAccessControlOnSecureRawWrite) {
        adapter.backend.setSecureAccessControl(secureDefaultAccessControl);
      }
    }

    adapter.backend.set(key, storedValue, scope);
    cacheRawValue(scope, key, storedValue);
    emitKeyChange(scope, key, oldValue, value, "set", adapter.changeSource);
  }

  function removeRawValue(key: string, scope: StorageScope): void {
    assertValidScope(scope);
    const oldValue = getEventRawValue(scope, key);
    if (scope === StorageScope.Memory) {
      memoryStore.delete(key);
      notifyKeyListeners(memoryListeners, key);
      emitKeyChange(scope, key, oldValue, undefined, "remove", "memory");
      return;
    }

    if (scope === StorageScope.Disk) {
      cacheRawValue(scope, key, undefined);
      if (isDiskWritesAsync()) {
        scheduleDiskWrite(key, undefined);
        emitKeyChange(
          scope,
          key,
          oldValue,
          undefined,
          "remove",
          adapter.changeSource,
        );
        return;
      }

      flushDiskWrites();
      clearPendingDiskWrite(key);
    }

    if (scope === StorageScope.Secure) {
      flushSecureWrites();
      clearPendingSecureWrite(key);
    }

    adapter.backend.remove(key, scope);
    cacheRawValue(scope, key, undefined);
    emitKeyChange(
      scope,
      key,
      oldValue,
      undefined,
      "remove",
      adapter.changeSource,
    );
  }

  function readMigrationVersion(scope: StorageScope): number {
    const raw = getRawValue(MIGRATION_VERSION_KEY, scope);
    if (raw === undefined) {
      return 0;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  const internals: StorageCoreInternals = {
    getScopedListeners,
    cacheRawValue,
    readCachedRawValue,
    clearScopeRawCache,
    clearPendingDiskWrite,
    clearPendingSecureWrite,
    clearAllPendingDiskWrites: () => {
      durability.clearAllPendingDiskWrites();
    },
    clearAllPendingSecureWrites: () => {
      durability.clearAllPendingSecureWrites();
    },
    flushDiskWrites,
    flushSecureWrites,
    emitKeyChange,
    hasEventObserver: () => eventObserver !== undefined,
    hasScopeEventListeners: (scope) => storageEvents.hasListeners(scope),
    measureOperation,
    recordMetric,
    getSecureDefaultAccessControl: () => secureDefaultAccessControl,
    setSecureDefaultAccessControl: (level) => {
      secureDefaultAccessControl = level;
    },
  };

  const adapter = buildAdapter(internals);

  function resolveKeyRef(ref: StorageKeyRef): string {
    return typeof ref === "string" ? ref : ref.key;
  }

  function clearScopeExcept(
    scope: StorageScope,
    exceptRefs: readonly StorageKeyRef[],
  ): void {
    measureOperation("storage:clearExcept", scope, () => {
      assertValidScope(scope);
      const keep = new Set(exceptRefs.map(resolveKeyRef));

      if (scope === StorageScope.Memory) {
        const removeKeys = Array.from(memoryStore.keys()).filter(
          (key) => !keep.has(key),
        );
        if (removeKeys.length === 0) {
          return;
        }
        const previousValues = shouldReadPreviousEventValues(scope)
          ? removeKeys.map((key) => getEventRawValue(scope, key))
          : [];
        removeKeys.forEach((key) => memoryStore.delete(key));
        removeKeys.forEach((key) => {
          notifyKeyListeners(memoryListeners, key);
        });
        emitBatchChange(
          scope,
          "clear",
          "memory",
          removeKeys.map((key, index) =>
            createKeyChange(
              scope,
              key,
              previousValues[index],
              undefined,
              "clear",
              "memory",
            ),
          ),
        );
        return;
      }

      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }

      const removeKeys = adapter.backend
        .getAllKeys(scope)
        .filter((key) => !keep.has(key));
      if (removeKeys.length === 0) {
        return;
      }
      const previousValues = shouldReadPreviousEventValues(scope)
        ? adapter.backend
            .getBatch(removeKeys, scope)
            .map((value) =>
              value === undefined
                ? undefined
                : unescapeCollidingRawValue(value),
            )
        : [];
      adapter.backend.removeBatch(removeKeys, scope);
      removeKeys.forEach((key) => {
        cacheRawValue(scope, key, undefined);
      });
      emitBatchChange(
        scope,
        "clear",
        adapter.changeSource,
        removeKeys.map((key, index) =>
          createKeyChange(
            scope,
            key,
            previousValues[index],
            undefined,
            "clear",
            adapter.changeSource,
          ),
        ),
      );
    });
  }

  const storage = {
    subscribe: (
      scope: StorageScope,
      listener: StorageEventListener,
    ): (() => void) => {
      assertValidScope(scope);
      if (scope !== StorageScope.Memory) {
        adapter.ensureScopeSubscription(scope);
        const unsubscribe = storageEvents.subscribe(scope, listener);
        return () => {
          unsubscribe();
          adapter.maybeCleanupScopeSubscription(scope);
        };
      }
      return storageEvents.subscribe(scope, listener);
    },
    subscribeKey: (
      scope: StorageScope,
      key: string,
      listener: StorageEventListener,
    ): (() => void) => {
      assertValidScope(scope);
      if (scope !== StorageScope.Memory) {
        adapter.ensureScopeSubscription(scope);
        const unsubscribe = storageEvents.subscribeKey(scope, key, listener);
        return () => {
          unsubscribe();
          adapter.maybeCleanupScopeSubscription(scope);
        };
      }
      return storageEvents.subscribeKey(scope, key, listener);
    },
    subscribePrefix: (
      scope: StorageScope,
      prefix: string,
      listener: StorageEventListener,
    ): (() => void) => {
      assertValidScope(scope);
      if (scope !== StorageScope.Memory) {
        adapter.ensureScopeSubscription(scope);
        const unsubscribe = storageEvents.subscribePrefix(
          scope,
          prefix,
          listener,
        );
        return () => {
          unsubscribe();
          adapter.maybeCleanupScopeSubscription(scope);
        };
      }
      return storageEvents.subscribePrefix(scope, prefix, listener);
    },
    subscribeNamespace: (
      namespace: string,
      scope: StorageScope,
      listener: StorageEventListener,
    ): (() => void) => {
      return storage.subscribePrefix(scope, prefixKey(namespace, ""), listener);
    },
    setEventObserver: (
      observer?: StorageEventListener,
      options: StorageEventObserverOptions = {},
    ) => {
      eventObserver = observer;
      eventObserverRedactSecureValues = options.redactSecureValues !== false;
      if (observer) {
        adapter.ensureScopeSubscription(StorageScope.Disk);
        adapter.ensureScopeSubscription(StorageScope.Secure);
        return;
      }
      adapter.maybeCleanupScopeSubscription(StorageScope.Disk);
      adapter.maybeCleanupScopeSubscription(StorageScope.Secure);
    },
    clear: (scope: StorageScope, options?: StorageClearOptions) => {
      if (options?.except && options.except.length > 0) {
        clearScopeExcept(scope, options.except);
        return;
      }
      measureOperation("storage:clear", scope, () => {
        const previousValues = shouldReadPreviousEventValues(scope)
          ? storage.getAll(scope)
          : {};
        if (scope === StorageScope.Memory) {
          memoryStore.clear();
          notifyAllListeners(memoryListeners);
          emitBatchChange(
            scope,
            "clear",
            "memory",
            Object.keys(previousValues).map((key) =>
              createKeyChange(
                scope,
                key,
                previousValues[key],
                undefined,
                "clear",
                "memory",
              ),
            ),
          );
          return;
        }

        if (scope === StorageScope.Disk) {
          flushDiskWrites();
          durability.clearAllPendingDiskWrites();
        }

        if (scope === StorageScope.Secure) {
          flushSecureWrites();
          durability.clearAllPendingSecureWrites();
        }

        clearScopeRawCache(scope);
        adapter.backend.clear(scope);
        emitBatchChange(
          scope,
          "clear",
          adapter.changeSource,
          Object.keys(previousValues).map((key) =>
            createKeyChange(
              scope,
              key,
              previousValues[key],
              undefined,
              "clear",
              adapter.changeSource,
            ),
          ),
        );
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
    clearGroup: (group: string) => {
      const items = itemGroups.get(group);
      if (!items || items.size === 0) {
        return;
      }
      measureOperation(
        "storage:clearGroup",
        StorageScope.Memory,
        () => {
          const byScope = new Map<
            StorageScope,
            StorageItemInternal<unknown>[]
          >();
          for (const item of items) {
            const scoped = byScope.get(item.scope);
            if (scoped) {
              scoped.push(item);
            } else {
              byScope.set(item.scope, [item]);
            }
          }
          byScope.forEach((groupItems, scope) => {
            removeBatch(groupItems, scope);
          });
        },
        items.size,
      );
    },
    getGroupItems: (group: string): StorageItem<unknown>[] => {
      const items = itemGroups.get(group);
      return items ? Array.from(items) : [];
    },
    subscribeExpired: (
      scope: StorageScope,
      listener: (event: StorageKeyChangeEvent) => void,
    ): (() => void) => {
      return storage.subscribe(scope, (event) => {
        if (event.type === "key") {
          if (event.operation === "expire") {
            listener(event);
          }
          return;
        }
        event.changes.forEach((change) => {
          if (change.operation === "expire") {
            listener(change);
          }
        });
      });
    },
    findDuplicateKeys: (): {
      key: string;
      scope: StorageScope;
      count: number;
    }[] => {
      const duplicates: { key: string; scope: StorageScope; count: number }[] =
        [];
      registeredKeyCounts.forEach((count, registryKey) => {
        if (count <= 1) {
          return;
        }
        const separatorIndex = registryKey.indexOf(":");
        duplicates.push({
          scope: Number(registryKey.slice(0, separatorIndex)),
          key: registryKey.slice(separatorIndex + 1),
          count,
        });
      });
      return duplicates;
    },
    getRegisteredKeys: (): { key: string; scope: StorageScope }[] => {
      const result: { key: string; scope: StorageScope }[] = [];
      registeredKeyCounts.forEach((_count, registryKey) => {
        const separatorIndex = registryKey.indexOf(":");
        result.push({
          scope: Number(registryKey.slice(0, separatorIndex)),
          key: registryKey.slice(separatorIndex + 1),
        });
      });
      return result;
    },
    clearNamespace: (namespace: string, scope: StorageScope) => {
      measureOperation("storage:clearNamespace", scope, () => {
        assertValidScope(scope);
        if (scope === StorageScope.Memory) {
          const affectedKeys = Array.from(memoryStore.keys()).filter((key) =>
            isNamespaced(key, namespace),
          );
          const previousValues = affectedKeys.map((key) => ({
            key,
            value: getEventRawValue(scope, key),
          }));

          if (affectedKeys.length === 0) {
            return;
          }

          affectedKeys.forEach((key) => {
            memoryStore.delete(key);
          });
          affectedKeys.forEach((key) => {
            notifyKeyListeners(memoryListeners, key);
          });
          emitBatchChange(
            scope,
            "clearNamespace",
            "memory",
            previousValues.map(({ key, value }) =>
              createKeyChange(
                scope,
                key,
                value,
                undefined,
                "clearNamespace",
                "memory",
              ),
            ),
          );
          return;
        }

        const keyPrefix = prefixKey(namespace, "");
        const previousValues = shouldReadPreviousEventValues(scope)
          ? storage.getByPrefix(keyPrefix, scope)
          : {};
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
        adapter.backend.removeByPrefix(keyPrefix, scope);
        emitBatchChange(
          scope,
          "clearNamespace",
          adapter.changeSource,
          Object.keys(previousValues).map((key) =>
            createKeyChange(
              scope,
              key,
              previousValues[key],
              undefined,
              "clearNamespace",
              adapter.changeSource,
            ),
          ),
        );
      });
    },
    clearBiometric: () => {
      measureOperation("storage:clearBiometric", StorageScope.Secure, () => {
        adapter.backend.clearSecureBiometric();
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
        return adapter.backend.has(key, scope);
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
        return adapter.backend.getAllKeys(scope);
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
        return adapter.backend.getKeysByPrefix(prefix, scope);
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
        const values = adapter.backend.getBatch(keys, scope);
        keys.forEach((key, idx) => {
          const value = values[idx];
          if (value !== undefined) {
            result[key] = unescapeCollidingRawValue(value);
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
          for (const key of memoryStore.keys()) {
            const value = memoryStore.get(key);
            if (typeof value === "string")
              result[key] = unescapeCollidingRawValue(value);
          }
          return result;
        }
        if (scope === StorageScope.Disk) {
          flushDiskWrites();
        }
        if (scope === StorageScope.Secure) {
          flushSecureWrites();
        }
        const keys = adapter.backend.getAllKeys(scope);
        if (keys.length === 0) return result;
        const values = adapter.backend.getBatch(keys, scope);
        keys.forEach((key, idx) => {
          const val = values[idx];
          if (val !== undefined) result[key] = unescapeCollidingRawValue(val);
        });
        return result;
      });
    },
    export: (
      scope: StorageScope,
      options: StorageExportOptions = {},
    ): Record<string, string> => {
      if (
        scope === StorageScope.Secure &&
        options.includeSecureValues !== true
      ) {
        throw new Error(
          "NitroStorage: exporting Secure scope exposes raw secret values. Pass { includeSecureValues: true } or use exportSecureUnsafe().",
        );
      }
      return measureOperation("storage:export", scope, () =>
        storage.getAll(scope),
      );
    },
    exportSecureUnsafe: (): Record<string, string> => {
      return measureOperation(
        "storage:exportSecureUnsafe",
        StorageScope.Secure,
        () => storage.getAll(StorageScope.Secure),
      );
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
        return adapter.backend.size(scope);
      });
    },
    setDiskWritesAsync: (enabled: boolean) => {
      measureOperation("storage:setDiskWritesAsync", StorageScope.Disk, () => {
        setDiskWritesAsyncMode(enabled);
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
    setMetricsObserver: (observer?: StorageMetricsObserver) => {
      metrics.setObserver(observer);
    },
    getMetricsSnapshot: (): Record<string, StorageMetricSummary> => {
      return metrics.getSnapshot();
    },
    resetMetrics: () => {
      metrics.reset();
    },
    getSecureMetadata: (key: string): SecureStorageMetadata => {
      return measureOperation(
        "storage:getSecureMetadata",
        StorageScope.Secure,
        () => {
          flushSecureWrites();
          const profile = adapter.getSecureMetadataProfile();
          const biometricProtected = adapter.backend.hasSecureBiometric(key);
          const exists =
            biometricProtected || adapter.backend.has(key, StorageScope.Secure);
          let kind: SecureStorageMetadata["kind"] = "missing";
          if (exists) {
            kind = biometricProtected ? "biometric" : "secure";
          }

          return {
            key,
            exists,
            kind,
            backend: profile.backend,
            encrypted: profile.encrypted,
            hardwareBacked: profile.hardwareBacked,
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
          return adapter.backend
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
          const values = keys.map((k) => data[k] as string);
          const storedValues = values.map(escapeCollidingRawValue);
          const changes = keys.map((key, index) =>
            createKeyChange(
              scope,
              key,
              getEventRawValue(scope, key),
              values[index],
              "import",
              scope === StorageScope.Memory ? "memory" : adapter.changeSource,
            ),
          );

          if (scope === StorageScope.Memory) {
            keys.forEach((key, index) => {
              memoryStore.set(key, storedValues[index]);
            });
            keys.forEach((key) => {
              notifyKeyListeners(memoryListeners, key);
            });
            emitBatchChange(scope, "import", "memory", changes);
            return;
          }

          if (scope === StorageScope.Secure) {
            flushSecureWrites();
            adapter.backend.setSecureAccessControl(secureDefaultAccessControl);
          }
          if (scope === StorageScope.Disk) {
            flushDiskWrites();
          }

          adapter.backend.setBatch(keys, storedValues, scope);
          keys.forEach((key, index) => {
            cacheRawValue(scope, key, storedValues[index]);
          });
          emitBatchChange(scope, "import", adapter.changeSource, changes);
        },
        keys.length,
      );
    },
  };

  function createStorageItem<T = undefined>(
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
    const renameFromKeys: readonly string[] =
      config.renameFrom === undefined
        ? EMPTY_KEYS
        : typeof config.renameFrom === "string"
          ? [config.renameFrom]
          : config.renameFrom;
    const fallbackToCacheOnReadError =
      config.fallbackToCacheOnReadError === true;
    const onReadError = config.onReadError;
    let renamesMigrated = isMemory || renameFromKeys.length === 0;

    if (expiration && expiration.ttlMs <= 0) {
      throw new Error("expiration.ttlMs must be greater than 0.");
    }
    if (config.scope === StorageScope.Secure) {
      assertBiometricLevel(resolvedBiometricLevel);
      if (secureAccessControl !== undefined) {
        assertAccessControlLevel(secureAccessControl);
      }
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

    const resolveNonMemoryScope = (): NonMemoryScope => {
      if (nonMemoryScope === null) {
        throw new Error(
          "NitroStorage: this operation requires Disk or Secure scope.",
        );
      }
      return nonMemoryScope;
    };

    const ensureSubscription = () => {
      if (unsubscribe) {
        return;
      }

      const listener = () => {
        invalidateParsedCache();
        listeners.forEach((callback) => {
          callback();
        });
      };

      if (isMemory) {
        unsubscribe = addKeyListener(memoryListeners, storageKey, listener);
        return;
      }

      adapter.ensureScopeSubscription(resolveNonMemoryScope());
      unsubscribe = addKeyListener(
        getScopedListeners(resolveNonMemoryScope()),
        storageKey,
        listener,
      );
    };

    const readStoredRaw = (): unknown => {
      if (isMemory) {
        if (memoryExpiration) {
          const expiresAt = memoryExpiration.get(storageKey);
          if (expiresAt !== undefined && expiresAt <= Date.now()) {
            const expiredRaw = memoryStore.get(storageKey);
            memoryExpiration.delete(storageKey);
            memoryStore.delete(storageKey);
            notifyKeyListeners(memoryListeners, storageKey);
            emitKeyChange(
              config.scope,
              storageKey,
              typeof expiredRaw === "string"
                ? unescapeCollidingRawValue(expiredRaw)
                : undefined,
              undefined,
              "expire",
              "memory",
            );
            onExpired?.(storageKey);
            return undefined;
          }
        }
        const memoryStored = memoryStore.get(storageKey);
        return typeof memoryStored === "string"
          ? unescapeCollidingRawValue(memoryStored)
          : memoryStored;
      }

      migrateRenamesIfNeeded();

      if (nonMemoryScope === StorageScope.Disk) {
        const pending = durability.readPendingDiskWrite(storageKey);
        if (pending !== undefined) {
          return pending;
        }
      }

      if (nonMemoryScope === StorageScope.Secure && !isBiometric) {
        const pending = durability.readPendingSecureWrite(storageKey);
        if (pending !== undefined) {
          return pending;
        }
      }

      if (readCache) {
        const cache = getScopeRawCache(resolveNonMemoryScope());
        const cached = cache.get(storageKey);
        if (cached !== undefined || cache.has(storageKey)) {
          return cached;
        }
      }

      if (isBiometric) {
        return readBackendRaw(() =>
          adapter.backend.getSecureBiometric(storageKey),
        );
      }

      const raw = readBackendRaw(() =>
        adapter.backend.get(storageKey, config.scope),
      );
      cacheRawValue(resolveNonMemoryScope(), storageKey, raw);
      return raw;
    };

    const readBackendRaw = (
      read: () => string | undefined,
    ): string | undefined => {
      try {
        return read();
      } catch (error) {
        onReadError?.(error);
        if (fallbackToCacheOnReadError) {
          const cached = getScopeRawCache(resolveNonMemoryScope()).get(
            storageKey,
          );
          if (cached !== undefined) {
            return cached;
          }
          return typeof lastRaw === "string" ? lastRaw : undefined;
        }
        throw error;
      }
    };

    const writeStoredRaw = (rawValue: string): void => {
      const oldValue = undefined;
      if (isBiometric) {
        adapter.backend.setSecureBiometricWithLevel(
          storageKey,
          rawValue,
          resolvedBiometricLevel,
        );
        emitKeyChange(
          config.scope,
          storageKey,
          oldValue,
          rawValue,
          "set",
          adapter.changeSource,
        );
        return;
      }

      cacheRawValue(resolveNonMemoryScope(), storageKey, rawValue);

      if (nonMemoryScope === StorageScope.Disk) {
        if (coalesceDiskWrites || isDiskWritesAsync()) {
          scheduleDiskWrite(storageKey, rawValue);
          emitKeyChange(
            config.scope,
            storageKey,
            oldValue,
            rawValue,
            "set",
            adapter.changeSource,
          );
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
        emitKeyChange(
          config.scope,
          storageKey,
          oldValue,
          rawValue,
          "set",
          adapter.changeSource,
        );
        return;
      }

      if (nonMemoryScope === StorageScope.Secure) {
        clearPendingSecureWrite(storageKey);
        if (adapter.applyAccessControlOnSecureRawWrite) {
          adapter.backend.setSecureAccessControl(
            secureAccessControl ?? secureDefaultAccessControl,
          );
        }
      }

      adapter.backend.set(storageKey, rawValue, config.scope);
      emitKeyChange(
        config.scope,
        storageKey,
        oldValue,
        rawValue,
        "set",
        adapter.changeSource,
      );
    };

    const migrateRenamesIfNeeded = (): void => {
      if (renamesMigrated) {
        return;
      }

      try {
        const hasCurrent = isBiometric
          ? adapter.backend.hasSecureBiometric(storageKey)
          : adapter.backend.has(storageKey, config.scope);

        if (hasCurrent) {
          for (const legacyKey of renameFromKeys) {
            if (isBiometric) {
              if (adapter.backend.hasSecureBiometric(legacyKey)) {
                adapter.backend.deleteSecureBiometric(legacyKey);
              }
            } else if (adapter.backend.has(legacyKey, config.scope)) {
              adapter.backend.remove(legacyKey, config.scope);
            }
          }
          renamesMigrated = true;
          return;
        }

        for (const legacyKey of renameFromKeys) {
          const legacyRaw = isBiometric
            ? adapter.backend.getSecureBiometric(legacyKey)
            : adapter.backend.get(legacyKey, config.scope);
          if (legacyRaw === undefined) {
            continue;
          }

          writeStoredRaw(legacyRaw);
          if (isBiometric) {
            adapter.backend.deleteSecureBiometric(legacyKey);
          } else {
            adapter.backend.remove(legacyKey, config.scope);
          }
          break;
        }

        renamesMigrated = true;
      } catch (error) {
        if (isKeychainLockedError(error)) {
          onReadError?.(error);
          return;
        }
        throw error;
      }
    };

    const removeStoredRaw = (
      operation: StorageChangeOperation = "remove",
    ): void => {
      const oldValue = getEventRawValue(config.scope, storageKey);
      if (isBiometric) {
        adapter.backend.deleteSecureBiometric(storageKey);
        emitKeyChange(
          config.scope,
          storageKey,
          oldValue,
          undefined,
          operation,
          adapter.changeSource,
        );
        return;
      }

      cacheRawValue(resolveNonMemoryScope(), storageKey, undefined);

      if (nonMemoryScope === StorageScope.Disk) {
        if (coalesceDiskWrites || isDiskWritesAsync()) {
          scheduleDiskWrite(storageKey, undefined);
          emitKeyChange(
            config.scope,
            storageKey,
            oldValue,
            undefined,
            operation,
            adapter.changeSource,
          );
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
        emitKeyChange(
          config.scope,
          storageKey,
          oldValue,
          undefined,
          operation,
          adapter.changeSource,
        );
        return;
      }

      if (nonMemoryScope === StorageScope.Secure) {
        clearPendingSecureWrite(storageKey);
      }

      adapter.backend.remove(storageKey, config.scope);
      emitKeyChange(
        config.scope,
        storageKey,
        oldValue,
        undefined,
        operation,
        adapter.changeSource,
      );
    };

    const writeValueWithoutValidation = (value: T): void => {
      if (isMemory) {
        const oldValue = getEventRawValue(config.scope, storageKey);
        if (memoryExpiration) {
          memoryExpiration.set(storageKey, Date.now() + (expirationTtlMs ?? 0));
        }
        const storedValue =
          typeof value === "string" ? escapeCollidingRawValue(value) : value;
        memoryStore.set(storageKey, storedValue);
        notifyKeyListeners(memoryListeners, storageKey);
        emitKeyChange(
          config.scope,
          storageKey,
          oldValue,
          typeof value === "string" ? value : undefined,
          "set",
          "memory",
        );
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

          removeStoredRaw("expire");
          invalidateParsedCache();
          onExpired?.(storageKey);
          lastValue = ensureValidatedValue(defaultValue, false);
          hasLastValue = true;
          listeners.forEach((cb) => {
            cb();
          });
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
              removeStoredRaw("expire");
              invalidateParsedCache();
              onExpired?.(storageKey);
              lastValue = ensureValidatedValue(defaultValue, false);
              hasLastValue = true;
              listeners.forEach((cb) => {
                cb();
              });
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
      if (raw === undefined) {
        return toVersionToken(undefined);
      }
      return toVersionToken(
        typeof raw === "string" ? unescapeCollidingRawValue(raw) : raw,
      );
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
          const oldValue = getEventRawValue(config.scope, storageKey);
          if (memoryExpiration) {
            memoryExpiration.delete(storageKey);
          }
          memoryStore.delete(storageKey);
          notifyKeyListeners(memoryListeners, storageKey);
          emitKeyChange(
            config.scope,
            storageKey,
            oldValue,
            undefined,
            "remove",
            "memory",
          );
          return;
        }

        removeStoredRaw();
      });
    };

    const merge = (partial: Partial<T>): void => {
      set((prev) => {
        if (prev === null || typeof prev !== "object") {
          return partial as T;
        }
        return { ...(prev as object), ...(partial as object) } as T;
      });
    };

    const reset = (): void => {
      deleteItem();
    };

    const setOrDelete = (value: T | null | undefined): void => {
      if (value === null || value === undefined) {
        deleteItem();
        return;
      }
      set(value);
    };

    const hasItem = (): boolean =>
      measureOperation("item:has", config.scope, () => {
        if (isMemory) return memoryStore.has(storageKey);
        if (isBiometric) return adapter.backend.hasSecureBiometric(storageKey);
        if (nonMemoryScope === StorageScope.Disk) {
          if (durability.hasPendingDiskWrite(storageKey)) {
            return durability.readPendingDiskWrite(storageKey) !== undefined;
          }
        }
        if (nonMemoryScope === StorageScope.Secure) {
          if (durability.hasPendingSecureWrite(storageKey)) {
            return durability.readPendingSecureWrite(storageKey) !== undefined;
          }
        }
        return adapter.backend.has(storageKey, config.scope);
      });

    const subscribe = (callback: () => void): (() => void) => {
      ensureSubscription();
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0 && unsubscribe) {
          unsubscribe();
          if (!isMemory) {
            adapter.maybeCleanupScopeSubscription(resolveNonMemoryScope());
          }
          unsubscribe = null;
        }
      };
    };

    const subscribeSelector = <TSelected>(
      selector: (value: T) => TSelected,
      listener: StorageSelectorListener<TSelected>,
      options: StorageSelectorSubscribeOptions<TSelected> = {},
    ): (() => void) => {
      const isEqual = options.isEqual ?? Object.is;
      let currentValue = selector(getInternal());

      if (options.fireImmediately === true) {
        listener(currentValue, currentValue);
      }

      return subscribe(() => {
        const nextValue = selector(getInternal());
        if (isEqual(currentValue, nextValue)) {
          return;
        }

        const previousValue = currentValue;
        currentValue = nextValue;
        listener(nextValue, previousValue);
      });
    };

    const storageItem: StorageItemInternal<T> = {
      get,
      getWithVersion,
      set,
      setIfVersion,
      merge,
      reset,
      setOrDelete,
      delete: deleteItem,
      has: hasItem,
      subscribe,
      subscribeSelector,
      serialize,
      deserialize,
      _triggerListeners: () => {
        invalidateParsedCache();
        listeners.forEach((listener) => {
          listener();
        });
      },
      _invalidateParsedCacheOnly: () => {
        invalidateParsedCache();
      },
      _deleteMemoryEntry: () => {
        if (memoryExpiration) {
          memoryExpiration.delete(storageKey);
        }
        memoryStore.delete(storageKey);
        invalidateParsedCache();
      },
      _hasValidation: validate !== undefined,
      _hasExpiration: expiration !== undefined,
      _readCacheEnabled: readCache,
      _isBiometric: isBiometric,
      _biometricLevel: resolvedBiometricLevel,
      _defaultValue: defaultValue,
      ...(secureAccessControl !== undefined
        ? { _secureAccessControl: secureAccessControl }
        : {}),
      ...(config.group !== undefined ? { _group: config.group } : {}),
      scope: config.scope,
      key: storageKey,
    };

    if (config.group !== undefined) {
      let groupSet = itemGroups.get(config.group);
      if (!groupSet) {
        groupSet = new Set();
        itemGroups.set(config.group, groupSet);
      }
      groupSet.add(storageItem as StorageItemInternal<unknown>);
    }

    const registryKey = `${config.scope}:${storageKey}`;
    registeredKeyCounts.set(
      registryKey,
      (registeredKeyCounts.get(registryKey) ?? 0) + 1,
    );

    return storageItem;
  }

  function getBatch<const TItems extends readonly BatchReadItem<unknown>[]>(
    items: TItems,
    scope: StorageScope,
  ): BatchValues<TItems> {
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
            const pending = durability.readPendingDiskWrite(item.key);
            if (pending !== undefined) {
              rawValues[index] = pending;
              return;
            }
          }

          if (scope === StorageScope.Secure) {
            const pending = durability.readPendingSecureWrite(item.key);
            if (pending !== undefined) {
              rawValues[index] = pending;
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
          const fetchedValues = adapter.backend.getBatch(keysToFetch, scope);
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
    ) as BatchValues<TItems>;
  }

  function setBatch<const TItems extends readonly StorageBatchSetCandidate[]>(
    items: StorageBatchSetEntries<TItems>,
    scope: StorageScope,
  ): void;
  function setBatch<T>(
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
            items.forEach(({ item, value }) => {
              item.set(value);
            });
            return;
          }

          const changes = items.map(({ item, value }) =>
            createKeyChange(
              scope,
              item.key,
              getEventRawValue(scope, item.key),
              typeof value === "string" ? value : undefined,
              "setBatch",
              "memory",
            ),
          );

          // Atomic write: update all values in memoryStore, invalidate caches, then batch-notify
          items.forEach(({ item, value }) => {
            memoryStore.set(item.key, value);
            asInternal(
              item as StorageItem<unknown>,
            )._invalidateParsedCacheOnly();
          });
          items.forEach(({ item }) => {
            notifyKeyListeners(memoryListeners, item.key);
          });
          emitBatchChange(scope, "setBatch", "memory", changes);
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
            items.forEach(({ item, value }) => {
              item.set(value);
            });
            return;
          }

          flushSecureWrites();
          const keys = secureEntries.map(({ item }) => item.key);
          const oldValues = shouldReadPreviousEventValues(scope)
            ? adapter.backend
                .getBatch(keys, scope)
                .map((value) =>
                  value === undefined
                    ? undefined
                    : unescapeCollidingRawValue(value),
                )
            : [];
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
            adapter.backend.setSecureAccessControl(accessControl);
            adapter.backend.setBatch(group.keys, group.values, scope);
            group.keys.forEach((key, index) => {
              cacheRawValue(scope, key, group.values[index]);
            });
          });
          emitBatchChange(
            scope,
            "setBatch",
            adapter.changeSource,
            secureEntries.map(({ item, value }, index) =>
              createKeyChange(
                scope,
                item.key,
                oldValues[index],
                item.serialize(value),
                "setBatch",
                adapter.changeSource,
              ),
            ),
          );
          return;
        }

        flushDiskWrites();

        const useRawBatchPath = items.every(({ item }) =>
          canUseRawBatchPath(asInternal(item)),
        );
        if (!useRawBatchPath) {
          items.forEach(({ item, value }) => {
            item.set(value);
          });
          return;
        }

        const keys = items.map((entry) => entry.item.key);
        const values = items.map((entry) => entry.item.serialize(entry.value));
        const oldValues = shouldReadPreviousEventValues(scope)
          ? adapter.backend
              .getBatch(keys, scope)
              .map((value) =>
                value === undefined
                  ? undefined
                  : unescapeCollidingRawValue(value),
              )
          : [];

        adapter.backend.setBatch(keys, values, scope);
        keys.forEach((key, index) => {
          cacheRawValue(scope, key, values[index]);
        });
        emitBatchChange(
          scope,
          "setBatch",
          adapter.changeSource,
          keys.map((key, index) =>
            createKeyChange(
              scope,
              key,
              oldValues[index],
              values[index],
              "setBatch",
              adapter.changeSource,
            ),
          ),
        );
      },
      items.length,
    );
  }

  function removeBatch(
    items: readonly BatchRemoveItem[],
    scope: StorageScope,
  ): void {
    measureOperation(
      "batch:remove",
      scope,
      () => {
        assertBatchScope(items, scope);

        if (scope === StorageScope.Memory) {
          const changes = items.map((item) =>
            createKeyChange(
              scope,
              item.key,
              getEventRawValue(scope, item.key),
              undefined,
              "removeBatch",
              "memory",
            ),
          );
          items.forEach((item) => {
            asInternal(item as StorageItem<unknown>)._deleteMemoryEntry();
          });
          items.forEach((item) => {
            notifyKeyListeners(memoryListeners, item.key);
          });
          emitBatchChange(scope, "removeBatch", "memory", changes);
          return;
        }

        const keys = items.map((item) => item.key);
        if (scope === StorageScope.Disk) {
          flushDiskWrites();
        }
        if (scope === StorageScope.Secure) {
          flushSecureWrites();
        }
        const oldValues = shouldReadPreviousEventValues(scope)
          ? adapter.backend
              .getBatch(keys, scope)
              .map((value) =>
                value === undefined
                  ? undefined
                  : unescapeCollidingRawValue(value),
              )
          : [];
        adapter.backend.removeBatch(keys, scope);
        keys.forEach((key) => {
          cacheRawValue(scope, key, undefined);
        });
        emitBatchChange(
          scope,
          "removeBatch",
          adapter.changeSource,
          keys.map((key, index) =>
            createKeyChange(
              scope,
              key,
              oldValues[index],
              undefined,
              "removeBatch",
              adapter.changeSource,
            ),
          ),
        );
      },
      items.length,
    );
  }

  function registerMigration(version: number, migration: Migration): void {
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error("Migration version must be a positive integer.");
    }

    if (registeredMigrations.has(version)) {
      throw new Error(`Migration version ${version} is already registered.`);
    }

    registeredMigrations.set(version, migration);
  }

  function migrateToLatest(scope: StorageScope = StorageScope.Disk): number {
    return measureOperation("migration:run", scope, () => {
      assertValidScope(scope);
      const currentVersion = readMigrationVersion(scope);
      const versions = Array.from(registeredMigrations.keys())
        .filter((version) => version > currentVersion)
        .sort((a, b) => a - b);

      let appliedVersion = currentVersion;

      versions.forEach((version) => {
        const migration = registeredMigrations.get(version);
        if (!migration) {
          return;
        }
        runTransaction(scope, (tx) => {
          migration(tx);
          tx.setRaw(MIGRATION_VERSION_KEY, String(version));
        });
        appliedVersion = version;
      });

      return appliedVersion;
    });
  }

  function runTransaction<T>(
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
      const rollback = new Map<string, RollbackRecord>();

      const rememberRollback = (
        key: string,
        item?: Pick<StorageItem<unknown>, "key" | "scope">,
      ) => {
        if (rollback.has(key)) {
          return;
        }
        if (scope === StorageScope.Memory) {
          rollback.set(key, {
            kind: "memory",
            value: memoryStore.has(key) ? memoryStore.get(key) : NOT_SET,
          });
        } else {
          const internal = item
            ? (item as StorageItemInternal<unknown>)
            : undefined;
          if (
            scope === StorageScope.Secure &&
            internal?._isBiometric === true
          ) {
            rollback.set(key, {
              kind: "biometric",
              value: adapter.backend.getSecureBiometric(key),
              level: internal._biometricLevel,
            });
            return;
          }
          rollback.set(key, {
            kind: "raw",
            value: getStoredRawValue(key, scope),
            ...(scope === StorageScope.Secure &&
            internal?._secureAccessControl !== undefined
              ? { accessControl: internal._secureAccessControl }
              : {}),
          });
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
          rememberRollback(item.key, item);
          item.set(value);
        },
        removeItem: (item) => {
          assertBatchScope([item], scope);
          rememberRollback(item.key, item);
          item.delete();
        },
      };

      try {
        return transaction(tx);
      } catch (error) {
        const rollbackEntries = Array.from(rollback.entries()).reverse();
        const rollbackSource =
          scope === StorageScope.Memory ? "memory" : adapter.changeSource;
        const preRollbackValues =
          rollbackEntries.length > 0
            ? rollbackEntries.map(([key]) => getEventRawValue(scope, key))
            : [];
        if (scope === StorageScope.Memory) {
          rollbackEntries.forEach(([key, record]) => {
            if (record.value === NOT_SET) {
              memoryStore.delete(key);
            } else {
              memoryStore.set(key, record.value);
            }
            notifyKeyListeners(memoryListeners, key);
          });
        } else {
          const groupedKeysToSet = new Map<
            AccessControl,
            { keys: string[]; values: string[] }
          >();
          const keysToRemove: string[] = [];

          rollbackEntries.forEach(([key, record]) => {
            if (record.kind === "biometric") {
              if (record.value === undefined) {
                adapter.backend.deleteSecureBiometric(key);
              } else {
                adapter.backend.setSecureBiometricWithLevel(
                  key,
                  record.value,
                  record.level,
                );
              }
              return;
            }
            if (record.kind !== "raw") {
              return;
            }
            if (record.value === undefined) {
              keysToRemove.push(key);
            } else {
              const accessControl =
                record.accessControl ?? secureDefaultAccessControl;
              const existingGroup = groupedKeysToSet.get(accessControl);
              const group = existingGroup ?? { keys: [], values: [] };
              group.keys.push(key);
              group.values.push(record.value);
              if (!existingGroup) {
                groupedKeysToSet.set(accessControl, group);
              }
            }
          });

          if (scope === StorageScope.Disk) {
            flushDiskWrites();
          }
          if (scope === StorageScope.Secure) {
            flushSecureWrites();
          }
          groupedKeysToSet.forEach((group, accessControl) => {
            if (scope === StorageScope.Secure) {
              adapter.backend.setSecureAccessControl(accessControl);
            }
            adapter.backend.setBatch(group.keys, group.values, scope);
            group.keys.forEach((key, index) => {
              cacheRawValue(scope, key, group.values[index]);
            });
          });
          if (keysToRemove.length > 0) {
            adapter.backend.removeBatch(keysToRemove, scope);
            keysToRemove.forEach((key) => {
              cacheRawValue(scope, key, undefined);
            });
          }
        }

        if (rollbackEntries.length > 0) {
          emitBatchChange(
            scope,
            "rollback",
            rollbackSource,
            rollbackEntries.map(([key], index) =>
              createKeyChange(
                scope,
                key,
                preRollbackValues[index],
                getEventRawValue(scope, key),
                "rollback",
                rollbackSource,
              ),
            ),
          );
        }
        throw error;
      }
    });
  }

  function createSecureAuthStorage<K extends string>(
    config: SecureAuthStorageConfig<K>,
    options?: {
      namespace?: string;
      group?: string;
      fallbackToCacheOnReadError?: boolean;
    },
  ): Record<K, StorageItem<string>> {
    const ns = options?.namespace ?? "auth";
    const result: Partial<Record<K, StorageItem<string>>> = {};

    for (const key of typedKeys(config)) {
      const itemConfig = config[key];
      const expirationConfig =
        itemConfig.ttlMs !== undefined
          ? { ttlMs: itemConfig.ttlMs }
          : undefined;
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
        ...(itemConfig.renameFrom !== undefined
          ? { renameFrom: itemConfig.renameFrom }
          : {}),
        ...(options?.group !== undefined ? { group: options.group } : {}),
        ...(options?.fallbackToCacheOnReadError !== undefined
          ? { fallbackToCacheOnReadError: options.fallbackToCacheOnReadError }
          : {}),
      });
    }

    return result as Record<K, StorageItem<string>>;
  }

  function memoryItem<T = undefined>(
    config: Omit<StorageItemConfig<T>, "scope">,
  ): StorageItem<T> {
    return createStorageItem<T>({ ...config, scope: StorageScope.Memory });
  }

  function diskItem<T = undefined>(
    config: Omit<StorageItemConfig<T>, "scope">,
  ): StorageItem<T> {
    return createStorageItem<T>({ ...config, scope: StorageScope.Disk });
  }

  function secureItem<T = undefined>(
    config: Omit<StorageItemConfig<T>, "scope">,
  ): StorageItem<T> {
    return createStorageItem<T>({ ...config, scope: StorageScope.Secure });
  }

  function createSetItem<TMember extends string = string>(
    config: SetItemConfig<TMember>,
  ): SetStorageItem<TMember> {
    const { defaultValue, ...rest } = config;
    const initial: Record<string, true> = {};
    if (defaultValue) {
      for (const id of defaultValue) {
        initial[id] = true;
      }
    }

    const item = createStorageItem<Record<string, true>>({
      ...rest,
      defaultValue: initial,
    });

    const has = (id: TMember): boolean => item.get()[id] === true;

    const add = (id: TMember): void => {
      if (item.get()[id] === true) {
        return;
      }
      item.merge({ [id]: true });
    };

    const deleteId = (id: TMember): void => {
      const current = item.get();
      if (current[id] !== true) {
        return;
      }
      const next = { ...current };
      delete next[id];
      item.set(next);
    };

    const toggle = (id: TMember): boolean => {
      if (has(id)) {
        deleteId(id);
        return false;
      }
      add(id);
      return true;
    };

    return {
      get: item.get,
      has,
      add,
      delete: deleteId,
      toggle,
      values: () => Object.keys(item.get()) as TMember[],
      size: () => Object.keys(item.get()).length,
      clear: () => {
        item.set({});
      },
      reset: item.reset,
      subscribe: item.subscribe,
      scope: item.scope,
      key: item.key,
      item,
    };
  }

  return {
    storage,
    createStorageItem,
    memoryItem,
    diskItem,
    secureItem,
    createSetItem,
    getBatch,
    setBatch,
    removeBatch,
    registerMigration,
    migrateToLatest,
    runTransaction,
    createSecureAuthStorage,
    internals,
  };
}

export type StorageCore = ReturnType<typeof createStorageCore>;
