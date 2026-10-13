import {
  createStorageCore,
  type StorageCoreAdapter,
  type StorageCoreBackend,
} from "../storage-core";
import type { StorageChangeSource } from "../storage-events";
import { StorageScope } from "../Storage.types";

export type FailureOperation = "set" | "remove";

export type TestBackend = StorageCoreBackend & {
  stores: Record<StorageScope.Disk | StorageScope.Secure, Map<string, string>>;
  biometric: Map<string, string>;
  failNext(operation: FailureOperation, scope: StorageScope): void;
  lockReads: boolean;
};

export function createTestBackend(): TestBackend {
  const stores = {
    [StorageScope.Disk]: new Map<string, string>(),
    [StorageScope.Secure]: new Map<string, string>(),
  };
  const biometric = new Map<string, string>();
  const failures = new Set<string>();
  const storeFor = (scope: StorageScope) =>
    stores[scope as StorageScope.Disk | StorageScope.Secure];
  const guard = (operation: FailureOperation, scope: StorageScope): void => {
    const id = `${operation}:${scope}`;
    if (failures.delete(id)) {
      throw new Error("[nitro-error:storage_full] NitroStorage: injected");
    }
  };
  const backend: TestBackend = {
    lockReads: false,
    stores,
    biometric,
    failNext: (operation, scope) => {
      failures.add(`${operation}:${scope}`);
    },
    get: (key, scope) => {
      if (backend.lockReads) {
        throw new Error("[nitro-error:keychain_locked] NitroStorage: locked");
      }
      return storeFor(scope).get(key);
    },
    set: (key, value, scope) => {
      guard("set", scope);
      storeFor(scope).set(key, value);
    },
    remove: (key, scope) => {
      guard("remove", scope);
      storeFor(scope).delete(key);
    },
    clear: (scope) => storeFor(scope).clear(),
    has: (key, scope) => storeFor(scope).has(key),
    getAllKeys: (scope) => Array.from(storeFor(scope).keys()),
    getKeysByPrefix: (prefix, scope) =>
      Array.from(storeFor(scope).keys()).filter((key) =>
        key.startsWith(prefix),
      ),
    size: (scope) => storeFor(scope).size,
    setBatch: (keys, values, scope) => {
      keys.forEach((key, index) => {
        const value = values[index];
        if (value !== undefined) {
          storeFor(scope).set(key, value);
        }
      });
    },
    getBatch: (keys, scope) => keys.map((key) => storeFor(scope).get(key)),
    removeBatch: (keys, scope) => {
      keys.forEach((key) => storeFor(scope).delete(key));
    },
    removeByPrefix: (prefix, scope) => {
      for (const key of Array.from(storeFor(scope).keys())) {
        if (key.startsWith(prefix)) {
          storeFor(scope).delete(key);
        }
      }
    },
    setSecureAccessControl: () => {},
    getSecureBiometric: (key) => biometric.get(key),
    setSecureBiometricWithLevel: (key, value) => {
      biometric.set(key, value);
    },
    deleteSecureBiometric: (key) => {
      biometric.delete(key);
    },
    hasSecureBiometric: (key) => biometric.has(key),
    clearSecureBiometric: () => biometric.clear(),
  };
  return backend;
}

export function createTestCore(
  backend: StorageCoreBackend = createTestBackend(),
  overrides: Partial<StorageCoreAdapter> = {},
  changeSource: StorageChangeSource = "native",
) {
  return createStorageCore(() => ({
    backend,
    changeSource,
    applyAccessControlOnSecureRawWrite: true,
    supportsSecureAccessControlMigration: () => true,
    ensureScopeSubscription: () => {},
    maybeCleanupScopeSubscription: () => {},
    onWillEmitChanges: () => {},
    getSecureMetadataProfile: () => ({
      backend: "core-test",
      encrypted: "unknown",
      hardwareBacked: "unknown",
    }),
    ...overrides,
  }));
}
