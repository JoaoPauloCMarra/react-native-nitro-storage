import { StorageScope, AccessControl, BiometricLevel } from "./Storage.types";
import {
  MIGRATION_VERSION_KEY,
  type StoredEnvelope,
  isStoredEnvelope,
  assertBatchScope,
  assertValidScope,
  serializeWithPrimitiveFastPath,
  deserializeWithPrimitiveFastPath,
  toVersionToken,
  prefixKey,
  isNamespaced,
} from "./internal";
import {
  createLocalStorageWebBackend,
  type WebDiskStorageBackend,
  type WebSecureStorageBackend,
  type WebStorageBackend,
  type WebStorageChangeEvent,
} from "./web-storage-backend";
import {
  getStorageErrorCode,
  isLockedStorageErrorCode,
  type SecureStorageMetadata,
  type SecurityCapabilities,
  type StorageCapabilities,
  type StorageErrorCode,
} from "./storage-runtime";
import {
  StorageEventRegistry,
  type StorageBatchChangeEvent,
  type StorageChangeEvent,
  type StorageChangeOperation,
  type StorageChangeSource,
  type StorageEventListener,
  type StorageKeyChangeEvent,
} from "./storage-events";

export { StorageScope, AccessControl, BiometricLevel } from "./Storage.types";
export { migrateFromMMKV } from "./migration";
export {
  getStorageErrorCode,
  type SecureStorageMetadata,
  type SecurityCapabilities,
  type StorageCapabilities,
  type StorageErrorCode,
} from "./storage-runtime";
export type {
  StorageBatchChangeEvent,
  StorageChangeEvent,
  StorageChangeOperation,
  StorageChangeSource,
  StorageEventListener,
  StorageKeyChangeEvent,
} from "./storage-events";
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
export type StorageSelectorListener<TSelected> = (
  value: TSelected,
  previousValue: TSelected,
) => void;
export type StorageSelectorSubscribeOptions<TSelected> = {
  isEqual?: (previousValue: TSelected, nextValue: TSelected) => boolean;
  fireImmediately?: boolean;
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
  getKeysByPrefix(prefix: string, scope: number): string[];
  size(scope: number): number;
  setBatch(keys: string[], values: string[], scope: number): void;
  getBatch(keys: string[], scope: number): (string | undefined)[];
  removeBatch(keys: string[], scope: number): void;
  removeByPrefix(prefix: string, scope: number): void;
  addOnChange(
    scope: number,
    callback: (key: string, value: string | undefined) => void,
  ): () => void;
  setSecureAccessControl(level: number): void;
  setSecureWritesAsync(enabled: boolean): void;
  setKeychainAccessGroup(group: string): void;
  setSecureBiometric(key: string, value: string): void;
  setSecureBiometricWithLevel(key: string, value: string, level: number): void;
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
const webScopeKeyIndex = new Map<NonMemoryScope, Set<string>>([
  [StorageScope.Disk, new Set()],
  [StorageScope.Secure, new Set()],
]);
const hydratedWebScopeKeyIndex = new Set<NonMemoryScope>();
const pendingDiskWrites = new Map<string, PendingDiskWrite>();
let diskFlushScheduled = false;
let diskWritesAsync = false;
const pendingSecureWrites = new Map<string, PendingSecureWrite>();
let secureFlushScheduled = false;
let secureDefaultAccessControl: AccessControl = AccessControl.WhenUnlocked;
const SECURE_WEB_PREFIX = "__secure_";
const BIOMETRIC_WEB_PREFIX = "__bio_";
let hasWarnedAboutWebBiometricFallback = false;
let hasWindowStorageEventSubscription = false;
let metricsObserver: StorageMetricsObserver | undefined;
let eventObserver: StorageEventListener | undefined;
const metricsCounters = new Map<
  string,
  { count: number; totalDurationMs: number; maxDurationMs: number }
>();
const storageEvents = new StorageEventRegistry();

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
  metricsObserver?.({ operation, scope, durationMs, keysCount });
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

function createDefaultDiskBackend(): WebDiskStorageBackend {
  return createLocalStorageWebBackend({
    name: "localStorage:disk",
    includeKey: (key) =>
      !key.startsWith(SECURE_WEB_PREFIX) &&
      !key.startsWith(BIOMETRIC_WEB_PREFIX),
  });
}

function createDefaultSecureBackend(): WebSecureStorageBackend {
  return createLocalStorageWebBackend({
    name: "localStorage:secure",
    includeKey: (key) =>
      key.startsWith(SECURE_WEB_PREFIX) || key.startsWith(BIOMETRIC_WEB_PREFIX),
  });
}

let webDiskStorageBackend: WebDiskStorageBackend | undefined =
  createDefaultDiskBackend();
let webSecureStorageBackend: WebSecureStorageBackend | undefined =
  createDefaultSecureBackend();
const externalSyncUnsubscribers = new Map<NonMemoryScope, () => void>();

function getBackendName(
  scope: NonMemoryScope,
  backend: WebStorageBackend | undefined,
): string {
  const scopeName = scope === StorageScope.Disk ? "disk" : "secure";
  return backend?.name ?? `web:${scopeName}`;
}

function getWebSecureEncryptionStatus(
  backend: WebSecureStorageBackend | undefined,
): "unavailable" | "unknown" {
  return backend?.name === "localStorage:secure" ? "unavailable" : "unknown";
}

function createWebStorageError(
  scope: NonMemoryScope,
  operation: string,
  error: unknown,
  backend: WebStorageBackend | undefined,
): Error {
  const backendName = getBackendName(scope, backend);
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  return new Error(
    `NitroStorage(web): ${operation} failed for ${backendName}: ${message}`,
  );
}

function withWebBackendOperation<T>(
  scope: NonMemoryScope,
  operation: string,
  fn: (backend: WebStorageBackend) => T,
): T {
  const backend =
    scope === StorageScope.Disk
      ? webDiskStorageBackend
      : webSecureStorageBackend;
  if (!backend) {
    throw new Error(
      `NitroStorage(web): ${operation} failed because no ${scope === StorageScope.Disk ? "disk" : "secure"} backend is configured.`,
    );
  }

  try {
    ensureExternalSyncSubscriptions();
    return fn(backend);
  } catch (error) {
    throw createWebStorageError(scope, operation, error, backend);
  }
}

function getWebBackend(scope: NonMemoryScope): WebStorageBackend | undefined {
  return scope === StorageScope.Disk
    ? webDiskStorageBackend
    : webSecureStorageBackend;
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

function getWebScopeKeyIndex(scope: NonMemoryScope): Set<string> {
  return webScopeKeyIndex.get(scope)!;
}

function hydrateWebScopeKeyIndex(scope: NonMemoryScope): void {
  if (hydratedWebScopeKeyIndex.has(scope)) {
    return;
  }

  const backend = getWebBackend(scope);
  const keyIndex = getWebScopeKeyIndex(scope);
  keyIndex.clear();
  const keys = backend?.getAllKeys() ?? [];
  for (const key of keys) {
    if (scope === StorageScope.Disk) {
      keyIndex.add(key);
      continue;
    }

    if (key.startsWith(SECURE_WEB_PREFIX)) {
      keyIndex.add(fromSecureStorageKey(key));
      continue;
    }
    if (key.startsWith(BIOMETRIC_WEB_PREFIX)) {
      keyIndex.add(fromBiometricStorageKey(key));
    }
  }
  hydratedWebScopeKeyIndex.add(scope);
}

function ensureWebScopeKeyIndex(scope: NonMemoryScope): Set<string> {
  hydrateWebScopeKeyIndex(scope);
  return getWebScopeKeyIndex(scope);
}

function applyExternalChangeEvent(
  scope: NonMemoryScope,
  key: string | null,
  newValue: string | null,
): void {
  if (key === null) {
    clearScopeRawCache(scope);
    ensureWebScopeKeyIndex(scope).clear();
    notifyAllListeners(getScopedListeners(scope));
    return;
  }

  if (scope === StorageScope.Secure && key.startsWith(SECURE_WEB_PREFIX)) {
    const plainKey = fromSecureStorageKey(key);
    const oldValue = readCachedRawValue(StorageScope.Secure, plainKey);
    if (newValue === null) {
      ensureWebScopeKeyIndex(StorageScope.Secure).delete(plainKey);
      cacheRawValue(StorageScope.Secure, plainKey, undefined);
    } else {
      ensureWebScopeKeyIndex(StorageScope.Secure).add(plainKey);
      cacheRawValue(StorageScope.Secure, plainKey, newValue);
    }
    notifyKeyListeners(getScopedListeners(StorageScope.Secure), plainKey);
    emitKeyChange(
      StorageScope.Secure,
      plainKey,
      oldValue,
      newValue ?? undefined,
      "external",
      "external",
    );
    return;
  }

  if (scope === StorageScope.Secure && key.startsWith(BIOMETRIC_WEB_PREFIX)) {
    const plainKey = fromBiometricStorageKey(key);
    const oldValue = readCachedRawValue(StorageScope.Secure, plainKey);
    if (newValue === null) {
      if (
        withWebBackendOperation(
          StorageScope.Secure,
          "external-sync:getItem",
          (backend) => backend.getItem(toSecureStorageKey(plainKey)),
        ) === null
      ) {
        ensureWebScopeKeyIndex(StorageScope.Secure).delete(plainKey);
      }
      cacheRawValue(StorageScope.Secure, plainKey, undefined);
    } else {
      ensureWebScopeKeyIndex(StorageScope.Secure).add(plainKey);
      cacheRawValue(StorageScope.Secure, plainKey, newValue);
    }
    notifyKeyListeners(getScopedListeners(StorageScope.Secure), plainKey);
    emitKeyChange(
      StorageScope.Secure,
      plainKey,
      oldValue,
      newValue ?? undefined,
      "external",
      "external",
    );
    return;
  }

  const oldValue = readCachedRawValue(scope, key);
  if (newValue === null) {
    ensureWebScopeKeyIndex(scope).delete(key);
    cacheRawValue(scope, key, undefined);
  } else {
    ensureWebScopeKeyIndex(scope).add(key);
    cacheRawValue(scope, key, newValue);
  }
  notifyKeyListeners(getScopedListeners(scope), key);
  emitKeyChange(
    scope,
    key,
    oldValue,
    newValue ?? undefined,
    "external",
    "external",
  );
}

function handleWebStorageEvent(event: StorageEvent): void {
  const key = event.key;
  if (key === null) {
    applyExternalChangeEvent(StorageScope.Disk, null, null);
    applyExternalChangeEvent(StorageScope.Secure, null, null);
    return;
  }

  if (
    key.startsWith(SECURE_WEB_PREFIX) ||
    key.startsWith(BIOMETRIC_WEB_PREFIX)
  ) {
    applyExternalChangeEvent(StorageScope.Secure, key, event.newValue);
    return;
  }

  applyExternalChangeEvent(StorageScope.Disk, key, event.newValue);
}

function subscribeToBackendChanges(scope: NonMemoryScope): void {
  if (externalSyncUnsubscribers.has(scope)) {
    return;
  }

  const backend = getWebBackend(scope);
  if (!backend?.subscribe) {
    return;
  }

  const unsubscribe = backend.subscribe((event: WebStorageChangeEvent) => {
    applyExternalChangeEvent(scope, event.key, event.newValue);
  });
  externalSyncUnsubscribers.set(scope, unsubscribe);
}

function resetBackendChangeSubscription(scope: NonMemoryScope): void {
  externalSyncUnsubscribers.get(scope)?.();
  externalSyncUnsubscribers.delete(scope);
}

function ensureExternalSyncSubscriptions(): void {
  if (
    !hasWindowStorageEventSubscription &&
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    window.addEventListener("storage", handleWebStorageEvent);
    hasWindowStorageEventSubscription = true;
  }

  subscribeToBackendChanges(StorageScope.Disk);
  subscribeToBackendChanges(StorageScope.Secure);
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

function getEventRawValue(
  scope: StorageScope,
  key: string,
): string | undefined {
  if (scope === StorageScope.Memory) {
    const value = memoryStore.get(key);
    return typeof value === "string" ? value : undefined;
  }

  return getRawValue(key, scope);
}

function createKeyChange(
  scope: StorageScope,
  key: string,
  oldValue: string | undefined,
  newValue: string | undefined,
  operation: StorageChangeOperation,
  source: StorageChangeSource,
): StorageKeyChangeEvent {
  return {
    type: "key",
    scope,
    key,
    oldValue,
    newValue,
    operation,
    source,
  };
}

function hasStorageChangeObservers(scope: StorageScope): boolean {
  return storageEvents.hasListeners(scope) || eventObserver !== undefined;
}

function emitKeyChange(
  scope: StorageScope,
  key: string,
  oldValue: string | undefined,
  newValue: string | undefined,
  operation: StorageChangeOperation,
  source: StorageChangeSource,
): void {
  const event = createKeyChange(
    scope,
    key,
    oldValue,
    newValue,
    operation,
    source,
  );
  storageEvents.emitKey(event);
  eventObserver?.(event);
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

  const event: StorageBatchChangeEvent = {
    type: "batch",
    scope,
    operation,
    source,
    changes,
  };
  storageEvents.emitBatch(event);
  eventObserver?.(event);
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

  if (keysToSet.length > 0) {
    WebStorage.setBatch(keysToSet, valuesToSet, StorageScope.Disk);
  }
  if (keysToRemove.length > 0) {
    WebStorage.removeBatch(keysToRemove, StorageScope.Disk);
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

  groupedSetWrites.forEach((group, accessControl) => {
    WebStorage.setSecureAccessControl(accessControl);
    WebStorage.setBatch(group.keys, group.values, StorageScope.Secure);
  });
  if (keysToRemove.length > 0) {
    WebStorage.removeBatch(keysToRemove, StorageScope.Secure);
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

const WebStorage: Storage = {
  name: "Storage",
  equals: (other) => other === WebStorage,
  dispose: () => {},
  set: (key: string, value: string, scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return;
    }
    const storageKey =
      scope === StorageScope.Secure ? toSecureStorageKey(key) : key;
    withWebBackendOperation(scope, "set", (backend) => {
      backend.setItem(storageKey, value);
    });
    ensureWebScopeKeyIndex(scope).add(key);
    notifyKeyListeners(getScopedListeners(scope), key);
  },
  get: (key: string, scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return undefined;
    }
    const storageKey =
      scope === StorageScope.Secure ? toSecureStorageKey(key) : key;
    const value = withWebBackendOperation(scope, "get", (backend) =>
      backend.getItem(storageKey),
    );
    return value ?? undefined;
  },
  remove: (key: string, scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return;
    }
    if (scope === StorageScope.Secure) {
      withWebBackendOperation(scope, "remove", (backend) => {
        if (backend.removeMany) {
          backend.removeMany([
            toSecureStorageKey(key),
            toBiometricStorageKey(key),
          ]);
          return;
        }
        backend.removeItem(toSecureStorageKey(key));
        backend.removeItem(toBiometricStorageKey(key));
      });
    } else {
      withWebBackendOperation(scope, "remove", (backend) => {
        backend.removeItem(key);
      });
    }
    ensureWebScopeKeyIndex(scope).delete(key);
    notifyKeyListeners(getScopedListeners(scope), key);
  },
  clear: (scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return;
    }
    withWebBackendOperation(scope, "clear", (backend) => {
      backend.clear();
    });
    ensureWebScopeKeyIndex(scope).clear();
    notifyAllListeners(getScopedListeners(scope));
  },
  setBatch: (keys: string[], values: string[], scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return;
    }

    const entries: (readonly [string, string])[] = [];
    keys.forEach((key, index) => {
      const value = values[index];
      if (value === undefined) {
        return;
      }
      entries.push([
        scope === StorageScope.Secure ? toSecureStorageKey(key) : key,
        value,
      ]);
    });
    withWebBackendOperation(scope, "setBatch", (backend) => {
      if (backend.setMany) {
        backend.setMany(entries);
        return;
      }
      entries.forEach(([storageKey, value]) => {
        backend.setItem(storageKey, value);
      });
    });
    const keyIndex = ensureWebScopeKeyIndex(scope);
    keys.forEach((key) => keyIndex.add(key));
    const listeners = getScopedListeners(scope);
    keys.forEach((key) => notifyKeyListeners(listeners, key));
  },
  getBatch: (keys: string[], scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return keys.map(() => undefined);
    }
    const storageKeys = keys.map((key) =>
      scope === StorageScope.Secure ? toSecureStorageKey(key) : key,
    );
    const values = withWebBackendOperation(scope, "getBatch", (backend) => {
      if (backend.getMany) {
        return backend.getMany(storageKeys);
      }
      return storageKeys.map((storageKey) => backend.getItem(storageKey));
    });
    return values.map((value) => value ?? undefined);
  },
  removeBatch: (keys: string[], scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return;
    }

    if (scope === StorageScope.Secure) {
      const storageKeys = keys.flatMap((key) => [
        toSecureStorageKey(key),
        toBiometricStorageKey(key),
      ]);
      withWebBackendOperation(scope, "removeBatch", (backend) => {
        if (backend.removeMany) {
          backend.removeMany(storageKeys);
          return;
        }
        storageKeys.forEach((storageKey) => {
          backend.removeItem(storageKey);
        });
      });
    } else {
      withWebBackendOperation(scope, "removeBatch", (backend) => {
        if (backend.removeMany) {
          backend.removeMany(keys);
          return;
        }
        keys.forEach((key) => {
          backend.removeItem(key);
        });
      });
    }

    const keyIndex = ensureWebScopeKeyIndex(scope);
    keys.forEach((key) => keyIndex.delete(key));
    const listeners = getScopedListeners(scope);
    keys.forEach((key) => notifyKeyListeners(listeners, key));
  },
  removeByPrefix: (prefix: string, scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return;
    }

    const keyIndex = ensureWebScopeKeyIndex(scope);
    const keys = Array.from(keyIndex).filter((key) => key.startsWith(prefix));
    if (keys.length === 0) {
      return;
    }

    WebStorage.removeBatch(keys, scope);
  },
  addOnChange: (
    _scope: number,
    _callback: (key: string, value: string | undefined) => void,
  ) => {
    return () => {};
  },
  has: (key: string, scope: number) => {
    if (scope === StorageScope.Disk || scope === StorageScope.Secure) {
      return ensureWebScopeKeyIndex(scope).has(key);
    }
    return false;
  },
  getAllKeys: (scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return [];
    }
    return Array.from(ensureWebScopeKeyIndex(scope));
  },
  getKeysByPrefix: (prefix: string, scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return [];
    }
    return Array.from(ensureWebScopeKeyIndex(scope)).filter((key) =>
      key.startsWith(prefix),
    );
  },
  size: (scope: number) => {
    if (scope === StorageScope.Disk || scope === StorageScope.Secure) {
      return ensureWebScopeKeyIndex(scope).size;
    }
    return 0;
  },
  setSecureAccessControl: () => {},
  setSecureWritesAsync: (_enabled: boolean) => {},
  setKeychainAccessGroup: () => {},
  setSecureBiometric: (key: string, value: string) => {
    WebStorage.setSecureBiometricWithLevel(
      key,
      value,
      BiometricLevel.BiometryOnly,
    );
  },
  setSecureBiometricWithLevel: (key: string, value: string, _level: number) => {
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
    withWebBackendOperation(
      StorageScope.Secure,
      "setSecureBiometric",
      (backend) => backend.setItem(toBiometricStorageKey(key), value),
    );
    ensureWebScopeKeyIndex(StorageScope.Secure).add(key);
    notifyKeyListeners(getScopedListeners(StorageScope.Secure), key);
  },
  getSecureBiometric: (key: string) => {
    const value = withWebBackendOperation(
      StorageScope.Secure,
      "getSecureBiometric",
      (backend) => backend.getItem(toBiometricStorageKey(key)),
    );
    return value ?? undefined;
  },
  deleteSecureBiometric: (key: string) => {
    withWebBackendOperation(
      StorageScope.Secure,
      "deleteSecureBiometric",
      (backend) => backend.removeItem(toBiometricStorageKey(key)),
    );
    if (
      withWebBackendOperation(
        StorageScope.Secure,
        "deleteSecureBiometric:getItem",
        (backend) => backend.getItem(toSecureStorageKey(key)),
      ) === null
    ) {
      ensureWebScopeKeyIndex(StorageScope.Secure).delete(key);
    }
    notifyKeyListeners(getScopedListeners(StorageScope.Secure), key);
  },
  hasSecureBiometric: (key: string) => {
    return (
      withWebBackendOperation(
        StorageScope.Secure,
        "hasSecureBiometric",
        (backend) => backend.getItem(toBiometricStorageKey(key)),
      ) !== null
    );
  },
  clearSecureBiometric: () => {
    const storageKeys = withWebBackendOperation(
      StorageScope.Secure,
      "clearSecureBiometric:getAllKeys",
      (backend) => backend.getAllKeys(),
    );
    const keysToNotify = storageKeys
      .filter((key) => key.startsWith(BIOMETRIC_WEB_PREFIX))
      .map((key) => fromBiometricStorageKey(key));
    if (keysToNotify.length === 0) {
      return;
    }
    withWebBackendOperation(
      StorageScope.Secure,
      "clearSecureBiometric",
      (backend) => {
        const biometricKeys = keysToNotify.map((key) =>
          toBiometricStorageKey(key),
        );
        if (backend.removeMany) {
          backend.removeMany(biometricKeys);
          return;
        }
        biometricKeys.forEach((storageKey) => {
          backend.removeItem(storageKey);
        });
      },
    );
    const keyIndex = ensureWebScopeKeyIndex(StorageScope.Secure);
    keysToNotify.forEach((key) => {
      if (
        withWebBackendOperation(
          StorageScope.Secure,
          "clearSecureBiometric:getItem",
          (backend) => backend.getItem(toSecureStorageKey(key)),
        ) === null
      ) {
        keyIndex.delete(key);
      }
    });
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

  if (scope === StorageScope.Disk && hasPendingDiskWrite(key)) {
    return readPendingDiskWrite(key);
  }

  if (scope === StorageScope.Secure && hasPendingSecureWrite(key)) {
    return readPendingSecureWrite(key);
  }

  return WebStorage.get(key, scope);
}

function setRawValue(key: string, value: string, scope: StorageScope): void {
  assertValidScope(scope);
  const oldValue =
    scope === StorageScope.Memory ? getEventRawValue(scope, key) : undefined;
  if (scope === StorageScope.Memory) {
    memoryStore.set(key, value);
    notifyKeyListeners(memoryListeners, key);
    emitKeyChange(scope, key, oldValue, value, "set", "memory");
    return;
  }

  if (scope === StorageScope.Disk) {
    cacheRawValue(scope, key, value);
    if (diskWritesAsync) {
      scheduleDiskWrite(key, value);
      emitKeyChange(scope, key, oldValue, value, "set", "web");
      return;
    }

    flushDiskWrites();
    clearPendingDiskWrite(key);
  }

  if (scope === StorageScope.Secure) {
    flushSecureWrites();
    clearPendingSecureWrite(key);
  }

  WebStorage.set(key, value, scope);
  cacheRawValue(scope, key, value);
  emitKeyChange(scope, key, oldValue, value, "set", "web");
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
    if (diskWritesAsync) {
      scheduleDiskWrite(key, undefined);
      emitKeyChange(scope, key, oldValue, undefined, "remove", "web");
      return;
    }

    flushDiskWrites();
    clearPendingDiskWrite(key);
  }

  if (scope === StorageScope.Secure) {
    flushSecureWrites();
    clearPendingSecureWrite(key);
  }

  WebStorage.remove(key, scope);
  cacheRawValue(scope, key, undefined);
  emitKeyChange(scope, key, oldValue, undefined, "remove", "web");
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
  subscribe: (
    scope: StorageScope,
    listener: StorageEventListener,
  ): (() => void) => {
    assertValidScope(scope);
    if (scope !== StorageScope.Memory) {
      ensureExternalSyncSubscriptions();
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
      ensureExternalSyncSubscriptions();
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
      ensureExternalSyncSubscriptions();
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
  setEventObserver: (observer?: StorageEventListener) => {
    eventObserver = observer;
    if (observer) {
      ensureExternalSyncSubscriptions();
    }
  },
  clear: (scope: StorageScope) => {
    measureOperation("storage:clear", scope, () => {
      const previousValues = hasStorageChangeObservers(scope)
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
        pendingDiskWrites.clear();
      }

      if (scope === StorageScope.Secure) {
        flushSecureWrites();
        pendingSecureWrites.clear();
      }

      clearScopeRawCache(scope);
      WebStorage.clear(scope);
      emitBatchChange(
        scope,
        "clear",
        "web",
        Object.keys(previousValues).map((key) =>
          createKeyChange(
            scope,
            key,
            previousValues[key],
            undefined,
            "clear",
            "web",
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
        affectedKeys.forEach((key) => notifyKeyListeners(memoryListeners, key));
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
      const previousValues = hasStorageChangeObservers(scope)
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
      WebStorage.removeByPrefix(keyPrefix, scope);
      emitBatchChange(
        scope,
        "clearNamespace",
        "web",
        Object.keys(previousValues).map((key) =>
          createKeyChange(
            scope,
            key,
            previousValues[key],
            undefined,
            "clearNamespace",
            "web",
          ),
        ),
      );
    });
  },
  clearBiometric: () => {
    measureOperation("storage:clearBiometric", StorageScope.Secure, () => {
      WebStorage.clearSecureBiometric();
    });
  },
  has: (key: string, scope: StorageScope): boolean => {
    return measureOperation("storage:has", scope, () => {
      assertValidScope(scope);
      if (scope === StorageScope.Memory) return memoryStore.has(key);
      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }
      return WebStorage.has(key, scope);
    });
  },
  getAllKeys: (scope: StorageScope): string[] => {
    return measureOperation("storage:getAllKeys", scope, () => {
      assertValidScope(scope);
      if (scope === StorageScope.Memory) return Array.from(memoryStore.keys());
      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }
      return WebStorage.getAllKeys(scope);
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
      return WebStorage.getKeysByPrefix(prefix, scope);
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
      const values = WebStorage.getBatch(keys, scope);
      keys.forEach((key, index) => {
        const value = values[index];
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
      const keys = WebStorage.getAllKeys(scope);
      if (keys.length === 0) return {};
      const values = WebStorage.getBatch(keys, scope);
      keys.forEach((key, index) => {
        const val = values[index];
        if (val !== undefined && val !== null) {
          result[key] = val;
        }
      });
      return result;
    });
  },
  export: (scope: StorageScope): Record<string, string> => {
    return measureOperation("storage:export", scope, () =>
      storage.getAll(scope),
    );
  },
  size: (scope: StorageScope): number => {
    return measureOperation("storage:size", scope, () => {
      assertValidScope(scope);
      if (scope === StorageScope.Memory) return memoryStore.size;
      if (scope === StorageScope.Disk) {
        flushDiskWrites();
      }
      if (scope === StorageScope.Secure) {
        flushSecureWrites();
      }
      return WebStorage.size(scope);
    });
  },
  setAccessControl: (level: AccessControl) => {
    secureDefaultAccessControl = level;
    recordMetric("storage:setAccessControl", StorageScope.Secure, 0);
  },
  setSecureWritesAsync: (_enabled: boolean) => {
    recordMetric("storage:setSecureWritesAsync", StorageScope.Secure, 0);
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
  setKeychainAccessGroup: (_group: string) => {
    recordMetric("storage:setKeychainAccessGroup", StorageScope.Secure, 0);
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
    platform: "web",
    backend: {
      disk: getBackendName(StorageScope.Disk, webDiskStorageBackend),
      secure: getBackendName(StorageScope.Secure, webSecureStorageBackend),
    },
    writeBuffering: {
      disk: true,
      secure: true,
    },
    errorClassification: true,
  }),
  getSecurityCapabilities: (): SecurityCapabilities => {
    const secureBackend = getBackendName(
      StorageScope.Secure,
      webSecureStorageBackend,
    );
    return {
      platform: "web",
      secureStorage: {
        backend: secureBackend,
        encrypted: getWebSecureEncryptionStatus(webSecureStorageBackend),
        accessControl: "unavailable",
        keychainAccessGroup: "unavailable",
        hardwareBacked: "unavailable",
      },
      biometric: {
        storage: "unavailable",
        prompt: "unavailable",
        biometryOnly: "unavailable",
        biometryOrPasscode: "unavailable",
      },
      metadata: {
        perKey: true,
        listsWithoutValues: true,
        persistsTimestamps: false,
      },
    };
  },
  getSecureMetadata: (key: string): SecureStorageMetadata => {
    return measureOperation(
      "storage:getSecureMetadata",
      StorageScope.Secure,
      () => {
        flushSecureWrites();
        const biometricProtected = WebStorage.hasSecureBiometric(key);
        const exists =
          biometricProtected || WebStorage.has(key, StorageScope.Secure);
        let kind: SecureStorageMetadata["kind"] = "missing";
        if (exists) {
          kind = biometricProtected ? "biometric" : "secure";
        }

        return {
          key,
          exists,
          kind,
          backend: getBackendName(StorageScope.Secure, webSecureStorageBackend),
          encrypted: getWebSecureEncryptionStatus(webSecureStorageBackend),
          hardwareBacked: "unavailable",
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
        return WebStorage.getAllKeys(StorageScope.Secure).map((key) =>
          storage.getSecureMetadata(key),
        );
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
        const changes = keys.map((key, index) =>
          createKeyChange(
            scope,
            key,
            getEventRawValue(scope, key),
            values[index],
            "import",
            scope === StorageScope.Memory ? "memory" : "web",
          ),
        );

        if (scope === StorageScope.Memory) {
          keys.forEach((key, index) => {
            memoryStore.set(key, values[index]);
          });
          keys.forEach((key) => notifyKeyListeners(memoryListeners, key));
          emitBatchChange(scope, "import", "memory", changes);
          return;
        }

        if (scope === StorageScope.Secure) {
          flushSecureWrites();
          WebStorage.setSecureAccessControl(secureDefaultAccessControl);
        }
        if (scope === StorageScope.Disk) {
          flushDiskWrites();
        }

        WebStorage.setBatch(keys, values, scope);
        keys.forEach((key, index) => cacheRawValue(scope, key, values[index]));
        emitBatchChange(scope, "import", "web", changes);
      },
      keys.length,
    );
  },
};

export function setWebSecureStorageBackend(
  backend?: WebSecureStorageBackend,
): void {
  pendingSecureWrites.clear();
  webSecureStorageBackend = backend ?? createDefaultSecureBackend();
  resetBackendChangeSubscription(StorageScope.Secure);
  hydratedWebScopeKeyIndex.delete(StorageScope.Secure);
  clearScopeRawCache(StorageScope.Secure);
  ensureExternalSyncSubscriptions();
}

export function getWebSecureStorageBackend():
  | WebSecureStorageBackend
  | undefined {
  return webSecureStorageBackend;
}

export function setWebDiskStorageBackend(
  backend?: WebDiskStorageBackend,
): void {
  pendingDiskWrites.clear();
  webDiskStorageBackend = backend ?? createDefaultDiskBackend();
  resetBackendChangeSubscription(StorageScope.Disk);
  hydratedWebScopeKeyIndex.delete(StorageScope.Disk);
  clearScopeRawCache(StorageScope.Disk);
  ensureExternalSyncSubscriptions();
}

export function getWebDiskStorageBackend(): WebDiskStorageBackend | undefined {
  return webDiskStorageBackend;
}

export async function flushWebStorageBackends(): Promise<void> {
  flushDiskWrites();
  flushSecureWrites();

  const flushes: Promise<void>[] = [];
  const diskFlush = webDiskStorageBackend?.flush;
  const secureFlush = webSecureStorageBackend?.flush;

  if (diskFlush) {
    flushes.push(diskFlush());
  }
  if (secureFlush) {
    flushes.push(secureFlush());
  }

  await Promise.all(flushes);
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
  subscribeSelector: <TSelected>(
    selector: (value: T) => TSelected,
    listener: StorageSelectorListener<TSelected>,
    options?: StorageSelectorSubscribeOptions<TSelected>,
  ) => () => void;
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

    ensureExternalSyncSubscriptions();
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
      return WebStorage.getSecureBiometric(storageKey);
    }

    const raw = WebStorage.get(storageKey, config.scope);
    cacheRawValue(nonMemoryScope!, storageKey, raw);
    return raw;
  };

  const writeStoredRaw = (rawValue: string): void => {
    const oldValue =
      config.scope === StorageScope.Memory
        ? getEventRawValue(config.scope, storageKey)
        : undefined;
    if (isBiometric) {
      WebStorage.setSecureBiometricWithLevel(
        storageKey,
        rawValue,
        resolvedBiometricLevel,
      );
      emitKeyChange(config.scope, storageKey, oldValue, rawValue, "set", "web");
      return;
    }

    cacheRawValue(nonMemoryScope!, storageKey, rawValue);

    if (nonMemoryScope === StorageScope.Disk) {
      if (coalesceDiskWrites || diskWritesAsync) {
        scheduleDiskWrite(storageKey, rawValue);
        emitKeyChange(
          config.scope,
          storageKey,
          oldValue,
          rawValue,
          "set",
          "web",
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
      emitKeyChange(config.scope, storageKey, oldValue, rawValue, "set", "web");
      return;
    }

    if (nonMemoryScope === StorageScope.Secure) {
      clearPendingSecureWrite(storageKey);
    }

    WebStorage.set(storageKey, rawValue, config.scope);
    emitKeyChange(config.scope, storageKey, oldValue, rawValue, "set", "web");
  };

  const removeStoredRaw = (): void => {
    const oldValue = getEventRawValue(config.scope, storageKey);
    if (isBiometric) {
      WebStorage.deleteSecureBiometric(storageKey);
      emitKeyChange(
        config.scope,
        storageKey,
        oldValue,
        undefined,
        "remove",
        "web",
      );
      return;
    }

    cacheRawValue(nonMemoryScope!, storageKey, undefined);

    if (nonMemoryScope === StorageScope.Disk) {
      if (coalesceDiskWrites || diskWritesAsync) {
        scheduleDiskWrite(storageKey, undefined);
        emitKeyChange(
          config.scope,
          storageKey,
          oldValue,
          undefined,
          "remove",
          "web",
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
        "remove",
        "web",
      );
      return;
    }

    if (nonMemoryScope === StorageScope.Secure) {
      clearPendingSecureWrite(storageKey);
    }

    WebStorage.remove(storageKey, config.scope);
    emitKeyChange(
      config.scope,
      storageKey,
      oldValue,
      undefined,
      "remove",
      "web",
    );
  };

  const writeValueWithoutValidation = (value: T): void => {
    if (isMemory) {
      const oldValue = getEventRawValue(config.scope, storageKey);
      if (memoryExpiration) {
        memoryExpiration.set(storageKey, Date.now() + (expirationTtlMs ?? 0));
      }
      memoryStore.set(storageKey, value);
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

  const hasItem = (): boolean =>
    measureOperation("item:has", config.scope, () => {
      if (isMemory) return memoryStore.has(storageKey);
      if (isBiometric) return WebStorage.hasSecureBiometric(storageKey);
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
      return WebStorage.has(storageKey, config.scope);
    });

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
    delete: deleteItem,
    has: hasItem,
    subscribe,
    subscribeSelector,
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
        const fetchedValues = WebStorage.getBatch(keysToFetch, scope);
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
          items.forEach(({ item, value }) => item.set(value));
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
          asInternal(item as StorageItem<unknown>)._invalidateParsedCacheOnly();
        });
        items.forEach(({ item }) =>
          notifyKeyListeners(memoryListeners, item.key),
        );
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
          items.forEach(({ item, value }) => item.set(value));
          return;
        }

        flushSecureWrites();
        const keys = secureEntries.map(({ item }) => item.key);
        const oldValues = hasStorageChangeObservers(scope)
          ? WebStorage.getBatch(keys, scope)
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
          WebStorage.setSecureAccessControl(accessControl);
          WebStorage.setBatch(group.keys, group.values, scope);
          group.keys.forEach((key, index) =>
            cacheRawValue(scope, key, group.values[index]),
          );
        });
        emitBatchChange(
          scope,
          "setBatch",
          "web",
          secureEntries.map(({ item, value }, index) =>
            createKeyChange(
              scope,
              item.key,
              oldValues[index],
              item.serialize(value),
              "setBatch",
              "web",
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
        items.forEach(({ item, value }) => item.set(value));
        return;
      }

      const keys = items.map((entry) => entry.item.key);
      const values = items.map((entry) => entry.item.serialize(entry.value));
      const oldValues = hasStorageChangeObservers(scope)
        ? WebStorage.getBatch(keys, scope)
        : [];
      WebStorage.setBatch(keys, values, scope);
      keys.forEach((key, index) => cacheRawValue(scope, key, values[index]));
      emitBatchChange(
        scope,
        "setBatch",
        "web",
        keys.map((key, index) =>
          createKeyChange(
            scope,
            key,
            oldValues[index],
            values[index],
            "setBatch",
            "web",
          ),
        ),
      );
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
        items.forEach((item) => item.delete());
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
      const oldValues = hasStorageChangeObservers(scope)
        ? WebStorage.getBatch(keys, scope)
        : [];
      WebStorage.removeBatch(keys, scope);
      keys.forEach((key) => cacheRawValue(scope, key, undefined));
      emitBatchChange(
        scope,
        "removeBatch",
        "web",
        keys.map((key, index) =>
          createKeyChange(
            scope,
            key,
            oldValues[index],
            undefined,
            "removeBatch",
            "web",
          ),
        ),
      );
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
          WebStorage.setBatch(keysToSet, valuesToSet, scope);
          keysToSet.forEach((key, index) =>
            cacheRawValue(scope, key, valuesToSet[index]),
          );
        }
        if (keysToRemove.length > 0) {
          WebStorage.removeBatch(keysToRemove, scope);
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

export function isKeychainLockedError(err: unknown): boolean {
  return isLockedStorageErrorCode(getStorageErrorCode(err));
}
