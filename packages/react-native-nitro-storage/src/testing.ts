import { createIndexedDBBackend as createIndexedDBBackendFromSubpath } from "./indexeddb-backend";
import {
  assertAccessControlLevel,
  notifyAllListeners,
  notifyKeyListeners,
} from "./shared";
import type { NonMemoryScope } from "./shared";
import {
  createStorageCore,
  type StorageCoreAdapter,
  type StorageCoreBackend,
  type StorageCoreInternals,
} from "./storage-core";
import type {
  SecurityCapabilities,
  StorageCapabilities,
} from "./storage-runtime";
import { StorageScope, AccessControl } from "./Storage.types";
import type {
  WebDiskStorageBackend,
  WebSecureStorageBackend,
} from "./web-storage-backend";

export { StorageScope, AccessControl, BiometricLevel } from "./Storage.types";
export { isKeychainLockedError } from "./shared";
export type {
  StorageScheduledFlushError,
  StorageScheduledFlushErrorObserver,
} from "./core/durability";
export { migrateFromMMKV } from "./migration";
export { getStorageErrorCode, isStorageError } from "./storage-runtime";
export {
  describeWebBackendCapabilities,
  isIndexedDBWebBackend,
  type WebBackendCapabilities,
} from "./web-backend-contract";
export {
  useSetStorage,
  useStorage,
  useStorageActions,
  useStorageSelector,
  useStorageValue,
} from "./storage-hooks";

export type {
  ExpirationConfig,
  Migration,
  MigrationContext,
  SecureAuthStorageConfig,
  StorageEventObserverOptions,
  StorageExportOptions,
  StorageCacheMetrics,
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
export type {
  SecureStorageMetadata,
  SecurityCapabilities,
  StorageCapabilities,
  StorageErrorCode,
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

const TEST_SECURE_BACKEND = "in-memory-test";

type InMemoryBackend = StorageCoreBackend & {
  resetState: () => void;
};

type ChangeNotifier = (scope: NonMemoryScope, key: string | null) => void;

function createInMemoryBackend(notify: ChangeNotifier): InMemoryBackend {
  const stores = new Map<number, Map<string, string>>([
    [StorageScope.Disk, new Map()],
    [StorageScope.Secure, new Map()],
  ]);
  const biometricStore = new Map<string, string>();

  const storeFor = (scope: StorageScope): Map<string, string> => {
    const store = stores.get(scope);
    if (!store) {
      throw new Error(`NitroStorage testing: unsupported scope ${scope}`);
    }
    return store;
  };

  return {
    get: (key, scope) => storeFor(scope).get(key),
    set: (key, value, scope) => {
      storeFor(scope).set(key, value);
      notify(scope as NonMemoryScope, key);
    },
    remove: (key, scope) => {
      storeFor(scope).delete(key);
      if (scope === StorageScope.Secure) {
        biometricStore.delete(key);
      }
      notify(scope as NonMemoryScope, key);
    },
    clear: (scope) => {
      storeFor(scope).clear();
      notify(scope as NonMemoryScope, null);
    },
    has: (key, scope) => storeFor(scope).has(key),
    getAllKeys: (scope) => Array.from(storeFor(scope).keys()),
    getKeysByPrefix: (prefix, scope) =>
      Array.from(storeFor(scope).keys()).filter((key) =>
        key.startsWith(prefix),
      ),
    size: (scope) => storeFor(scope).size,
    setBatch: (keys, values, scope) => {
      const store = storeFor(scope);
      keys.forEach((key, index) => {
        const value = values[index];
        if (value !== undefined) {
          store.set(key, value);
        }
      });
      keys.forEach((key) => {
        notify(scope as NonMemoryScope, key);
      });
    },
    getBatch: (keys, scope) => {
      const store = storeFor(scope);
      return keys.map((key) => store.get(key));
    },
    removeBatch: (keys, scope) => {
      const store = storeFor(scope);
      keys.forEach((key) => store.delete(key));
      if (scope === StorageScope.Secure) {
        keys.forEach((key) => biometricStore.delete(key));
      }
      keys.forEach((key) => {
        notify(scope as NonMemoryScope, key);
      });
    },
    removeByPrefix: (prefix, scope) => {
      const store = storeFor(scope);
      for (const key of Array.from(store.keys())) {
        if (key.startsWith(prefix)) {
          store.delete(key);
          notify(scope as NonMemoryScope, key);
        }
      }
    },
    setSecureAccessControl: () => {},
    getSecureBiometric: (key) => biometricStore.get(key),
    setSecureBiometricWithLevel: (key, value) => {
      biometricStore.set(key, value);
      storeFor(StorageScope.Secure).delete(key);
      notify(StorageScope.Secure, key);
    },
    deleteSecureBiometric: (key) => {
      biometricStore.delete(key);
      notify(StorageScope.Secure, key);
    },
    hasSecureBiometric: (key) => biometricStore.has(key),
    clearSecureBiometric: () => {
      biometricStore.clear();
      notify(StorageScope.Secure, null);
    },
    resetState: () => {
      stores.forEach((store) => {
        store.clear();
      });
      biometricStore.clear();
    },
  };
}

function buildTestingModule() {
  let coreInternals: StorageCoreInternals | undefined;
  const backend = createInMemoryBackend((scope, key) => {
    if (!coreInternals) {
      return;
    }
    const listeners = coreInternals.getScopedListeners(scope);
    if (key === null) {
      notifyAllListeners(listeners);
      return;
    }
    notifyKeyListeners(listeners, key);
  });

  const buildAdapter = (
    adapterInternals: StorageCoreInternals,
  ): StorageCoreAdapter => {
    coreInternals = adapterInternals;
    return {
      backend,
      changeSource: "native",
      applyAccessControlOnSecureRawWrite: true,
      ensureScopeSubscription: (_scope: NonMemoryScope) => {},
      maybeCleanupScopeSubscription: (_scope: NonMemoryScope) => {},
      onWillEmitChanges: () => {},
      getSecureMetadataProfile: () => ({
        backend: TEST_SECURE_BACKEND,
        encrypted: "unavailable",
        hardwareBacked: "unavailable",
      }),
    };
  };

  const core = createStorageCore(buildAdapter);
  const { internals } = core;

  const storage = {
    ...core.storage,
    setAccessControl: (level: AccessControl) => {
      assertAccessControlLevel(level);
      internals.setSecureDefaultAccessControl(level);
    },
    setSecureWritesAsync: (_enabled: boolean) => {},
    setKeychainAccessGroup: (_group: string) => {},
    getCapabilities: (): StorageCapabilities => ({
      platform: "native",
      backend: {
        disk: "in-memory-test",
        secure: TEST_SECURE_BACKEND,
      },
      writeBuffering: {
        disk: false,
        secure: false,
      },
      errorClassification: true,
    }),
    getSecurityCapabilities: (): SecurityCapabilities => ({
      platform: "native",
      secureStorage: {
        backend: TEST_SECURE_BACKEND,
        encrypted: "unavailable",
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
    }),
  };

  const reset = (): void => {
    storage.setEventObserver(undefined);
    storage.setScheduledFlushErrorObserver(undefined);
    storage.setMetricsObserver(undefined);
    storage.resetMetrics();
    storage.clearAll();
    backend.resetState();
    internals.setSecureDefaultAccessControl(AccessControl.WhenUnlocked);
  };

  return {
    storage,
    createStorageItem: core.createStorageItem,
    memoryItem: core.memoryItem,
    diskItem: core.diskItem,
    secureItem: core.secureItem,
    createSetItem: core.createSetItem,
    getBatch: core.getBatch,
    setBatch: core.setBatch,
    removeBatch: core.removeBatch,
    registerMigration: core.registerMigration,
    migrateToLatest: core.migrateToLatest,
    runTransaction: core.runTransaction,
    createSecureAuthStorage: core.createSecureAuthStorage,
    reset,
  };
}

export type NitroStorageTestModule = ReturnType<typeof buildTestingModule>;

const defaultModule = buildTestingModule();

export const storage = defaultModule.storage;
export const createStorageItem = defaultModule.createStorageItem;
export const memoryItem = defaultModule.memoryItem;
export const diskItem = defaultModule.diskItem;
export const secureItem = defaultModule.secureItem;
export const createSetItem = defaultModule.createSetItem;
export const getBatch = defaultModule.getBatch;
export const setBatch = defaultModule.setBatch;
export const removeBatch = defaultModule.removeBatch;
export const registerMigration = defaultModule.registerMigration;
export const migrateToLatest = defaultModule.migrateToLatest;
export const runTransaction = defaultModule.runTransaction;
export const createSecureAuthStorage = defaultModule.createSecureAuthStorage;

export function setWebSecureStorageBackend(
  _backend?: WebSecureStorageBackend,
): void {}

export function getWebSecureStorageBackend():
  WebSecureStorageBackend | undefined {
  return undefined;
}

export function setWebDiskStorageBackend(
  _backend?: WebDiskStorageBackend,
): void {}

export function getWebDiskStorageBackend(): WebDiskStorageBackend | undefined {
  return undefined;
}

export async function flushWebStorageBackends(): Promise<void> {}

export function resetNitroStorageMock(): void {
  defaultModule.reset();
}

export function createNitroStorageMock(): NitroStorageTestModule {
  return buildTestingModule();
}

/**
 * @deprecated Import `createIndexedDBBackend` from
 * `react-native-nitro-storage/indexeddb-backend` instead. The root export
 * will be removed in a future minor release.
 */
export const createIndexedDBBackend: typeof createIndexedDBBackendFromSubpath =
  createIndexedDBBackendFromSubpath;
