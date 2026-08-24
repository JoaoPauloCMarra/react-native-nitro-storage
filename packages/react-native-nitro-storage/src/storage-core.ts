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
  createStorageCompositeError,
  createKeyChange,
  defaultDeserialize,
  defaultSerialize,
  isKeychainLockedError,
  isUpdater,
  normalizeStorageError,
  notifyAllListeners,
  notifyKeyListeners,
  redactSecureKeyChange,
  typedKeys,
  type ExpirationConfig,
  type KeyListenerRegistry,
  type Migration,
  type NonMemoryScope,
  type PendingDiskWrite,
  type PendingSecureWrite,
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
  _hasRenameFrom: boolean;
  _renameFromKeys: readonly string[];
  _getRenameMigrationState: () => boolean;
  _setRenameMigrationState: (migrated: boolean) => void;
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
  _hasRenameFrom?: boolean;
  _readCacheEnabled?: boolean;
  _isBiometric?: boolean;
  _defaultValue?: unknown;
  _secureAccessControl?: AccessControl;
};
export type BatchRemoveItem = Pick<
  StorageItem<unknown>,
  "key" | "scope" | "delete"
> & {
  _hasRenameFrom?: boolean;
  _isBiometric?: boolean;
};
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
  /** Compatibility shape retained from the original set-item API. */
  get: () => Record<string, true>;
  /** Precise membership shape for new code. */
  getTyped: () => Partial<Record<TMember, true>>;
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

export type StorageRawCacheRepresentation = "plain" | "biometric";

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
    representation?: StorageRawCacheRepresentation,
  ): void;
  readCachedRawValue(
    scope: NonMemoryScope,
    key: string,
    representation?: StorageRawCacheRepresentation,
  ): string | undefined;
  invalidateRawCache(scope: NonMemoryScope, key: string): void;
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
  const memoryExpirationDeadlines = new Map<string, number>();
  const memoryItemsByKey = new Map<string, Set<StorageItemInternal<unknown>>>();
  const memoryListeners: KeyListenerRegistry = new Map();
  const scopedListeners: Record<NonMemoryScope, KeyListenerRegistry> = {
    [StorageScope.Disk]: new Map(),
    [StorageScope.Secure]: new Map(),
  };
  type RawCacheEntry = Map<StorageRawCacheRepresentation, string | undefined>;
  const scopedRawCache: Record<NonMemoryScope, Map<string, RawCacheEntry>> = {
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

  function getScopeRawCache(scope: NonMemoryScope): Map<string, RawCacheEntry> {
    return scopedRawCache[scope];
  }

  function getCachedRawValueEntry(
    scope: NonMemoryScope,
    key: string,
    create = false,
  ): RawCacheEntry | undefined {
    const scopeCache = getScopeRawCache(scope);
    const existing = scopeCache.get(key);
    if (existing || !create) {
      return existing;
    }

    const entry: RawCacheEntry = new Map();
    scopeCache.set(key, entry);
    return entry;
  }

  function cacheRawValue(
    scope: NonMemoryScope,
    key: string,
    value: string | undefined,
    representation: StorageRawCacheRepresentation = "plain",
  ): void {
    getCachedRawValueEntry(scope, key, true)?.set(representation, value);
  }

  function readCachedRawValue(
    scope: NonMemoryScope,
    key: string,
    representation: StorageRawCacheRepresentation = "plain",
  ): string | undefined {
    return getCachedRawValueEntry(scope, key)?.get(representation);
  }

  function hasCachedRawValue(
    scope: NonMemoryScope,
    key: string,
    representation: StorageRawCacheRepresentation = "plain",
  ): boolean {
    return getCachedRawValueEntry(scope, key)?.has(representation) ?? false;
  }

  function invalidateRawCache(scope: NonMemoryScope, key: string): void {
    getScopeRawCache(scope).delete(key);
  }

  function clearScopeRawCache(scope: NonMemoryScope): void {
    getScopeRawCache(scope).clear();
  }

  function invalidateMemoryItemCaches(key: string): void {
    memoryItemsByKey.get(key)?.forEach((item) => {
      item._invalidateParsedCacheOnly();
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

  function getEventRawValueForRepresentation(
    scope: StorageScope,
    key: string,
    representation: StorageRawCacheRepresentation,
  ): string | undefined {
    if (representation === "plain") {
      return getEventRawValue(scope, key);
    }
    const raw = adapter.backend.getSecureBiometric(key);
    return raw === undefined ? undefined : unescapeCollidingRawValue(raw);
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

  function runSecurePromotion<T>(key: string, promotion: () => T): T {
    return durability.runSecurePromotion(key, promotion);
  }

  function scheduleDiskWrite(
    key: string,
    value: string | undefined,
  ): PendingDiskWrite {
    return durability.scheduleDiskWrite(key, value);
  }

  function scheduleSecureWrite(
    key: string,
    value: string | undefined,
    accessControl?: AccessControl,
  ): PendingSecureWrite {
    return durability.scheduleSecureWrite(key, value, accessControl);
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

  function getStoredRawValueForRepresentation(
    key: string,
    scope: StorageScope,
    representation: StorageRawCacheRepresentation,
  ): string | undefined {
    if (representation === "plain") {
      return getStoredRawValue(key, scope);
    }
    return adapter.backend.getSecureBiometric(key);
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
      invalidateRawCache(scope, key);
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
      invalidateRawCache(scope, key);
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
    invalidateRawCache,
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
      if (scope === StorageScope.Secure) {
        removeKeys.forEach((key) => {
          invalidateRawCache(scope, key);
        });
      }
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
          memoryExpirationDeadlines.clear();
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
            memoryExpirationDeadlines.delete(key);
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
        flushSecureWrites();
        const readEventValues = shouldReadPreviousEventValues(
          StorageScope.Secure,
        );
        const shouldEmitChanges =
          storageEvents.hasListeners(StorageScope.Secure) ||
          eventObserver !== undefined;
        const biometricKeys = shouldEmitChanges
          ? adapter.backend
              .getAllKeys(StorageScope.Secure)
              .filter((key) => adapter.backend.hasSecureBiometric(key))
          : [];
        const previousValues = readEventValues
          ? biometricKeys.map((key) => {
              const raw = adapter.backend.getSecureBiometric(key);
              return raw === undefined
                ? undefined
                : unescapeCollidingRawValue(raw);
            })
          : [];

        clearScopeRawCache(StorageScope.Secure);
        try {
          adapter.backend.clearSecureBiometric();
        } finally {
          clearScopeRawCache(StorageScope.Secure);
        }
        emitBatchChange(
          StorageScope.Secure,
          "clear",
          adapter.changeSource,
          biometricKeys.map((key, index) =>
            createKeyChange(
              StorageScope.Secure,
              key,
              readEventValues ? previousValues[index] : undefined,
              undefined,
              "clear",
              adapter.changeSource,
            ),
          ),
        );
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
    getScopedMetricsSnapshot: (): Record<string, StorageMetricSummary> => {
      return metrics.getScopedSnapshot();
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
            keys.forEach((key) => {
              invalidateRawCache(scope, key);
            });
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
      expiration && isMemory ? memoryExpirationDeadlines : null;
    const readCache = !isMemory && config.readCache === true;
    const rawCacheRepresentation: StorageRawCacheRepresentation = isBiometric
      ? "biometric"
      : "plain";
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

      if (nonMemoryScope === StorageScope.Disk) {
        if (durability.hasPendingDiskWrite(storageKey)) {
          return durability.readPendingDiskWrite(storageKey);
        }
      }

      if (nonMemoryScope === StorageScope.Secure && !isBiometric) {
        if (durability.hasPendingSecureWrite(storageKey)) {
          return durability.readPendingSecureWrite(storageKey);
        }
      }

      migrateRenamesIfNeeded();

      if (nonMemoryScope === StorageScope.Disk) {
        if (durability.hasPendingDiskWrite(storageKey)) {
          return durability.readPendingDiskWrite(storageKey);
        }
      }

      if (nonMemoryScope === StorageScope.Secure && !isBiometric) {
        if (durability.hasPendingSecureWrite(storageKey)) {
          return durability.readPendingSecureWrite(storageKey);
        }
      }

      if (readCache) {
        const scope = resolveNonMemoryScope();
        const cached = readCachedRawValue(
          scope,
          storageKey,
          rawCacheRepresentation,
        );
        if (hasCachedRawValue(scope, storageKey, rawCacheRepresentation)) {
          return cached;
        }
      }

      if (isBiometric) {
        const raw = readBackendRaw(() =>
          adapter.backend.getSecureBiometric(storageKey),
        );
        if (readCache) {
          cacheRawValue(
            resolveNonMemoryScope(),
            storageKey,
            raw,
            rawCacheRepresentation,
          );
        }
        return raw;
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
          const scope = resolveNonMemoryScope();
          const cached = readCachedRawValue(
            scope,
            storageKey,
            rawCacheRepresentation,
          );
          if (cached !== undefined) {
            return cached;
          }
          return typeof lastRaw === "string" ? lastRaw : undefined;
        }
        throw error;
      }
    };

    type StoredRawWriteOptions = {
      cleanupRenameSources?: boolean;
    };
    type RenameSnapshot = {
      key: string;
      plainValue?: string;
      biometricValue?: string;
    };

    function getRenameSourceKeys(): string[] {
      return renameFromKeys.filter((key) => key !== storageKey);
    }

    function getRenameSourceRaw(key: string): string | undefined {
      return isBiometric
        ? adapter.backend.getSecureBiometric(key)
        : adapter.backend.get(key, config.scope);
    }

    function invalidateRenameSourceCache(key: string): void {
      if (nonMemoryScope !== null) {
        invalidateRawCache(nonMemoryScope, key);
      }
    }

    function removeRenameSource(key: string): void {
      invalidateRenameSourceCache(key);
      if (isBiometric) {
        adapter.backend.deleteSecureBiometric(key);
        invalidateRenameSourceCache(key);
        return;
      }
      adapter.backend.remove(key, config.scope);
      invalidateRenameSourceCache(key);
    }

    function restoreRenameSource(snapshot: RenameSnapshot): void {
      invalidateRenameSourceCache(snapshot.key);
      if (nonMemoryScope === StorageScope.Secure) {
        if (snapshot.biometricValue !== undefined) {
          adapter.backend.setSecureBiometricWithLevel(
            snapshot.key,
            snapshot.biometricValue,
            resolvedBiometricLevel === BiometricLevel.None
              ? BiometricLevel.BiometryOnly
              : resolvedBiometricLevel,
          );
        } else {
          adapter.backend.deleteSecureBiometric(snapshot.key);
        }
        if (snapshot.plainValue !== undefined) {
          if (adapter.applyAccessControlOnSecureRawWrite) {
            adapter.backend.setSecureAccessControl(
              secureAccessControl ?? secureDefaultAccessControl,
            );
          }
          adapter.backend.set(snapshot.key, snapshot.plainValue, config.scope);
        } else if (snapshot.biometricValue === undefined) {
          adapter.backend.remove(snapshot.key, config.scope);
        }
        invalidateRenameSourceCache(snapshot.key);
        return;
      }
      if (snapshot.plainValue !== undefined) {
        adapter.backend.set(snapshot.key, snapshot.plainValue, config.scope);
      } else {
        adapter.backend.remove(snapshot.key, config.scope);
      }
      invalidateRenameSourceCache(snapshot.key);
    }

    function readRenameSnapshots(): RenameSnapshot[] {
      return getRenameSourceKeys().flatMap((key) => {
        const plainValue =
          nonMemoryScope === StorageScope.Secure
            ? adapter.backend.get(key, config.scope)
            : getRenameSourceRaw(key);
        const biometricValue =
          nonMemoryScope === StorageScope.Secure
            ? adapter.backend.getSecureBiometric(key)
            : undefined;
        if (plainValue === undefined && biometricValue === undefined) {
          return [];
        }
        return [
          {
            key,
            ...(plainValue === undefined ? {} : { plainValue }),
            ...(biometricValue === undefined ? {} : { biometricValue }),
          },
        ];
      });
    }

    function selectedRenameValue(snapshot: RenameSnapshot): string | undefined {
      return isBiometric ? snapshot.biometricValue : snapshot.plainValue;
    }

    function hasPendingCurrentWrite(): boolean {
      if (nonMemoryScope === StorageScope.Disk) {
        return durability.hasPendingDiskWrite(storageKey);
      }
      if (nonMemoryScope === StorageScope.Secure && !isBiometric) {
        return durability.hasPendingSecureWrite(storageKey);
      }
      return false;
    }

    function hasPendingRenameSourceWrite(): boolean {
      if (isBiometric || nonMemoryScope === null) {
        return false;
      }
      return getRenameSourceKeys().some((key) =>
        nonMemoryScope === StorageScope.Disk
          ? durability.hasPendingDiskWrite(key)
          : durability.hasPendingSecureWrite(key),
      );
    }

    function flushPendingRenameSourceWrites(): void {
      if (!hasPendingRenameSourceWrite()) {
        return;
      }
      if (nonMemoryScope === StorageScope.Disk) {
        flushDiskWrites();
        return;
      }
      flushSecureWrites();
    }

    function clearPendingCurrentWriteIf(
      write: PendingDiskWrite | PendingSecureWrite | undefined,
    ): void {
      if (write === undefined) {
        return;
      }
      if (nonMemoryScope === StorageScope.Disk && "generation" in write) {
        durability.clearPendingDiskWriteIf(write);
        return;
      }
      if (nonMemoryScope === StorageScope.Secure && !isBiometric) {
        durability.clearPendingSecureWriteIf(write);
      }
    }

    function flushPendingCurrentWrite(): void {
      if (nonMemoryScope === StorageScope.Disk) {
        flushDiskWrites();
        return;
      }
      if (nonMemoryScope === StorageScope.Secure && !isBiometric) {
        flushSecureWrites();
      }
    }

    function removeCurrentBackendValue(): void {
      invalidateRawCache(resolveNonMemoryScope(), storageKey);
      if (isBiometric) {
        adapter.backend.deleteSecureBiometric(storageKey);
        return;
      }
      adapter.backend.remove(storageKey, config.scope);
    }

    function scheduleRenameSourceCleanup(): void {
      const sourceKeys = getRenameSourceKeys();
      sourceKeys.forEach(invalidateRenameSourceCache);

      if (isBiometric) {
        sourceKeys.forEach(removeRenameSource);
        return;
      }

      if (
        nonMemoryScope === StorageScope.Disk &&
        (coalesceDiskWrites || isDiskWritesAsync())
      ) {
        sourceKeys.forEach((key) => {
          scheduleDiskWrite(key, undefined);
        });
        return;
      }

      if (nonMemoryScope === StorageScope.Secure && coalesceSecureWrites) {
        sourceKeys.forEach((key) => {
          scheduleSecureWrite(
            key,
            undefined,
            secureAccessControl ?? secureDefaultAccessControl,
          );
        });
        return;
      }

      sourceKeys.forEach(removeRenameSource);
    }

    type ItemPendingSnapshot = {
      value: string | undefined;
      accessControl?: AccessControl;
    };
    type ItemStateRecord = {
      key: string;
      plainValue: string | undefined;
      biometricValue: string | undefined;
      pending?: ItemPendingSnapshot;
    };
    type ItemStateSnapshot = {
      records: readonly ItemStateRecord[];
      renamesMigrated: boolean;
    };

    let atomicMutationDepth = 0;

    function getItemStateKeys(): string[] {
      return Array.from(new Set([storageKey, ...getRenameSourceKeys()]));
    }

    function captureItemState(): ItemStateSnapshot {
      const records = getItemStateKeys().map((key) => {
        let pending: ItemPendingSnapshot | undefined;
        if (nonMemoryScope === StorageScope.Disk) {
          if (durability.hasPendingDiskWrite(key)) {
            pending = {
              value: durability.readPendingDiskWrite(key),
            };
          }
        } else if (
          nonMemoryScope === StorageScope.Secure &&
          !isBiometric &&
          durability.hasPendingSecureWrite(key)
        ) {
          const accessControl = durability.readPendingSecureAccessControl(key);
          pending = {
            value: durability.readPendingSecureWrite(key),
            ...(accessControl === undefined ? {} : { accessControl }),
          };
        }

        return {
          key,
          plainValue:
            nonMemoryScope === null
              ? undefined
              : adapter.backend.get(key, config.scope),
          biometricValue:
            nonMemoryScope === StorageScope.Secure
              ? adapter.backend.getSecureBiometric(key)
              : undefined,
          ...(pending === undefined ? {} : { pending }),
        };
      });
      return { records, renamesMigrated };
    }

    function clearPendingItemWrite(key: string): void {
      if (nonMemoryScope === StorageScope.Disk) {
        durability.clearPendingDiskWrite(key);
      } else if (nonMemoryScope === StorageScope.Secure && !isBiometric) {
        durability.clearPendingSecureWrite(key);
      }
    }

    function restoreItemState(snapshot: ItemStateSnapshot): {
      label: string;
      error: unknown;
    }[] {
      const rollbackErrors: { label: string; error: unknown }[] = [];
      const recordsByKey = new Map(
        snapshot.records.map((record) => [record.key, record]),
      );
      snapshot.records.forEach(({ key }) => {
        clearPendingItemWrite(key);
        if (nonMemoryScope !== null) {
          invalidateRawCache(nonMemoryScope, key);
        }
      });

      const biometricRecords = snapshot.records.filter(
        ({ biometricValue }) => biometricValue !== undefined,
      );
      if (nonMemoryScope === StorageScope.Secure) {
        biometricRecords.forEach(({ key, biometricValue }) => {
          try {
            adapter.backend.setSecureBiometricWithLevel(
              key,
              biometricValue as string,
              resolvedBiometricLevel === BiometricLevel.None
                ? BiometricLevel.BiometryOnly
                : resolvedBiometricLevel,
            );
            cacheRawValue(
              StorageScope.Secure,
              key,
              biometricValue,
              "biometric",
            );
          } catch (error) {
            rollbackErrors.push({ label: "rollback biometric", error });
          }
        });
      }

      const plainSets = new Map<
        AccessControl,
        { keys: string[]; values: string[] }
      >();
      const plainRemoves: string[] = [];
      snapshot.records.forEach(({ key, plainValue, biometricValue }) => {
        if (plainValue === undefined) {
          if (biometricValue === undefined) {
            plainRemoves.push(key);
          }
          return;
        }
        const accessControl = secureAccessControl ?? secureDefaultAccessControl;
        const group = plainSets.get(accessControl) ?? { keys: [], values: [] };
        group.keys.push(key);
        group.values.push(plainValue);
        plainSets.set(accessControl, group);
      });

      plainSets.forEach((group, accessControl) => {
        try {
          if (nonMemoryScope === StorageScope.Secure) {
            adapter.backend.setSecureAccessControl(accessControl);
          }
          adapter.backend.setBatch(group.keys, group.values, config.scope);
          group.keys.forEach((key, index) => {
            cacheRawValue(
              resolveNonMemoryScope(),
              key,
              group.values[index],
              "plain",
            );
          });
        } catch (error) {
          rollbackErrors.push({ label: "rollback plain set", error });
        }
      });

      if (plainRemoves.length > 0) {
        try {
          adapter.backend.removeBatch(plainRemoves, config.scope);
          plainRemoves.forEach((key) => {
            cacheRawValue(resolveNonMemoryScope(), key, undefined, "plain");
          });
        } catch (error) {
          rollbackErrors.push({ label: "rollback plain remove", error });
        }
      }

      if (nonMemoryScope === StorageScope.Secure) {
        snapshot.records.forEach(({ key, biometricValue }) => {
          if (biometricValue !== undefined) {
            return;
          }
          try {
            adapter.backend.deleteSecureBiometric(key);
            cacheRawValue(StorageScope.Secure, key, undefined, "biometric");
          } catch (error) {
            rollbackErrors.push({ label: "rollback biometric remove", error });
          }
        });
      }

      snapshot.records.forEach(({ key, pending }) => {
        if (pending === undefined || nonMemoryScope === null) {
          return;
        }
        if (nonMemoryScope === StorageScope.Disk) {
          scheduleDiskWrite(key, pending.value);
        } else if (!isBiometric) {
          scheduleSecureWrite(
            key,
            pending.value,
            pending.accessControl ??
              secureAccessControl ??
              secureDefaultAccessControl,
          );
        }
      });

      recordsByKey.forEach(({ key }) => {
        if (nonMemoryScope !== null) {
          invalidateRawCache(nonMemoryScope, key);
        }
      });
      renamesMigrated = snapshot.renamesMigrated;
      invalidateParsedCache();
      return rollbackErrors;
    }

    function runAtomicItemMutation(mutation: () => void): void {
      if (isMemory || renameFromKeys.length === 0 || atomicMutationDepth > 0) {
        mutation();
        return;
      }

      const snapshot = captureItemState();
      atomicMutationDepth += 1;
      try {
        mutation();
      } catch (primaryError) {
        const rollbackErrors = restoreItemState(snapshot);
        if (rollbackErrors.length > 0) {
          throw createStorageCompositeError(
            "item mutation rollback",
            primaryError,
            rollbackErrors,
          );
        }
        throw primaryError;
      } finally {
        atomicMutationDepth -= 1;
      }
    }

    const writeStoredRaw = (
      rawValue: string,
      options: StoredRawWriteOptions = {},
    ): PendingDiskWrite | PendingSecureWrite | undefined => {
      const cleanupRenameSources = options.cleanupRenameSources !== false;
      const oldValue = undefined;
      if (isBiometric) {
        invalidateRawCache(StorageScope.Secure, storageKey);
        runSecurePromotion(storageKey, () => {
          try {
            adapter.backend.setSecureBiometricWithLevel(
              storageKey,
              rawValue,
              resolvedBiometricLevel,
            );
          } catch (error) {
            throw normalizeStorageError(error);
          }
        });
        if (cleanupRenameSources) {
          scheduleRenameSourceCleanup();
        }
        emitKeyChange(
          config.scope,
          storageKey,
          oldValue,
          rawValue,
          "set",
          adapter.changeSource,
        );
        return undefined;
      }

      if (nonMemoryScope === StorageScope.Secure) {
        invalidateRawCache(StorageScope.Secure, storageKey);
      }
      cacheRawValue(resolveNonMemoryScope(), storageKey, rawValue);

      if (nonMemoryScope === StorageScope.Disk) {
        if (coalesceDiskWrites || isDiskWritesAsync()) {
          const pendingWrite = scheduleDiskWrite(storageKey, rawValue);
          if (cleanupRenameSources) {
            scheduleRenameSourceCleanup();
          }
          emitKeyChange(
            config.scope,
            storageKey,
            oldValue,
            rawValue,
            "set",
            adapter.changeSource,
          );
          return pendingWrite;
        }

        clearPendingDiskWrite(storageKey);
      }

      if (coalesceSecureWrites) {
        const pendingWrite = scheduleSecureWrite(
          storageKey,
          rawValue,
          secureAccessControl ?? secureDefaultAccessControl,
        );
        if (cleanupRenameSources) {
          scheduleRenameSourceCleanup();
        }
        emitKeyChange(
          config.scope,
          storageKey,
          oldValue,
          rawValue,
          "set",
          adapter.changeSource,
        );
        return pendingWrite;
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
      if (cleanupRenameSources) {
        scheduleRenameSourceCleanup();
      }
      emitKeyChange(
        config.scope,
        storageKey,
        oldValue,
        rawValue,
        "set",
        adapter.changeSource,
      );
      return undefined;
    };

    const migrateRenamesIfNeeded = (): void => {
      if (renamesMigrated) {
        return;
      }

      try {
        flushPendingRenameSourceWrites();
        const hasCurrent = isBiometric
          ? adapter.backend.hasSecureBiometric(storageKey)
          : adapter.backend.has(storageKey, config.scope);
        const snapshots = readRenameSnapshots();

        if (hasCurrent) {
          try {
            snapshots.forEach(({ key }) => {
              removeRenameSource(key);
            });
          } catch (primaryError) {
            const rollbackErrors: { label: string; error: unknown }[] = [];
            snapshots.forEach((snapshot) => {
              try {
                restoreRenameSource(snapshot);
              } catch (error) {
                rollbackErrors.push({
                  label: "rollback rename source",
                  error,
                });
              }
            });
            if (rollbackErrors.length > 0) {
              throw createStorageCompositeError(
                "rename cleanup",
                primaryError,
                rollbackErrors,
              );
            }
            throw primaryError;
          }
          renamesMigrated = true;
          return;
        }

        const snapshot = snapshots.find(
          (candidate) => selectedRenameValue(candidate) !== undefined,
        );
        if (snapshot === undefined) {
          renamesMigrated = true;
          return;
        }

        let writeAttempted = false;
        let pendingCurrentWrite:
          PendingDiskWrite | PendingSecureWrite | undefined;
        try {
          writeAttempted = true;
          pendingCurrentWrite = writeStoredRaw(
            selectedRenameValue(snapshot) as string,
            {
              cleanupRenameSources: false,
            },
          );
          if (hasPendingCurrentWrite()) {
            flushPendingCurrentWrite();
          }
          snapshots.forEach(({ key }) => {
            removeRenameSource(key);
          });
          renamesMigrated = true;
        } catch (primaryError) {
          const rollbackErrors: { label: string; error: unknown }[] = [];
          clearPendingCurrentWriteIf(pendingCurrentWrite);
          if (writeAttempted) {
            try {
              removeCurrentBackendValue();
            } catch (error) {
              rollbackErrors.push({ label: "rollback current value", error });
            }
          }
          snapshots.forEach((renameSnapshot) => {
            try {
              restoreRenameSource(renameSnapshot);
            } catch (error) {
              rollbackErrors.push({
                label: "rollback rename source",
                error,
              });
            }
          });
          invalidateRawCache(resolveNonMemoryScope(), storageKey);
          snapshots.forEach(({ key }) => {
            invalidateRenameSourceCache(key);
          });
          if (rollbackErrors.length > 0) {
            throw createStorageCompositeError(
              "rename migration",
              primaryError,
              rollbackErrors,
            );
          }
          throw primaryError;
        }
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
      const oldValue = isBiometric
        ? getEventRawValueForRepresentation(
            config.scope,
            storageKey,
            "biometric",
          )
        : getEventRawValue(config.scope, storageKey);
      if (isBiometric) {
        invalidateRawCache(StorageScope.Secure, storageKey);
        scheduleRenameSourceCleanup();
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

      if (nonMemoryScope === StorageScope.Secure) {
        invalidateRawCache(StorageScope.Secure, storageKey);
      }
      cacheRawValue(resolveNonMemoryScope(), storageKey, undefined);

      if (nonMemoryScope === StorageScope.Disk) {
        if (coalesceDiskWrites || isDiskWritesAsync()) {
          scheduleDiskWrite(storageKey, undefined);
          scheduleRenameSourceCleanup();
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
        scheduleRenameSourceCleanup();
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

      scheduleRenameSourceCleanup();
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
        } else {
          memoryExpirationDeadlines.delete(storageKey);
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

          runAtomicItemMutation(() => {
            removeStoredRaw("expire");
          });
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
              runAtomicItemMutation(() => {
                removeStoredRaw("expire");
              });
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
        runAtomicItemMutation(() => {
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
      });
    };

    const setIfVersion = (
      version: StorageVersion,
      valueOrFn: T | ((prev: T) => T),
    ): boolean =>
      measureOperation("item:setIfVersion", config.scope, () => {
        let didSet = false;
        runAtomicItemMutation(() => {
          const currentVersion = getCurrentVersion();
          if (currentVersion !== version) {
            return;
          }
          set(valueOrFn);
          didSet = true;
        });
        return didSet;
      });

    const deleteItem = (): void => {
      measureOperation("item:delete", config.scope, () => {
        runAtomicItemMutation(() => {
          invalidateParsedCache();

          if (isMemory) {
            const oldValue = getEventRawValue(config.scope, storageKey);
            if (memoryExpiration) {
              memoryExpiration.delete(storageKey);
            }
            memoryExpirationDeadlines.delete(storageKey);
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
        memoryExpirationDeadlines.delete(storageKey);
        memoryStore.delete(storageKey);
        invalidateParsedCache();
      },
      _hasValidation: validate !== undefined,
      _hasExpiration: expiration !== undefined,
      _hasRenameFrom: renameFromKeys.length > 0,
      _renameFromKeys: renameFromKeys,
      _getRenameMigrationState: () => renamesMigrated,
      _setRenameMigrationState: (migrated) => {
        renamesMigrated = migrated;
      },
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

    if (isMemory) {
      let items = memoryItemsByKey.get(storageKey);
      if (!items) {
        items = new Set();
        memoryItemsByKey.set(storageKey, items);
      }
      items.add(storageItem as StorageItemInternal<unknown>);
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
            if (durability.hasPendingDiskWrite(item.key)) {
              rawValues[index] = durability.readPendingDiskWrite(item.key);
              return;
            }
          }

          if (scope === StorageScope.Secure) {
            if (durability.hasPendingSecureWrite(item.key)) {
              rawValues[index] = durability.readPendingSecureWrite(item.key);
              return;
            }
          }

          if (item._readCacheEnabled === true) {
            const cached = readCachedRawValue(scope, item.key);
            if (hasCachedRawValue(scope, item.key)) {
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
          keys.forEach((key) => {
            invalidateRawCache(scope, key);
          });
          const serializedValues: string[] = [];
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
            const serialized = item.serialize(value);
            serializedValues.push(serialized);
            const accessControl =
              internal._secureAccessControl ?? secureDefaultAccessControl;
            const existingGroup = groupedByAccessControl.get(accessControl);
            const group = existingGroup ?? { keys: [], values: [] };
            group.keys.push(item.key);
            group.values.push(serialized);
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
          const willEmitChanges =
            storageEvents.hasListeners(scope) || eventObserver !== undefined;
          emitBatchChange(
            scope,
            "setBatch",
            adapter.changeSource,
            willEmitChanges
              ? keys.map((key, index) =>
                  createKeyChange(
                    scope,
                    key,
                    oldValues[index],
                    serializedValues[index],
                    "setBatch",
                    adapter.changeSource,
                  ),
                )
              : [],
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

        if (
          items.some(
            (item) => asInternal(item as StorageItem<unknown>)._hasRenameFrom,
          )
        ) {
          items.forEach((item) => {
            asInternal(item as StorageItem<unknown>).delete();
          });
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
          ? (() => {
              const plainItems = items.filter(
                (item) =>
                  asInternal(item as StorageItem<unknown>)._isBiometric !==
                  true,
              );
              const plainValues =
                plainItems.length === 0
                  ? []
                  : adapter.backend
                      .getBatch(
                        plainItems.map((item) => item.key),
                        scope,
                      )
                      .map((value) =>
                        value === undefined
                          ? undefined
                          : unescapeCollidingRawValue(value),
                      );
              let plainIndex = 0;
              return items.map((item) => {
                const internal = asInternal(item as StorageItem<unknown>);
                if (internal._isBiometric === true) {
                  return getEventRawValueForRepresentation(
                    scope,
                    item.key,
                    "biometric",
                  );
                }
                const value = plainValues[plainIndex];
                plainIndex += 1;
                return value;
              });
            })()
          : [];
        if (scope === StorageScope.Secure) {
          keys.forEach((key) => {
            invalidateRawCache(scope, key);
          });
        }
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
      type TransactionRollbackEntry = {
        key: string;
        representation: StorageRawCacheRepresentation;
        record: RollbackRecord;
      };
      const rollback = new Map<string, TransactionRollbackEntry>();
      const itemRenameStates = new Map<StorageItemInternal<unknown>, boolean>();

      const rememberRollback = (
        key: string,
        item?: Pick<StorageItem<unknown>, "key" | "scope">,
        includeOtherSecureRepresentation = false,
      ) => {
        const internal = item
          ? (item as StorageItemInternal<unknown>)
          : undefined;
        const representation: StorageRawCacheRepresentation =
          scope === StorageScope.Secure && internal?._isBiometric === true
            ? "biometric"
            : "plain";
        const rememberRepresentation = (
          representationToRemember: StorageRawCacheRepresentation,
        ) => {
          const identity = JSON.stringify([
            scope,
            key,
            representationToRemember,
          ]);
          if (rollback.has(identity)) {
            return;
          }
          if (scope === StorageScope.Memory) {
            const expiresAt = memoryExpirationDeadlines.get(key);
            rollback.set(identity, {
              key,
              representation: representationToRemember,
              record: {
                kind: "memory",
                value: memoryStore.has(key) ? memoryStore.get(key) : NOT_SET,
                ...(expiresAt === undefined ? {} : { expiresAt }),
              },
            });
            return;
          }
          if (representationToRemember === "biometric") {
            rollback.set(identity, {
              key,
              representation: representationToRemember,
              record: {
                kind: "biometric",
                value: getStoredRawValueForRepresentation(
                  key,
                  scope,
                  representationToRemember,
                ),
                level:
                  internal?._biometricLevel !== undefined &&
                  internal._biometricLevel !== BiometricLevel.None
                    ? internal._biometricLevel
                    : BiometricLevel.BiometryOnly,
              },
            });
            return;
          }
          rollback.set(identity, {
            key,
            representation: representationToRemember,
            record: {
              kind: "raw",
              value: getStoredRawValueForRepresentation(
                key,
                scope,
                representationToRemember,
              ),
              ...(scope === StorageScope.Secure &&
              internal?._secureAccessControl !== undefined
                ? { accessControl: internal._secureAccessControl }
                : {}),
            },
          });
        };

        if (
          representation === "biometric" ||
          includeOtherSecureRepresentation
        ) {
          rememberRepresentation("plain");
        }
        rememberRepresentation(representation);
        if (includeOtherSecureRepresentation) {
          rememberRepresentation("biometric");
        }
      };

      const rememberItemRollback = (
        item: Pick<StorageItem<unknown>, "key" | "scope">,
      ): void => {
        const internal = item as StorageItemInternal<unknown>;
        const includeOtherSecureRepresentation =
          scope === StorageScope.Secure &&
          (internal._isBiometric === true || internal._hasRenameFrom === true);
        rememberRollback(item.key, item, includeOtherSecureRepresentation);
        if (internal._getRenameMigrationState) {
          if (!itemRenameStates.has(internal)) {
            itemRenameStates.set(internal, internal._getRenameMigrationState());
          }
        }
        (internal._renameFromKeys ?? EMPTY_KEYS).forEach((aliasKey) => {
          rememberRollback(aliasKey, item, true);
        });
      };

      const tx: TransactionContext = {
        scope,
        getRaw: (key) => getRawValue(key, scope),
        setRaw: (key, value) => {
          rememberRollback(key);
          setRawValue(key, value, scope);
        },
        removeRaw: (key) => {
          rememberRollback(key, undefined, scope === StorageScope.Secure);
          removeRawValue(key, scope);
        },
        getItem: (item) => {
          assertBatchScope([item], scope);
          rememberItemRollback(item);
          return item.get();
        },
        setItem: (item, value) => {
          assertBatchScope([item], scope);
          rememberItemRollback(item);
          item.set(value);
        },
        removeItem: (item) => {
          assertBatchScope([item], scope);
          rememberItemRollback(item);
          item.delete();
        },
      };

      try {
        return transaction(tx);
      } catch (error) {
        itemRenameStates.forEach((migrated, item) => {
          item._setRenameMigrationState(migrated);
        });
        const rollbackEntries = Array.from(rollback.values()).reverse();
        const rollbackSource =
          scope === StorageScope.Memory ? "memory" : adapter.changeSource;
        const rollbackErrors: { label: string; error: unknown }[] = [];
        const readRollbackEventValue = (
          entry: TransactionRollbackEntry,
        ): string | undefined => {
          try {
            return getEventRawValueForRepresentation(
              scope,
              entry.key,
              entry.representation,
            );
          } catch (readError) {
            rollbackErrors.push({
              label: `rollback read ${entry.representation}:${entry.key}`,
              error: readError,
            });
            return undefined;
          }
        };
        const preRollbackValues = rollbackEntries.map(readRollbackEventValue);
        if (scope === StorageScope.Memory) {
          rollbackEntries.forEach((entry) => {
            try {
              const record = entry.record;
              if (record.kind !== "memory") {
                return;
              }
              if (record.value === NOT_SET) {
                memoryStore.delete(entry.key);
              } else {
                memoryStore.set(entry.key, record.value);
              }
              if (record.expiresAt === undefined) {
                memoryExpirationDeadlines.delete(entry.key);
              } else {
                memoryExpirationDeadlines.set(entry.key, record.expiresAt);
              }
              invalidateMemoryItemCaches(entry.key);
              notifyKeyListeners(memoryListeners, entry.key);
            } catch (rollbackError) {
              rollbackErrors.push({
                label: `rollback ${entry.representation}:${entry.key}`,
                error: rollbackError,
              });
            }
          });
        } else {
          const groupedKeysToSet = new Map<
            AccessControl,
            { keys: string[]; values: string[] }
          >();
          const keysToRemove: string[] = [];
          const biometricEntries: TransactionRollbackEntry[] = [];
          const biometricValues = new Map<string, string | undefined>();

          rollbackEntries.forEach((entry) => {
            const { key, record } = entry;
            if (record.kind === "biometric") {
              biometricEntries.push(entry);
              biometricValues.set(key, record.value);
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
            try {
              flushDiskWrites();
            } catch (flushError) {
              rollbackErrors.push({
                label: "rollback flush disk",
                error: flushError,
              });
            }
          }
          if (scope === StorageScope.Secure) {
            try {
              flushSecureWrites();
            } catch (flushError) {
              rollbackErrors.push({
                label: "rollback flush secure",
                error: flushError,
              });
            }
          }
          if (scope === StorageScope.Secure) {
            rollbackEntries.forEach((entry) => {
              invalidateRawCache(scope, entry.key);
            });
          }
          biometricEntries.forEach((entry) => {
            const { key, record } = entry;
            if (record.kind !== "biometric" || record.value === undefined) {
              return;
            }
            try {
              adapter.backend.setSecureBiometricWithLevel(
                key,
                record.value,
                record.level,
              );
              cacheRawValue(
                StorageScope.Secure,
                key,
                record.value,
                "biometric",
              );
            } catch (rollbackError) {
              rollbackErrors.push({
                label: "rollback biometric",
                error: rollbackError,
              });
            }
          });
          groupedKeysToSet.forEach((group, accessControl) => {
            try {
              if (scope === StorageScope.Secure) {
                adapter.backend.setSecureAccessControl(accessControl);
              }
              adapter.backend.setBatch(group.keys, group.values, scope);
              group.keys.forEach((key, index) => {
                cacheRawValue(scope, key, group.values[index], "plain");
              });
            } catch (rollbackError) {
              rollbackErrors.push({
                label: "rollback plain setBatch",
                error: rollbackError,
              });
            }
          });
          if (keysToRemove.length > 0) {
            const keysToRemoveWithoutBiometric = keysToRemove.filter(
              (key) => biometricValues.get(key) === undefined,
            );
            try {
              if (keysToRemoveWithoutBiometric.length > 0) {
                adapter.backend.removeBatch(
                  keysToRemoveWithoutBiometric,
                  scope,
                );
              }
              keysToRemove.forEach((key) => {
                cacheRawValue(scope, key, undefined, "plain");
              });
            } catch (rollbackError) {
              rollbackErrors.push({
                label: "rollback plain removeBatch",
                error: rollbackError,
              });
            }
          }
          biometricEntries.forEach((entry) => {
            const { key, record } = entry;
            if (record.kind !== "biometric") {
              return;
            }
            if (record.value !== undefined) {
              return;
            }
            invalidateRawCache(StorageScope.Secure, key);
            try {
              adapter.backend.deleteSecureBiometric(key);
              cacheRawValue(
                StorageScope.Secure,
                key,
                record.value,
                "biometric",
              );
            } catch (rollbackError) {
              rollbackErrors.push({
                label: "rollback biometric",
                error: rollbackError,
              });
            }
          });
        }

        if (rollbackEntries.length > 0) {
          emitBatchChange(
            scope,
            "rollback",
            rollbackSource,
            rollbackEntries.map((entry, index) =>
              createKeyChange(
                scope,
                entry.key,
                preRollbackValues[index],
                readRollbackEventValue(entry),
                "rollback",
                rollbackSource,
              ),
            ),
          );
        }
        if (rollbackErrors.length > 0) {
          throw createStorageCompositeError(
            "transaction rollback",
            error,
            rollbackErrors,
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
      const current = item.get();
      if (current[id] === true) {
        return;
      }
      const next = { ...current };
      next[id] = true;
      item.set(next);
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

    const getTyped = (): Partial<Record<TMember, true>> => {
      const typed: Partial<Record<TMember, true>> = {};
      for (const id of Object.keys(item.get())) {
        typed[id as TMember] = true;
      }
      return typed;
    };

    return {
      get: item.get,
      getTyped,
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
