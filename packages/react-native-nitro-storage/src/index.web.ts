import { resolveWebWriteBuffering } from "./capabilities";
import { unescapeCollidingRawValue } from "./internal";
import {
  assertAccessControlLevel,
  createStorageCompositeError,
  assertBiometricLevel,
  notifyAllListeners,
  notifyKeyListeners,
  type NonMemoryScope,
} from "./shared";
import {
  createStorageCore,
  type StorageCoreAdapter,
  type StorageCoreInternals,
} from "./storage-core";
import type {
  SecurityCapabilities,
  StorageCapabilities,
} from "./storage-runtime";
import type { Storage } from "./Storage.nitro";
import type { AccessControl } from "./Storage.types";
import { StorageScope, BiometricLevel } from "./Storage.types";
import {
  createLocalStorageWebBackend,
  type WebDiskStorageBackend,
  type WebSecureStorageBackend,
  type WebStorageBackend,
  type WebStorageChangeEvent,
} from "./web-storage-backend";
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
  StorageCompositeError,
  StorageCompensationError,
  StorageVersion,
  Validator,
  VersionedValue,
} from "./shared";
export { isKeychainLockedError } from "./shared";

export { StorageScope, AccessControl, BiometricLevel } from "./Storage.types";
export type { Storage } from "./Storage.nitro";
export { migrateFromMMKV } from "./migration";
export {
  getStorageErrorCode,
  isStorageError,
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
export type { StorageActions, StorageSetter } from "./storage-hooks";
export type {
  WebDiskStorageBackend,
  WebSecureStorageBackend,
  WebStorageBackend,
  WebStorageChangeEvent,
  WebStorageScope,
} from "./web-storage-backend";
export {
  describeWebBackendCapabilities,
  isIndexedDBWebBackend,
  type WebBackendCapabilities,
} from "./web-backend-contract";
export type {
  SetItemConfig,
  SetStorageItem,
  StorageBatchSetItem,
  StorageClearOptions,
  StorageItem,
  StorageItemConfig,
  StorageKeyRef,
  TransactionContext,
} from "./storage-core";
export type { PlatformScope, PlatformStorage } from "./storage-platform";

const webScopeKeyIndex: Record<NonMemoryScope, Set<string>> = {
  [StorageScope.Disk]: new Set(),
  [StorageScope.Secure]: new Set(),
};
const hydratedWebScopeKeyIndex = new Set<NonMemoryScope>();
const SECURE_WEB_PREFIX = "__secure_";
const BIOMETRIC_WEB_PREFIX = "__bio_";
let hasWarnedAboutWebBiometricFallback = false;
let hasWindowStorageEventSubscription = false;

let internals: StorageCoreInternals;

function getInternals(): StorageCoreInternals {
  if (internals === undefined) {
    throw new Error("NitroStorage(web): storage core is not initialized.");
  }
  return internals;
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
const retiredWebBackends = new Map<WebStorageBackend, NonMemoryScope>();

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
  const wrapped = new Error(
    `NitroStorage(web): ${operation} failed for ${backendName}: ${message}`,
  );
  Object.defineProperty(wrapped, "cause", {
    configurable: true,
    enumerable: false,
    value: error,
    writable: false,
  });
  return wrapped;
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
  return webScopeKeyIndex[scope];
}

function replaceWebScopeKeyIndex(
  scope: NonMemoryScope,
  keys: readonly string[],
): void {
  const keyIndex = getWebScopeKeyIndex(scope);
  keyIndex.clear();
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
}

function invalidateWebScopeKeyIndex(scope: NonMemoryScope): void {
  getWebScopeKeyIndex(scope).clear();
  hydratedWebScopeKeyIndex.delete(scope);
  getInternals().clearScopeRawCache(scope);
}

function hydrateWebScopeKeyIndex(scope: NonMemoryScope): void {
  if (hydratedWebScopeKeyIndex.has(scope)) {
    return;
  }

  try {
    const backend = getWebBackend(scope);
    const keys = backend?.getAllKeys() ?? [];
    replaceWebScopeKeyIndex(scope, keys);
    hydratedWebScopeKeyIndex.add(scope);
  } catch (error) {
    invalidateWebScopeKeyIndex(scope);
    throw error;
  }
}

function reconcileWebScopeKeyIndex(scope: NonMemoryScope): void {
  try {
    const keys = withWebBackendOperation(
      scope,
      "reconcile-key-index",
      (backend) => backend.getAllKeys(),
    );
    replaceWebScopeKeyIndex(scope, keys);
    hydratedWebScopeKeyIndex.add(scope);
  } catch (error) {
    invalidateWebScopeKeyIndex(scope);
    throw error;
  }
}

function throwAfterWebMutationFailure(
  scope: NonMemoryScope,
  operation: string,
  primary: unknown,
  contexts: readonly { label: string; error: unknown }[] = [],
): never {
  try {
    reconcileWebScopeKeyIndex(scope);
  } catch (reconciliationError) {
    throw createStorageCompositeError(operation, primary, [
      ...contexts,
      { label: "index reconciliation", error: reconciliationError },
    ]);
  }
  if (contexts.length > 0) {
    throw createStorageCompositeError(operation, primary, contexts);
  }
  throw primary;
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
    getInternals().clearScopeRawCache(scope);
    ensureWebScopeKeyIndex(scope).clear();
    notifyAllListeners(getInternals().getScopedListeners(scope));
    return;
  }

  if (scope === StorageScope.Secure && key.startsWith(SECURE_WEB_PREFIX)) {
    const plainKey = fromSecureStorageKey(key);
    const oldValue = getInternals().readCachedRawValue(
      StorageScope.Secure,
      plainKey,
      "plain",
    );
    getInternals().invalidateRawCache(StorageScope.Secure, plainKey);
    if (newValue === null) {
      if (
        !withWebBackendOperation(
          StorageScope.Secure,
          "external-sync:getBiometricItem",
          (backend) =>
            backend.getAllKeys().includes(toBiometricStorageKey(plainKey)),
        )
      ) {
        ensureWebScopeKeyIndex(StorageScope.Secure).delete(plainKey);
      }
      getInternals().cacheRawValue(
        StorageScope.Secure,
        plainKey,
        undefined,
        "plain",
      );
    } else {
      ensureWebScopeKeyIndex(StorageScope.Secure).add(plainKey);
      getInternals().cacheRawValue(
        StorageScope.Secure,
        plainKey,
        newValue,
        "plain",
      );
    }
    notifyKeyListeners(
      getInternals().getScopedListeners(StorageScope.Secure),
      plainKey,
    );
    getInternals().emitKeyChange(
      StorageScope.Secure,
      plainKey,
      oldValue === undefined ? undefined : unescapeCollidingRawValue(oldValue),
      newValue === null ? undefined : unescapeCollidingRawValue(newValue),
      "external",
      "external",
    );
    return;
  }

  if (scope === StorageScope.Secure && key.startsWith(BIOMETRIC_WEB_PREFIX)) {
    const plainKey = fromBiometricStorageKey(key);
    const oldValue = getInternals().readCachedRawValue(
      StorageScope.Secure,
      plainKey,
      "biometric",
    );
    getInternals().invalidateRawCache(StorageScope.Secure, plainKey);
    if (newValue === null) {
      if (
        !withWebBackendOperation(
          StorageScope.Secure,
          "external-sync:getItem",
          (backend) =>
            backend.getAllKeys().includes(toSecureStorageKey(plainKey)),
        )
      ) {
        ensureWebScopeKeyIndex(StorageScope.Secure).delete(plainKey);
      }
      getInternals().cacheRawValue(
        StorageScope.Secure,
        plainKey,
        undefined,
        "biometric",
      );
    } else {
      ensureWebScopeKeyIndex(StorageScope.Secure).add(plainKey);
      getInternals().cacheRawValue(
        StorageScope.Secure,
        plainKey,
        newValue,
        "biometric",
      );
    }
    notifyKeyListeners(
      getInternals().getScopedListeners(StorageScope.Secure),
      plainKey,
    );
    getInternals().emitKeyChange(
      StorageScope.Secure,
      plainKey,
      oldValue === undefined ? undefined : unescapeCollidingRawValue(oldValue),
      newValue === null ? undefined : unescapeCollidingRawValue(newValue),
      "external",
      "external",
    );
    return;
  }

  const oldValue = getInternals().readCachedRawValue(scope, key);
  if (newValue === null) {
    ensureWebScopeKeyIndex(scope).delete(key);
    getInternals().cacheRawValue(scope, key, undefined);
  } else {
    ensureWebScopeKeyIndex(scope).add(key);
    getInternals().cacheRawValue(scope, key, newValue);
  }
  notifyKeyListeners(getInternals().getScopedListeners(scope), key);
  getInternals().emitKeyChange(
    scope,
    key,
    oldValue === undefined ? undefined : unescapeCollidingRawValue(oldValue),
    newValue === null ? undefined : unescapeCollidingRawValue(newValue),
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

function retireWebBackend(
  scope: NonMemoryScope,
  previousBackend: WebStorageBackend | undefined,
  nextBackend: WebStorageBackend | undefined,
): void {
  if (!previousBackend || previousBackend === nextBackend) {
    return;
  }
  if (previousBackend.flush) {
    retiredWebBackends.set(previousBackend, scope);
    return;
  }
  closeWebBackend(scope, previousBackend);
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
    try {
      withWebBackendOperation(scope, "set", (backend) => {
        backend.setItem(storageKey, value);
      });
    } catch (error) {
      throwAfterWebMutationFailure(scope, "set", error);
    }
    ensureWebScopeKeyIndex(scope).add(key);
    notifyKeyListeners(getInternals().getScopedListeners(scope), key);
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
    try {
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
    } catch (error) {
      throwAfterWebMutationFailure(scope, "remove", error);
    }
    ensureWebScopeKeyIndex(scope).delete(key);
    notifyKeyListeners(getInternals().getScopedListeners(scope), key);
  },
  clear: (scope: number) => {
    if (scope !== StorageScope.Disk && scope !== StorageScope.Secure) {
      return;
    }
    try {
      withWebBackendOperation(scope, "clear", (backend) => {
        backend.clear();
      });
    } catch (error) {
      throwAfterWebMutationFailure(scope, "clear", error);
    }
    ensureWebScopeKeyIndex(scope).clear();
    notifyAllListeners(getInternals().getScopedListeners(scope));
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
    try {
      withWebBackendOperation(scope, "setBatch", (backend) => {
        if (backend.setMany) {
          backend.setMany(entries);
          return;
        }
        entries.forEach(([storageKey, value]) => {
          backend.setItem(storageKey, value);
        });
      });
    } catch (error) {
      throwAfterWebMutationFailure(scope, "setBatch", error);
    }
    const keyIndex = ensureWebScopeKeyIndex(scope);
    entries.forEach(([storageKey]) =>
      keyIndex.add(
        scope === StorageScope.Secure
          ? storageKey.slice(SECURE_WEB_PREFIX.length)
          : storageKey,
      ),
    );
    const listeners = getInternals().getScopedListeners(scope);
    keys.forEach((key) => {
      notifyKeyListeners(listeners, key);
    });
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

    try {
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
    } catch (error) {
      throwAfterWebMutationFailure(scope, "removeBatch", error);
    }

    const keyIndex = ensureWebScopeKeyIndex(scope);
    keys.forEach((key) => keyIndex.delete(key));
    const listeners = getInternals().getScopedListeners(scope);
    keys.forEach((key) => {
      notifyKeyListeners(listeners, key);
    });
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
    if (
      level !== BiometricLevel.None &&
      typeof __DEV__ !== "undefined" &&
      __DEV__ &&
      !hasWarnedAboutWebBiometricFallback
    ) {
      hasWarnedAboutWebBiometricFallback = true;
      console.warn(
        "[NitroStorage] Biometric storage is not supported on web. Using localStorage.",
      );
    }

    const biometricStorageKey = toBiometricStorageKey(key);
    const plainStorageKey = toSecureStorageKey(key);
    const previous = withWebBackendOperation(
      StorageScope.Secure,
      "setSecureBiometric:readPrevious",
      (backend) => ({
        biometric: backend.getItem(biometricStorageKey),
        plain: backend.getItem(plainStorageKey),
      }),
    );
    getInternals().invalidateRawCache(StorageScope.Secure, key);

    const restoreErrors: { label: string; error: unknown }[] = [];
    const restore = (
      storageKey: string,
      previousValue: string | null,
      label: string,
    ): void => {
      try {
        withWebBackendOperation(
          StorageScope.Secure,
          `setSecureBiometric:rollback:${label}`,
          (backend) => {
            if (previousValue === null) {
              backend.removeItem(storageKey);
            } else {
              backend.setItem(storageKey, previousValue);
            }
          },
        );
      } catch (error) {
        restoreErrors.push({ label: `rollback ${label}`, error });
      }
    };

    try {
      withWebBackendOperation(
        StorageScope.Secure,
        level === BiometricLevel.None
          ? "setSecureBiometric:demote"
          : "setSecureBiometric:promote",
        (backend) => {
          if (level === BiometricLevel.None) {
            backend.removeItem(biometricStorageKey);
            backend.setItem(plainStorageKey, value);
            return;
          }
          backend.setItem(biometricStorageKey, value);
          backend.removeItem(plainStorageKey);
        },
      );
    } catch (error) {
      restore(biometricStorageKey, previous.biometric, "biometric");
      restore(plainStorageKey, previous.plain, "plain");
      throwAfterWebMutationFailure(
        StorageScope.Secure,
        level === BiometricLevel.None
          ? "secure demotion"
          : "biometric promotion",
        error,
        restoreErrors,
      );
    }

    ensureWebScopeKeyIndex(StorageScope.Secure).add(key);
    notifyKeyListeners(
      getInternals().getScopedListeners(StorageScope.Secure),
      key,
    );
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
    try {
      withWebBackendOperation(
        StorageScope.Secure,
        "deleteSecureBiometric",
        (backend) => {
          backend.removeItem(toBiometricStorageKey(key));
        },
      );
    } catch (error) {
      throwAfterWebMutationFailure(
        StorageScope.Secure,
        "delete biometric",
        error,
      );
    }
    let hasPlainValue: string | null;
    try {
      hasPlainValue = withWebBackendOperation(
        StorageScope.Secure,
        "deleteSecureBiometric:getItem",
        (backend) => backend.getItem(toSecureStorageKey(key)),
      );
    } catch (error) {
      throwAfterWebMutationFailure(
        StorageScope.Secure,
        "delete biometric",
        error,
      );
    }
    if (hasPlainValue === null) {
      ensureWebScopeKeyIndex(StorageScope.Secure).delete(key);
    }
    notifyKeyListeners(
      getInternals().getScopedListeners(StorageScope.Secure),
      key,
    );
  },
  hasSecureBiometric: (key: string) => {
    try {
      return withWebBackendOperation(
        StorageScope.Secure,
        "hasSecureBiometric",
        (backend) => backend.getAllKeys().includes(toBiometricStorageKey(key)),
      );
    } catch (error) {
      invalidateWebScopeKeyIndex(StorageScope.Secure);
      throw error;
    }
  },
  clearSecureBiometric: () => {
    let storageKeys: string[];
    try {
      storageKeys = withWebBackendOperation(
        StorageScope.Secure,
        "clearSecureBiometric:getAllKeys",
        (backend) => backend.getAllKeys(),
      );
    } catch (error) {
      invalidateWebScopeKeyIndex(StorageScope.Secure);
      throw error;
    }
    const keysToNotify = storageKeys
      .filter((key) => key.startsWith(BIOMETRIC_WEB_PREFIX))
      .map((key) => fromBiometricStorageKey(key));
    if (keysToNotify.length === 0) {
      replaceWebScopeKeyIndex(StorageScope.Secure, storageKeys);
      hydratedWebScopeKeyIndex.add(StorageScope.Secure);
      return;
    }

    try {
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
    } catch (error) {
      throwAfterWebMutationFailure(
        StorageScope.Secure,
        "clear biometric",
        error,
      );
    }

    reconcileWebScopeKeyIndex(StorageScope.Secure);

    const listeners = getInternals().getScopedListeners(StorageScope.Secure);
    keysToNotify.forEach((key) => {
      notifyKeyListeners(listeners, key);
    });
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
    getInternals().setSecureDefaultAccessControl(level);
    getInternals().recordMetric(
      "storage:setAccessControl",
      StorageScope.Secure,
      0,
    );
  },
  setSecureWritesAsync: (_enabled: boolean) => {
    getInternals().recordMetric(
      "storage:setSecureWritesAsync",
      StorageScope.Secure,
      0,
    );
  },
  setKeychainAccessGroup: (_group: string) => {
    getInternals().recordMetric(
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
    writeBuffering: resolveWebWriteBuffering(
      webDiskStorageBackend?.name,
      webSecureStorageBackend?.name,
    ),
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
export const memoryItem = core.memoryItem;
export const diskItem = core.diskItem;
export const secureItem = core.secureItem;
export const createSetItem = core.createSetItem;
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
  getInternals().flushSecureWrites();
  resetBackendChangeSubscription(StorageScope.Secure);
  webSecureStorageBackend = nextBackend;
  hydratedWebScopeKeyIndex.delete(StorageScope.Secure);
  getInternals().clearScopeRawCache(StorageScope.Secure);
  ensureExternalSyncSubscriptions();
  retireWebBackend(StorageScope.Secure, previousBackend, nextBackend);
}

export function getWebSecureStorageBackend():
  WebSecureStorageBackend | undefined {
  return webSecureStorageBackend;
}

export function setWebDiskStorageBackend(
  backend?: WebDiskStorageBackend,
): void {
  const previousBackend = webDiskStorageBackend;
  const nextBackend = backend ?? createDefaultDiskBackend();
  getInternals().flushDiskWrites();
  resetBackendChangeSubscription(StorageScope.Disk);
  webDiskStorageBackend = nextBackend;
  hydratedWebScopeKeyIndex.delete(StorageScope.Disk);
  getInternals().clearScopeRawCache(StorageScope.Disk);
  ensureExternalSyncSubscriptions();
  retireWebBackend(StorageScope.Disk, previousBackend, nextBackend);
}

export function getWebDiskStorageBackend(): WebDiskStorageBackend | undefined {
  return webDiskStorageBackend;
}

export async function flushWebStorageBackends(): Promise<void> {
  getInternals().flushDiskWrites();
  getInternals().flushSecureWrites();

  const backends = Array.from(
    new Set([
      webDiskStorageBackend,
      webSecureStorageBackend,
      ...retiredWebBackends.keys(),
    ]),
  ).filter((backend): backend is WebStorageBackend => backend !== undefined);

  const results = await Promise.allSettled(
    backends.map(async (backend) => {
      if (backend.flush) {
        await backend.flush();
      }
      if (!retiredWebBackends.has(backend)) {
        return;
      }
      if (
        backend === webDiskStorageBackend ||
        backend === webSecureStorageBackend
      ) {
        retiredWebBackends.delete(backend);
        return;
      }
      const scope = retiredWebBackends.get(backend);
      if (scope === undefined) {
        return;
      }
      closeWebBackend(scope, backend);
      retiredWebBackends.delete(backend);
    }),
  );

  const failure = results.find((result) => result.status === "rejected");
  if (failure) {
    throw failure.reason;
  }
}

export {
  useSetStorage,
  useStorage,
  useStorageActions,
  useStorageSelector,
  useStorageValue,
} from "./storage-hooks";
export { createIndexedDBBackend } from "./indexeddb-backend";
