import {
  assertAccessControlLevel,
  notifyAllListeners,
  notifyKeyListeners,
  type NonMemoryScope,
} from "./shared";
import { NitroModules } from "react-native-nitro-modules";
import type { Storage } from "./Storage.nitro";
import { StorageScope, AccessControl } from "./Storage.types";
import { decodeNativeBatchValue } from "./internal";
import type {
  WebDiskStorageBackend,
  WebSecureStorageBackend,
} from "./web-storage-backend";
import type {
  SecurityCapabilities,
  StorageCapabilities,
} from "./storage-runtime";
import {
  createStorageCore,
  type StorageCoreAdapter,
  type StorageCoreBackend,
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

let _storageModule: Storage | null = null;

function getStorageModule(): Storage {
  if (!_storageModule) {
    _storageModule = NitroModules.createHybridObject<Storage>("Storage");
  }
  return _storageModule;
}

const nativeSecureBackend = "platform-secure-storage";

const nativeBackend: StorageCoreBackend = {
  get: (key, scope) => getStorageModule().get(key, scope),
  set: (key, value, scope) => getStorageModule().set(key, value, scope),
  remove: (key, scope) => getStorageModule().remove(key, scope),
  clear: (scope) => getStorageModule().clear(scope),
  has: (key, scope) => getStorageModule().has(key, scope),
  getAllKeys: (scope) => getStorageModule().getAllKeys(scope) ?? [],
  getKeysByPrefix: (prefix, scope) =>
    getStorageModule().getKeysByPrefix(prefix, scope) ?? [],
  size: (scope) => getStorageModule().size(scope),
  setBatch: (keys, values, scope) =>
    getStorageModule().setBatch(keys, values, scope),
  getBatch: (keys, scope) =>
    (getStorageModule().getBatch(keys, scope) ?? []).map((value) =>
      decodeNativeBatchValue(value),
    ),
  removeBatch: (keys, scope) => getStorageModule().removeBatch(keys, scope),
  removeByPrefix: (prefix, scope) =>
    getStorageModule().removeByPrefix(prefix, scope),
  setSecureAccessControl: (level) =>
    getStorageModule().setSecureAccessControl(level),
  getSecureBiometric: (key) => getStorageModule().getSecureBiometric(key),
  setSecureBiometricWithLevel: (key, value, level) =>
    getStorageModule().setSecureBiometricWithLevel(key, value, level),
  deleteSecureBiometric: (key) => getStorageModule().deleteSecureBiometric(key),
  hasSecureBiometric: (key) => getStorageModule().hasSecureBiometric(key),
  clearSecureBiometric: () => getStorageModule().clearSecureBiometric(),
};

function buildNativeAdapter(
  internals: StorageCoreInternals,
): StorageCoreAdapter {
  const scopedUnsubscribers = new Map<NonMemoryScope, () => void>();
  const suppressedNativeEvents = new Map<NonMemoryScope, Map<string, number>>([
    [StorageScope.Disk, new Map()],
    [StorageScope.Secure, new Map()],
  ]);

  function suppressNativeEvent(scope: NonMemoryScope, key: string): void {
    const suppressedEvents = suppressedNativeEvents.get(scope)!;
    suppressedEvents.set(key, (suppressedEvents.get(key) ?? 0) + 1);
  }

  function consumeSuppressedNativeEvent(
    scope: NonMemoryScope,
    key: string,
  ): boolean {
    const suppressedEvents = suppressedNativeEvents.get(scope)!;
    const count = suppressedEvents.get(key);
    if (count === undefined) {
      return false;
    }
    if (count <= 1) {
      suppressedEvents.delete(key);
    } else {
      suppressedEvents.set(key, count - 1);
    }
    return true;
  }

  function ensureNativeScopeSubscription(scope: NonMemoryScope): void {
    if (scopedUnsubscribers.has(scope)) {
      return;
    }

    const unsubscribe = getStorageModule().addOnChange(scope, (key, value) => {
      if (scope === StorageScope.Disk) {
        if (key === "") {
          internals.clearAllPendingDiskWrites();
        } else {
          internals.clearPendingDiskWrite(key);
        }
      }

      if (scope === StorageScope.Secure) {
        if (key === "") {
          internals.clearAllPendingSecureWrites();
        } else {
          internals.clearPendingSecureWrite(key);
        }
      }

      if (key === "") {
        internals.clearScopeRawCache(scope);
        notifyAllListeners(internals.getScopedListeners(scope));
        return;
      }

      const oldValue = internals.readCachedRawValue(scope, key);
      internals.cacheRawValue(scope, key, value);
      notifyKeyListeners(internals.getScopedListeners(scope), key);
      if (consumeSuppressedNativeEvent(scope, key)) {
        return;
      }
      internals.emitKeyChange(
        scope,
        key,
        oldValue,
        value,
        "external",
        "native",
      );
    });
    scopedUnsubscribers.set(
      scope,
      typeof unsubscribe === "function" ? unsubscribe : () => {},
    );
  }

  function maybeCleanupNativeScopeSubscription(scope: NonMemoryScope): void {
    const listeners = internals.getScopedListeners(scope);
    if (
      listeners.size > 0 ||
      internals.hasScopeEventListeners(scope) ||
      internals.hasEventObserver()
    ) {
      return;
    }

    const unsubscribe = scopedUnsubscribers.get(scope);
    if (!unsubscribe) {
      return;
    }

    unsubscribe();
    scopedUnsubscribers.delete(scope);
  }

  return {
    backend: nativeBackend,
    changeSource: "native",
    applyAccessControlOnSecureRawWrite: true,
    flushDiskWritesOnImport: false,
    ensureScopeSubscription: ensureNativeScopeSubscription,
    maybeCleanupScopeSubscription: maybeCleanupNativeScopeSubscription,
    onWillEmitChanges: (scope, keys, operation, source) => {
      if (
        source === "native" &&
        operation !== "external" &&
        scope !== StorageScope.Memory &&
        scopedUnsubscribers.has(scope)
      ) {
        keys.forEach((key) => suppressNativeEvent(scope, key));
      }
    },
    getSecureMetadataProfile: () => ({
      backend: nativeSecureBackend,
      encrypted: "available",
      hardwareBacked: "unknown",
    }),
  };
}

const core = createStorageCore(buildNativeAdapter);
const { internals } = core;

export const storage = {
  ...core.storage,
  setAccessControl: (level: AccessControl) => {
    internals.measureOperation(
      "storage:setAccessControl",
      StorageScope.Secure,
      () => {
        assertAccessControlLevel(level);
        internals.setSecureDefaultAccessControl(level);
        getStorageModule().setSecureAccessControl(level);
      },
    );
  },
  setSecureWritesAsync: (enabled: boolean) => {
    internals.measureOperation(
      "storage:setSecureWritesAsync",
      StorageScope.Secure,
      () => {
        getStorageModule().setSecureWritesAsync(enabled);
      },
    );
  },
  setKeychainAccessGroup: (group: string) => {
    internals.measureOperation(
      "storage:setKeychainAccessGroup",
      StorageScope.Secure,
      () => {
        getStorageModule().setKeychainAccessGroup(group);
      },
    );
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
  _backend?: WebSecureStorageBackend,
): void {
  // Native platforms do not use web secure backends.
}

export function getWebSecureStorageBackend():
  WebSecureStorageBackend | undefined {
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

export {
  useSetStorage,
  useStorage,
  useStorageActions,
  useStorageSelector,
  useStorageValue,
} from "./storage-hooks";
export { createIndexedDBBackend } from "./indexeddb-backend";
