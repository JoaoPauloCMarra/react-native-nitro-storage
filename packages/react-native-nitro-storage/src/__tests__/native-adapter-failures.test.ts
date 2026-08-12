import {
  createStorageCore,
  type StorageCoreBackend,
  type StorageCoreInternals,
} from "../storage-core";
import { getStorageErrorCode } from "../storage-runtime";
import { StorageScope } from "../Storage.types";
import { serializeWithPrimitiveFastPath } from "../internal";

type FailureBackend = StorageCoreBackend & {
  failingMethods: Set<string>;
};

function createFailureBackend(): FailureBackend {
  const stores = new Map<number, Map<string, string>>([
    [StorageScope.Disk, new Map()],
    [StorageScope.Secure, new Map()],
  ]);
  const biometricStore = new Map<string, string>();
  const failingMethods = new Set<string>();

  const failIfRequested = (method: string): void => {
    if (failingMethods.has(method)) {
      throw new Error("[nitro-error:keychain_locked] NitroStorage: locked");
    }
  };

  const corruptionFailure = (): never => {
    throw new Error(
      "[nitro-error:storage_corruption] NitroStorage: corrupted value",
    );
  };

  return {
    failingMethods,
    get: (key, scope) => {
      failIfRequested("getSecure");
      return stores.get(scope)?.get(key);
    },
    set: (key, value, scope) => {
      failIfRequested("setSecure");
      stores.get(scope)?.set(key, value);
    },
    remove: (key, scope) => {
      stores.get(scope)?.delete(key);
    },
    clear: (scope) => {
      stores.get(scope)?.clear();
    },
    has: (key, scope) => stores.get(scope)?.has(key) ?? false,
    getAllKeys: (scope) => Array.from(stores.get(scope)?.keys() ?? []),
    getKeysByPrefix: (prefix, scope) =>
      Array.from(stores.get(scope)?.keys() ?? []).filter((key) =>
        key.startsWith(prefix),
      ),
    size: (scope) => stores.get(scope)?.size ?? 0,
    setBatch: (keys, values, scope) => {
      const store = stores.get(scope);
      keys.forEach((key, index) => {
        const value = values[index];
        if (value !== undefined) {
          store?.set(key, value);
        }
      });
    },
    getBatch: (keys, scope) => {
      if (failingMethods.has("getBatchSecure")) {
        return keys.map(() => {
          throw new Error("[nitro-error:keychain_locked] NitroStorage: locked");
        });
      }
      return keys.map((key) => stores.get(scope)?.get(key));
    },
    removeBatch: (keys, scope) => {
      const store = stores.get(scope);
      keys.forEach((key) => store?.delete(key));
    },
    removeByPrefix: (prefix, scope) => {
      const store = stores.get(scope);
      for (const key of Array.from(store?.keys() ?? [])) {
        if (key.startsWith(prefix)) {
          store?.delete(key);
        }
      }
    },
    setSecureAccessControl: () => {},
    getSecureBiometric: (key) => biometricStore.get(key),
    setSecureBiometricWithLevel: (key, value) => {
      if (failingMethods.has("setSecureBiometric")) {
        throw new Error(
          "[nitro-error:biometric_unavailable] NitroStorage: biometric off",
        );
      }
      if (failingMethods.has("setSecureBiometricPlainDelete")) {
        biometricStore.set(key, value);
        biometricStore.delete(key);
        throw new Error("[nitro-error:keychain_locked] NitroStorage: locked");
      }
      if (failingMethods.has("setSecureBiometricCorrupt")) {
        corruptionFailure();
      }
      biometricStore.set(key, value);
    },
    deleteSecureBiometric: (key) => {
      biometricStore.delete(key);
    },
    hasSecureBiometric: (key) => biometricStore.has(key),
    clearSecureBiometric: () => {
      biometricStore.clear();
    },
  };
}

function buildCore(backend: FailureBackend) {
  return createStorageCore((internals: StorageCoreInternals) => ({
    backend,
    changeSource: "native",
    applyAccessControlOnSecureRawWrite: true,
    ensureScopeSubscription: () => {},
    maybeCleanupScopeSubscription: () => {},
    onWillEmitChanges: () => {},
    getSecureMetadataProfile: () => ({
      backend: "failure-test",
      encrypted: "unknown",
      hardwareBacked: "unknown",
    }),
  }));
}

describe("native adapter failure injection", () => {
  it("falls back to the cached value when the backend reports keychain_locked", () => {
    const backend = createFailureBackend();
    const core = buildCore(backend);
    const onReadError = jest.fn();
    const item = core.createStorageItem<string>({
      key: "tok",
      scope: StorageScope.Secure,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
      fallbackToCacheOnReadError: true,
      onReadError,
    });

    expect(item.get()).toBe("");
    backend.failingMethods.add("getSecure");
    (item as unknown as { _triggerListeners: () => void })._triggerListeners();
    expect(item.get()).toBe("");
    expect(onReadError).toHaveBeenCalledTimes(1);
    expect(getStorageErrorCode(onReadError.mock.calls[0][0])).toBe(
      "keychain_locked",
    );
  });

  it("rethrows tagged keychain errors from the backend without fallback", () => {
    const backend = createFailureBackend();
    const core = buildCore(backend);
    const item = core.createStorageItem<string>({
      key: "tok2",
      scope: StorageScope.Secure,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    backend.failingMethods.add("getSecure");
    let thrown: unknown;
    try {
      item.get();
    } catch (error) {
      thrown = error;
    }
    expect(getStorageErrorCode(thrown)).toBe("keychain_locked");
    expect((thrown as Error).message).toContain(
      "[nitro-error:keychain_locked]",
    );
  });

  it("classifies biometric promotion failures", () => {
    const backend = createFailureBackend();
    const core = buildCore(backend);
    const item = core.createStorageItem<string>({
      key: "bio",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    backend.failingMethods.add("setSecureBiometric");
    let thrown: unknown;
    try {
      item.set("secret");
    } catch (error) {
      thrown = error;
    }
    expect(getStorageErrorCode(thrown)).toBe("biometric_unavailable");
  });

  it("classifies storage corruption from encrypted preference reads", () => {
    const backend = createFailureBackend();
    const core = buildCore(backend);
    const bioItem = core.createStorageItem<string>({
      key: "corrupt",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    backend.failingMethods.add("setSecureBiometricCorrupt");
    let thrown: unknown;
    try {
      bioItem.set("x");
    } catch (error) {
      thrown = error;
    }
    expect(getStorageErrorCode(thrown)).toBe("storage_corruption");
  });

  it("rolls back the biometric write when the plain delete fails mid-promotion", () => {
    const backend = createFailureBackend();
    const core = buildCore(backend);
    const plain = core.createStorageItem<string>({
      key: "promo-fail",
      scope: StorageScope.Secure,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    const bio = core.createStorageItem<string>({
      key: "promo-fail",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    const events: string[] = [];
    core.storage.setEventObserver((event) => {
      if (event.type === "key") events.push(event.operation);
    });

    plain.set("old-plain");
    backend.failingMethods.add("setSecureBiometricPlainDelete");

    let thrown: unknown;
    try {
      bio.set("new-bio");
    } catch (error) {
      thrown = error;
    }
    core.storage.setEventObserver(undefined);

    expect(getStorageErrorCode(thrown)).toBe("keychain_locked");
    expect(bio.get()).toBe("");
    expect(plain.get()).toBe("old-plain");
    expect(events).toEqual(["set"]);
  });

  it("rolls back transaction writes when the backend fails mid-transaction", () => {
    const backend = createFailureBackend();
    const core = buildCore(backend);
    const rollbackEvents: string[] = [];
    core.storage.setEventObserver((event) => {
      if (event.type === "batch") rollbackEvents.push(event.operation);
    });
    const item = core.createStorageItem<string>({
      key: "tx-fail",
      scope: StorageScope.Secure,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    item.set("before");

    backend.failingMethods.add("setSecure");
    let thrown: unknown;
    try {
      core.runTransaction(StorageScope.Secure, (tx) => {
        tx.setItem(item, "after");
      });
    } catch (error) {
      thrown = error;
    }
    core.storage.setEventObserver(undefined);

    expect(getStorageErrorCode(thrown)).toBe("keychain_locked");
    expect(item.get()).toBe("before");
    expect(rollbackEvents).toEqual(["rollback"]);
  });

  it("writes the native batch sentinel for missing values and decodes it", () => {
    const backend = createFailureBackend();
    const core = buildCore(backend);
    const item = core.createStorageItem<string>({
      key: "sentinel-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    expect(item.get()).toBe("default");
    expect(
      core.storage.getString("sentinel-key", StorageScope.Disk),
    ).toBeUndefined();
  });

  it("keeps raw backend values readable through the raw API", () => {
    const backend = createFailureBackend();
    const core = buildCore(backend);
    const raw = serializeWithPrimitiveFastPath("stored");
    core.storage.setString("raw-key", raw, StorageScope.Disk);
    expect(core.storage.getString("raw-key", StorageScope.Disk)).toBe(raw);
  });
});
