const mockHybridObject = {
  set: jest.fn(),
  get: jest.fn(),
  remove: jest.fn(),
  clear: jest.fn(),
  has: jest.fn(),
  getAllKeys: jest.fn(() => []),
  size: jest.fn(() => 0),
  setBatch: jest.fn(),
  getBatch: jest.fn(() => []),
  removeBatch: jest.fn(),
  removeByPrefix: jest.fn(),
  addOnChange: jest.fn(() => () => {}),
  setSecureAccessControl: jest.fn(),
  setSecureWritesAsync: jest.fn(),
  setKeychainAccessGroup: jest.fn(),
  setSecureBiometric: jest.fn(),
  setSecureBiometricWithLevel: jest.fn(),
  getSecureBiometric: jest.fn(),
  deleteSecureBiometric: jest.fn(),
  hasSecureBiometric: jest.fn(),
  clearSecureBiometric: jest.fn(),
  getKeysByPrefix: jest.fn(() => []),
};

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => mockHybridObject),
  },
}));

import * as NativeEntry from "../index";
import {
  createStorageItem,
  getStorageErrorCode,
  runTransaction,
  setBatch,
  storage,
  StorageScope,
  type StorageChangeEvent,
} from "../index";
import {
  escapeCollidingRawValue,
  serializeWithPrimitiveFastPath,
} from "../internal";

let keySeed = 0;
function uniqueKey(prefix: string): string {
  keySeed += 1;
  return `${prefix}-${keySeed}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.setEventObserver(undefined);
  storage.setDiskWritesAsync(false);
  storage.clear(StorageScope.Memory);
});

describe("deletes do not read previous values without listeners", () => {
  it("does not read a biometric value when deleting it", () => {
    const item = createStorageItem({
      key: uniqueKey("bio-token"),
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    item.delete();

    expect(mockHybridObject.getSecureBiometric).not.toHaveBeenCalled();
    expect(mockHybridObject.deleteSecureBiometric).toHaveBeenCalledWith(
      item.key,
    );
  });

  it("still reads the previous biometric value when an event listener exists", () => {
    const item = createStorageItem({
      key: uniqueKey("bio-token-listened"),
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });
    mockHybridObject.getSecureBiometric.mockReturnValueOnce(
      serializeWithPrimitiveFastPath("old"),
    );
    const events: StorageChangeEvent[] = [];
    const unsubscribe = storage.subscribe(StorageScope.Secure, (event) => {
      events.push(event);
    });

    item.delete();
    unsubscribe();

    expect(mockHybridObject.getSecureBiometric).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "key", operation: "remove" });
  });

  it("does not read a disk value when deleting an item", () => {
    const item = createStorageItem({
      key: uniqueKey("plain"),
      scope: StorageScope.Disk,
      defaultValue: "",
    });

    item.delete();

    expect(mockHybridObject.get).not.toHaveBeenCalled();
    expect(mockHybridObject.remove).toHaveBeenCalledWith(
      item.key,
      StorageScope.Disk,
    );
  });

  it("does not read a raw value in deleteString", () => {
    storage.deleteString(uniqueKey("raw"), StorageScope.Secure);

    expect(mockHybridObject.get).not.toHaveBeenCalled();
    expect(mockHybridObject.remove).toHaveBeenCalledTimes(1);
  });

  it("does not read values for rollback events without listeners", () => {
    const item = createStorageItem({
      key: uniqueKey("rollback-bio"),
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });
    let readsBeforeThrow = -1;

    expect(() =>
      runTransaction(StorageScope.Secure, (tx) => {
        tx.setItem(item, "next");
        readsBeforeThrow =
          mockHybridObject.getSecureBiometric.mock.calls.length;
        throw new Error("abort");
      }),
    ).toThrow("abort");

    expect(mockHybridObject.getSecureBiometric).toHaveBeenCalledTimes(
      readsBeforeThrow,
    );
  });
});

describe("memory scope", () => {
  it("keeps colliding strings intact through setBatch", () => {
    const colliding = "__nitro_storage_escaped__:hello";
    const item = createStorageItem({
      key: uniqueKey("mem-collide"),
      scope: StorageScope.Memory,
      defaultValue: "",
    });

    setBatch([{ item, value: colliding }], StorageScope.Memory);

    expect(item.get()).toBe(colliding);
    expect(storage.getString(item.key, StorageScope.Memory)).toBe(colliding);
  });

  it("drops TTL deadlines when clear(except) removes a key", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_000);
      const onExpired = jest.fn();
      const item = createStorageItem({
        key: uniqueKey("ttl-except"),
        scope: StorageScope.Memory,
        defaultValue: "def",
        expiration: { ttlMs: 100 },
        onExpired,
      });
      item.set("v");
      storage.clear(StorageScope.Memory, { except: ["other"] });
      storage.import({ [item.key]: "imported" }, StorageScope.Memory);

      jest.setSystemTime(1_500);
      expect(storage.getString(item.key, StorageScope.Memory)).toBe("imported");
      item.get();
      expect(onExpired).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("drops TTL deadlines when deleteString removes a key", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_000);
      const onExpired = jest.fn();
      const item = createStorageItem({
        key: uniqueKey("ttl-delete"),
        scope: StorageScope.Memory,
        defaultValue: "def",
        expiration: { ttlMs: 100 },
        onExpired,
      });
      item.set("v");
      storage.deleteString(item.key, StorageScope.Memory);
      storage.setString(item.key, "raw", StorageScope.Memory);

      jest.setSystemTime(1_500);
      item.get();
      expect(onExpired).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("native change echoes", () => {
  it("does not let a late echo of an older write overwrite the cache", () => {
    const item = createStorageItem({
      key: uniqueKey("echo"),
      scope: StorageScope.Disk,
      defaultValue: "",
      readCache: true,
    });
    const unsubscribe = item.subscribe(() => {});
    const onChange = (
      mockHybridObject.addOnChange.mock.calls as unknown as [
        number,
        (key: string, value: string | undefined) => void,
      ][]
    ).find((call) => call[0] === StorageScope.Disk)?.[1];
    expect(onChange).toBeDefined();

    storage.setEventObserver(() => {});
    item.set("A");
    item.set("B");
    onChange?.(item.key, serializeWithPrimitiveFastPath("A"));
    expect(item.get()).toBe("B");
    onChange?.(item.key, serializeWithPrimitiveFastPath("B"));
    expect(item.get()).toBe("B");

    storage.setEventObserver(undefined);
    unsubscribe();
  });
});

describe("raw cache", () => {
  it("does not cache secure reads for items without readCache", () => {
    mockHybridObject.get.mockReturnValue(serializeWithPrimitiveFastPath("s"));
    const before = storage.getCacheMetrics().cacheEntries;
    for (let index = 0; index < 5; index += 1) {
      createStorageItem({
        key: uniqueKey("no-cache"),
        scope: StorageScope.Secure,
        defaultValue: "",
      }).get();
    }
    expect(storage.getCacheMetrics().cacheEntries).toBe(before);
    mockHybridObject.get.mockReset();
  });
});

describe("fallbackToCacheOnReadError", () => {
  function createFallbackItem() {
    const item = createStorageItem({
      key: uniqueKey("fallback"),
      scope: StorageScope.Secure,
      defaultValue: "",
      fallbackToCacheOnReadError: true,
    });
    mockHybridObject.get.mockReturnValueOnce(
      serializeWithPrimitiveFastPath("cached"),
    );
    expect(item.get()).toBe("cached");
    return item;
  }

  it("serves the cached value when the keychain is locked", () => {
    const item = createFallbackItem();
    mockHybridObject.get.mockImplementationOnce(() => {
      throw new Error("[nitro-error:keychain_locked] locked");
    });
    expect(item.get()).toBe("cached");
  });

  it.each(["key_invalidated", "authentication_required", "storage_corruption"])(
    "rethrows %s instead of serving the cached value",
    (code) => {
      const item = createFallbackItem();
      mockHybridObject.get.mockImplementationOnce(() => {
        throw new Error(`[nitro-error:${code}] failed`);
      });
      expect(() => item.get()).toThrow(code);
    },
  );
});

describe("empty keys", () => {
  it("rejects an empty item key with invalid_key", () => {
    let caught: unknown;
    try {
      createStorageItem({ key: "", scope: StorageScope.Disk });
    } catch (error) {
      caught = error;
    }
    expect(getStorageErrorCode(caught)).toBe("invalid_key");
  });

  it("rejects empty raw keys before reaching native", () => {
    expect(() => storage.setString("", "v", StorageScope.Disk)).toThrow(
      "invalid_key",
    );
    expect(() => storage.deleteString("", StorageScope.Secure)).toThrow(
      "invalid_key",
    );
    expect(() => storage.import({ "": "v" }, StorageScope.Disk)).toThrow(
      "invalid_key",
    );
    expect(mockHybridObject.set).not.toHaveBeenCalled();
    expect(mockHybridObject.remove).not.toHaveBeenCalled();
    expect(mockHybridObject.setBatch).not.toHaveBeenCalled();
  });
});

describe("native entry surface", () => {
  it("reports SQLite as the native disk backend", () => {
    expect(storage.getCapabilities().backend.disk).toBe("sqlite");
  });

  it("exports the web backend capability helpers", () => {
    expect(typeof NativeEntry.describeWebBackendCapabilities).toBe("function");
    expect(typeof NativeEntry.isIndexedDBWebBackend).toBe("function");
    expect(
      NativeEntry.isIndexedDBWebBackend({
        name: "indexeddb:app",
      } as Parameters<typeof NativeEntry.isIndexedDBWebBackend>[0]),
    ).toBe(true);
  });

  it("stores escaped colliding values for memory raw writes", () => {
    const colliding = "__nitro_storage_escaped__:raw";
    storage.setString("mem-raw", colliding, StorageScope.Memory);
    expect(storage.getString("mem-raw", StorageScope.Memory)).toBe(colliding);
    expect(escapeCollidingRawValue(colliding)).not.toBe(colliding);
  });
});
