import {
  createStorageCore,
  type StorageCoreBackend,
  type StorageCoreInternals,
} from "../storage-core";
import { getStorageErrorCode } from "../storage-runtime";
import type { StorageChangeEvent } from "../storage-events";
import { StorageScope } from "../Storage.types";

type DiskFailure = "storage_corruption" | "storage_full" | undefined;

type RecoveryBackend = StorageCoreBackend & {
  disk: Map<string, string>;
  failure: DiskFailure;
  clear: jest.Mock<void, [StorageScope]>;
};

function createRecoveryBackend(): RecoveryBackend {
  const disk = new Map<string, string>();
  const secure = new Map<string, string>();
  const storeFor = (scope: StorageScope) =>
    scope === StorageScope.Disk ? disk : secure;
  const backend = {
    disk,
    failure: undefined as DiskFailure,
  } as RecoveryBackend;
  const guard = (scope: StorageScope): void => {
    if (scope === StorageScope.Disk && backend.failure) {
      throw new Error(
        `[nitro-error:${backend.failure}] NitroStorage: Disk SQLite failed`,
      );
    }
  };
  Object.assign(backend, {
    get: (key: string, scope: StorageScope) => {
      guard(scope);
      return storeFor(scope).get(key);
    },
    set: (key: string, value: string, scope: StorageScope) => {
      guard(scope);
      storeFor(scope).set(key, value);
    },
    remove: (key: string, scope: StorageScope) => {
      guard(scope);
      storeFor(scope).delete(key);
    },
    clear: jest.fn((scope: StorageScope) => {
      storeFor(scope).clear();
      if (scope === StorageScope.Disk) {
        backend.failure = undefined;
      }
    }),
    has: (key: string, scope: StorageScope) => {
      guard(scope);
      return storeFor(scope).has(key);
    },
    getAllKeys: (scope: StorageScope) => {
      guard(scope);
      return Array.from(storeFor(scope).keys());
    },
    getKeysByPrefix: (prefix: string, scope: StorageScope) => {
      guard(scope);
      return Array.from(storeFor(scope).keys()).filter((key) =>
        key.startsWith(prefix),
      );
    },
    size: (scope: StorageScope) => {
      guard(scope);
      return storeFor(scope).size;
    },
    setBatch: (keys: string[], values: string[], scope: StorageScope) => {
      guard(scope);
      keys.forEach((key, index) => {
        const value = values[index];
        if (value !== undefined) {
          storeFor(scope).set(key, value);
        }
      });
    },
    getBatch: (keys: string[], scope: StorageScope) => {
      guard(scope);
      return keys.map((key) => storeFor(scope).get(key));
    },
    removeBatch: (keys: string[], scope: StorageScope) => {
      guard(scope);
      keys.forEach((key) => storeFor(scope).delete(key));
    },
    removeByPrefix: (prefix: string, scope: StorageScope) => {
      guard(scope);
      for (const key of Array.from(storeFor(scope).keys())) {
        if (key.startsWith(prefix)) {
          storeFor(scope).delete(key);
        }
      }
    },
    setSecureAccessControl: () => {},
    getSecureBiometric: () => undefined,
    setSecureBiometricWithLevel: () => {},
    deleteSecureBiometric: () => {},
    hasSecureBiometric: () => false,
    clearSecureBiometric: () => {},
  });
  return backend;
}

function buildCore(backend: RecoveryBackend) {
  return createStorageCore((_internals: StorageCoreInternals) => ({
    backend,
    changeSource: "native",
    applyAccessControlOnSecureRawWrite: true,
    ensureScopeSubscription: () => {},
    maybeCleanupScopeSubscription: () => {},
    onWillEmitChanges: () => {},
    getSecureMetadataProfile: () => ({
      backend: "recovery-test",
      encrypted: "unknown",
      hardwareBacked: "unknown",
    }),
  }));
}

function errorCodeOf(operation: () => void): string | undefined {
  try {
    operation();
  } catch (error) {
    return getStorageErrorCode(error);
  }
  return "did-not-throw";
}

const failures: Exclude<DiskFailure, undefined>[] = [
  "storage_corruption",
  "storage_full",
];

describe.each(failures)("clear(Disk) recovery from %s", (failure) => {
  it("reaches the native clear when a Disk listener is registered", () => {
    const backend = createRecoveryBackend();
    const { storage } = buildCore(backend);
    storage.setString("kept", "value", StorageScope.Disk);
    const events: StorageChangeEvent[] = [];
    const unsubscribe = storage.subscribe(StorageScope.Disk, (event) => {
      events.push(event);
    });
    backend.failure = failure;
    expect(errorCodeOf(() => storage.getAll(StorageScope.Disk))).toBe(failure);

    expect(errorCodeOf(() => storage.clear(StorageScope.Disk))).toBe(
      "did-not-throw",
    );

    expect(backend.clear).toHaveBeenCalledTimes(1);
    expect(backend.clear).toHaveBeenCalledWith(StorageScope.Disk);
    expect(events).toEqual([
      {
        type: "batch",
        scope: StorageScope.Disk,
        operation: "clear",
        source: "native",
        changes: [],
      },
    ]);
    expect(storage.getAll(StorageScope.Disk)).toEqual({});
    storage.setString("after", "ok", StorageScope.Disk);
    expect(storage.getString("after", StorageScope.Disk)).toBe("ok");
    unsubscribe();
  });

  it("reaches the native clear when an event observer is registered", () => {
    const backend = createRecoveryBackend();
    const { storage } = buildCore(backend);
    const observer = jest.fn();
    storage.setEventObserver(observer);
    backend.failure = failure;

    storage.clear(StorageScope.Disk);

    expect(backend.clear).toHaveBeenCalledWith(StorageScope.Disk);
    expect(observer).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "clear", changes: [] }),
    );
    storage.setEventObserver(undefined);
  });

  it("drops pending async writes that cannot be flushed", () => {
    const backend = createRecoveryBackend();
    const { storage } = buildCore(backend);
    storage.setDiskWritesAsync(true);
    storage.setString("pending", "stale", StorageScope.Disk);
    backend.failure = failure;
    expect(errorCodeOf(() => storage.flushDiskWrites())).toBe(failure);
    expect(errorCodeOf(() => storage.flushDiskWrites())).toBe(failure);

    expect(errorCodeOf(() => storage.clear(StorageScope.Disk))).toBe(
      "did-not-throw",
    );

    expect(backend.clear).toHaveBeenCalledTimes(1);
    storage.flushDiskWrites();
    expect(backend.disk.size).toBe(0);
    expect(storage.getString("pending", StorageScope.Disk)).toBeUndefined();
    storage.setString("after", "ok", StorageScope.Disk);
    storage.flushDiskWrites();
    expect(backend.disk.get("after")).toBe("ok");
    storage.setDiskWritesAsync(false);
  });

  it("recovers through clearAll", () => {
    const backend = createRecoveryBackend();
    const { storage } = buildCore(backend);
    const unsubscribe = storage.subscribe(StorageScope.Disk, () => {});
    storage.setString("memory", "m", StorageScope.Memory);
    backend.failure = failure;

    storage.clearAll();

    expect(backend.clear).toHaveBeenCalledWith(StorageScope.Disk);
    expect(backend.clear).toHaveBeenCalledWith(StorageScope.Secure);
    expect(storage.getAll(StorageScope.Memory)).toEqual({});
    unsubscribe();
  });

  it("still reports the failure when the native clear cannot recover", () => {
    const backend = createRecoveryBackend();
    const { storage } = buildCore(backend);
    const unsubscribe = storage.subscribe(StorageScope.Disk, () => {});
    backend.failure = failure;
    backend.clear.mockImplementation(() => {
      throw new Error(`[nitro-error:${failure}] NitroStorage: clear failed`);
    });

    expect(errorCodeOf(() => storage.clear(StorageScope.Disk))).toBe(failure);
    expect(backend.clear).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("keeps pending async writes when the native clear fails", () => {
    const backend = createRecoveryBackend();
    const { storage } = buildCore(backend);
    storage.setDiskWritesAsync(true);
    storage.setString("pending", "kept", StorageScope.Disk);
    backend.failure = failure;
    backend.clear.mockImplementation(() => {
      throw new Error(`[nitro-error:${failure}] NitroStorage: clear failed`);
    });

    expect(errorCodeOf(() => storage.clear(StorageScope.Disk))).toBe(failure);
    expect(storage.getString("pending", StorageScope.Disk)).toBe("kept");

    backend.failure = undefined;
    storage.flushDiskWrites();
    expect(backend.disk.get("pending")).toBe("kept");
    storage.setDiskWritesAsync(false);
  });
});

describe("clear(Disk) on a healthy store", () => {
  it("keeps reporting the previous values to listeners", () => {
    const backend = createRecoveryBackend();
    const { storage } = buildCore(backend);
    storage.setString("a", "1", StorageScope.Disk);
    const events: StorageChangeEvent[] = [];
    const unsubscribe = storage.subscribe(StorageScope.Disk, (event) => {
      events.push(event);
    });

    storage.clear(StorageScope.Disk);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "batch",
      operation: "clear",
      changes: [{ key: "a", oldValue: "1", newValue: undefined }],
    });
    unsubscribe();
  });

  it("emits nothing when the store is already empty", () => {
    const backend = createRecoveryBackend();
    const { storage } = buildCore(backend);
    const listener = jest.fn();
    const unsubscribe = storage.subscribe(StorageScope.Disk, listener);

    storage.clear(StorageScope.Disk);

    expect(listener).not.toHaveBeenCalled();
    expect(backend.clear).toHaveBeenCalledWith(StorageScope.Disk);
    unsubscribe();
  });

  it("does not hide Secure read failures during a Secure clear", () => {
    const backend = createRecoveryBackend();
    const { storage } = buildCore(backend);
    const unsubscribe = storage.subscribe(StorageScope.Secure, () => {});
    const original = backend.getAllKeys;
    backend.getAllKeys = (scope) => {
      if (scope === StorageScope.Secure) {
        throw new Error("[nitro-error:keychain_locked] NitroStorage: locked");
      }
      return original(scope);
    };

    expect(errorCodeOf(() => storage.clear(StorageScope.Secure))).toBe(
      "keychain_locked",
    );
    expect(backend.clear).not.toHaveBeenCalled();
    unsubscribe();
  });
});
