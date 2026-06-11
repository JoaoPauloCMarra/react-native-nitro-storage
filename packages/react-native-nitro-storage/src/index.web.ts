import {
  assertAccessControlLevel,
  assertBiometricLevel,
  notifyAllListeners,
  notifyKeyListeners,
  type NonMemoryScope,
} from "./shared";
import { StorageScope, AccessControl, BiometricLevel } from "./Storage.types";
import {
  createLocalStorageWebBackend,
  type WebDiskStorageBackend,
  type WebSecureStorageBackend,
  type WebStorageBackend,
  type WebStorageChangeEvent,
} from "./web-storage-backend";
import type {
  SecurityCapabilities,
  StorageCapabilities,
} from "./storage-runtime";
import {
  createStorageCore,
  type StorageCoreAdapter,
  type StorageCoreInternals,
} from "./storage-core";
export type {
  ExpirationConfig,
  Migration,
  MigrationContext,
  SecureAuthStorageConfig,
  StorageEventObserverOptions,
  StorageExportOptions,
  StorageMetricSummary,
  StorageMetricsEvent,
  StorageMetricsObserver,
  StorageSelectorListener,
  StorageSelectorSubscribeOptions,
  StorageVersion,
  Validator,
  VersionedValue,
} from "./shared";
export { isKeychainLockedError } from "./shared";

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
export type { StorageSetter } from "./storage-hooks";
export type {
  WebDiskStorageBackend,
  WebSecureStorageBackend,
  WebStorageBackend,
  WebStorageChangeEvent,
  WebStorageScope,
} from "./web-storage-backend";
export type {
  StorageBatchSetItem,
  StorageItem,
  StorageItemConfig,
  TransactionContext,
} from "./storage-core";

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

const webScopeKeyIndex = new Map<NonMemoryScope, Set<string>>([
  [StorageScope.Disk, new Set()],
  [StorageScope.Secure, new Set()],
]);
const hydratedWebScopeKeyIndex = new Set<NonMemoryScope>();
const SECURE_WEB_PREFIX = "__secure_";
const BIOMETRIC_WEB_PREFIX = "__bio_";
let hasWarnedAboutWebBiometricFallback = false;
let hasWindowStorageEventSubscription = false;

let internals!: StorageCoreInternals;

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
    internals.clearScopeRawCache(scope);
    ensureWebScopeKeyIndex(scope).clear();
    notifyAllListeners(internals.getScopedListeners(scope));
    return;
  }

  if (scope === StorageScope.Secure && key.startsWith(SECURE_WEB_PREFIX)) {
    const plainKey = fromSecureStorageKey(key);
    const oldValue = internals.readCachedRawValue(
      StorageScope.Secure,
      plainKey,
    );
    if (newValue === null) {
      ensureWebScopeKeyIndex(StorageScope.Secure).delete(plainKey);
      internals.cacheRawValue(StorageScope.Secure, plainKey, undefined);
    } else {
      ensureWebScopeKeyIndex(StorageScope.Secure).add(plainKey);
      internals.cacheRawValue(StorageScope.Secure, plainKey, newValue);
    }
    notifyKeyListeners(
      internals.getScopedListeners(StorageScope.Secure),
      plainKey,
    );
    internals.emitKeyChange(
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
    const oldValue = internals.readCachedRawValue(
      StorageScope.Secure,
      plainKey,
    );
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
      internals.cacheRawValue(StorageScope.Secure, plainKey, undefined);
    } else {
      ensureWebScopeKeyIndex(StorageScope.Secure).add(plainKey);
      internals.cacheRawValue(StorageScope.Secure, plainKey, newValue);
    }
    notifyKeyListeners(
      internals.getScopedListeners(StorageScope.Secure),
      plainKey,
    );
    internals.emitKeyChange(
      StorageScope.Secure,
      plainKey,
      oldValue,
      newValue ?? undefined,
      "external",
      "external",
    );
    return;
  }

  const oldValue = internals.readCachedRawValue(scope, key);
  if (newValue === null) {
    ensureWebScopeKeyIndex(scope).delete(key);
    internals.cacheRawValue(scope, key, undefined);
  } else {
    ensureWebScopeKeyIndex(scope).add(key);
    internals.cacheRawValue(scope, key, newValue);
  }
  notifyKeyListeners(internals.getScopedListeners(scope), key);
  internals.emitKeyChange(
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

function closeWebBackend(
  scope: NonMemoryScope,
  backend: WebStorageBackend | undefined,
): void {
  if (!backend?.close) {
    return;
  }

  try {
    backend.close();
  } catch (error) {
    throw createWebStorageError(scope, "close", error, backend);
  }
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
    notifyKeyListeners(internals.getScopedListeners(scope), key);
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
    notifyKeyListeners(internals.getScopedListeners(scope), key);
  },
  clear: (scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return;
    }
    withWebBackendOperation(scope, "clear", (backend) => {
      backend.clear();
    });
    ensureWebScopeKeyIndex(scope).clear();
    notifyAllListeners(internals.getScopedListeners(scope));
  },
  setBatch: (keys: string[], values: string[], scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return;
    }
    if (keys.length !== values.length) {
      throw new Error(
        "NitroStorage: Keys and values size mismatch in setBatch",
      );
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
    entries.forEach(([storageKey]) =>
      keyIndex.add(
        scope === StorageScope.Secure
          ? storageKey.slice(SECURE_WEB_PREFIX.length)
          : storageKey,
      ),
    );
    const listeners = internals.getScopedListeners(scope);
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
    const listeners = internals.getScopedListeners(scope);
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
  setSecureAccessControl: (level: number) => {
    assertAccessControlLevel(level);
  },
  setSecureWritesAsync: (_enabled: boolean) => {},
  setKeychainAccessGroup: () => {},
  setSecureBiometric: (key: string, value: string) => {
    WebStorage.setSecureBiometricWithLevel(
      key,
      value,
      BiometricLevel.BiometryOnly,
    );
  },
  setSecureBiometricWithLevel: (key: string, value: string, level: number) => {
    assertBiometricLevel(level);
    if (level === BiometricLevel.None) {
      withWebBackendOperation(StorageScope.Secure, "setSecure", (backend) => {
        backend.removeItem(toBiometricStorageKey(key));
        backend.setItem(toSecureStorageKey(key), value);
      });
      ensureWebScopeKeyIndex(StorageScope.Secure).add(key);
      notifyKeyListeners(
        internals.getScopedListeners(StorageScope.Secure),
        key,
      );
      return;
    }
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
    notifyKeyListeners(internals.getScopedListeners(StorageScope.Secure), key);
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
    notifyKeyListeners(internals.getScopedListeners(StorageScope.Secure), key);
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
    const listeners = internals.getScopedListeners(StorageScope.Secure);
    keysToNotify.forEach((key) => notifyKeyListeners(listeners, key));
  },
};

function buildWebAdapter(
  coreInternals: StorageCoreInternals,
): StorageCoreAdapter {
  internals = coreInternals;
  return {
    backend: WebStorage,
    changeSource: "web",
    applyAccessControlOnSecureRawWrite: false,
    flushDiskWritesOnImport: true,
    ensureScopeSubscription: () => {
      ensureExternalSyncSubscriptions();
    },
    maybeCleanupScopeSubscription: () => {},
    onWillEmitChanges: () => {},
    getSecureMetadataProfile: () => ({
      backend: getBackendName(StorageScope.Secure, webSecureStorageBackend),
      encrypted: getWebSecureEncryptionStatus(webSecureStorageBackend),
      hardwareBacked: "unavailable",
    }),
  };
}

const core = createStorageCore(buildWebAdapter);

export const storage = {
  ...core.storage,
  setAccessControl: (level: AccessControl) => {
    assertAccessControlLevel(level);
    internals.setSecureDefaultAccessControl(level);
    internals.recordMetric("storage:setAccessControl", StorageScope.Secure, 0);
  },
  setSecureWritesAsync: (_enabled: boolean) => {
    internals.recordMetric(
      "storage:setSecureWritesAsync",
      StorageScope.Secure,
      0,
    );
  },
  setKeychainAccessGroup: (_group: string) => {
    internals.recordMetric(
      "storage:setKeychainAccessGroup",
      StorageScope.Secure,
      0,
    );
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
};

export const createStorageItem = core.createStorageItem;
export const getBatch = core.getBatch;
export const setBatch = core.setBatch;
export const removeBatch = core.removeBatch;
export const registerMigration = core.registerMigration;
export const migrateToLatest = core.migrateToLatest;
export const runTransaction = core.runTransaction;
export const createSecureAuthStorage = core.createSecureAuthStorage;

export function setWebSecureStorageBackend(
  backend?: WebSecureStorageBackend,
): void {
  const previousBackend = webSecureStorageBackend;
  const nextBackend = backend ?? createDefaultSecureBackend();
  internals.clearAllPendingSecureWrites();
  resetBackendChangeSubscription(StorageScope.Secure);
  webSecureStorageBackend = nextBackend;
  hydratedWebScopeKeyIndex.delete(StorageScope.Secure);
  internals.clearScopeRawCache(StorageScope.Secure);
  ensureExternalSyncSubscriptions();
  if (previousBackend !== nextBackend) {
    closeWebBackend(StorageScope.Secure, previousBackend);
  }
}

export function getWebSecureStorageBackend():
  | WebSecureStorageBackend
  | undefined {
  return webSecureStorageBackend;
}

export function setWebDiskStorageBackend(
  backend?: WebDiskStorageBackend,
): void {
  const previousBackend = webDiskStorageBackend;
  const nextBackend = backend ?? createDefaultDiskBackend();
  internals.clearAllPendingDiskWrites();
  resetBackendChangeSubscription(StorageScope.Disk);
  webDiskStorageBackend = nextBackend;
  hydratedWebScopeKeyIndex.delete(StorageScope.Disk);
  internals.clearScopeRawCache(StorageScope.Disk);
  ensureExternalSyncSubscriptions();
  if (previousBackend !== nextBackend) {
    closeWebBackend(StorageScope.Disk, previousBackend);
  }
}

export function getWebDiskStorageBackend(): WebDiskStorageBackend | undefined {
  return webDiskStorageBackend;
}

export async function flushWebStorageBackends(): Promise<void> {
  internals.flushDiskWrites();
  internals.flushSecureWrites();

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

export { useStorage, useStorageSelector, useSetStorage } from "./storage-hooks";
export { createIndexedDBBackend } from "./indexeddb-backend";
