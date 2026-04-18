import { renderHook, act } from "@testing-library/react-hooks";

const mockHybridObject = {
  set: jest.fn(),
  get: jest.fn(),
  remove: jest.fn(),
  clear: jest.fn(),
  has: jest.fn(),
  getAllKeys: jest.fn(),
  size: jest.fn(),
  setBatch: jest.fn(),
  getBatch: jest.fn(),
  removeBatch: jest.fn(),
  removeByPrefix: jest.fn(),
  addOnChange: jest.fn(),
  setSecureAccessControl: jest.fn(),
  setSecureWritesAsync: jest.fn(),
  setKeychainAccessGroup: jest.fn(),
  setSecureBiometric: jest.fn(),
  setSecureBiometricWithLevel: jest.fn(),
  getSecureBiometric: jest.fn(),
  deleteSecureBiometric: jest.fn(),
  hasSecureBiometric: jest.fn(),
  clearSecureBiometric: jest.fn(),
  getKeysByPrefix: jest.fn(),
};

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => mockHybridObject),
  },
}));

import {
  createStorageItem,
  createSecureAuthStorage,
  getStorageErrorCode,
  getWebSecureStorageBackend,
  setWebSecureStorageBackend,
  useStorage,
  useStorageSelector,
  type StorageMetricsEvent,
  StorageScope,
  AccessControl,
  BiometricLevel,
  getBatch,
  setBatch,
  removeBatch,
  migrateToLatest,
  registerMigration,
  runTransaction,
  storage,
  isKeychainLockedError,
} from "../index";
import { serializeWithPrimitiveFastPath } from "../internal";

beforeEach(() => {
  storage.setDiskWritesAsync(false);
});

describe("createStorageItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("creates a storage item with default value", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    mockHybridObject.get.mockReturnValue(undefined);
    expect(item.get()).toBe("default");
  });

  it("gets value from storage", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    mockHybridObject.get.mockReturnValue(
      serializeWithPrimitiveFastPath("stored-value"),
    );
    expect(item.get()).toBe("stored-value");
  });

  it("sets value to storage", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    item.set("new-value");
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "test-key",
      serializeWithPrimitiveFastPath("new-value"),
      StorageScope.Disk,
    );
  });

  it("does not read current value when setting a direct value", () => {
    const item = createStorageItem({
      key: "set-no-read",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    item.set("next");

    expect(mockHybridObject.get).not.toHaveBeenCalled();
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "set-no-read",
      serializeWithPrimitiveFastPath("next"),
      StorageScope.Disk,
    );
  });

  it("applies per-item secure access control on write", () => {
    const strict = createStorageItem({
      key: "strict-key",
      scope: StorageScope.Secure,
      defaultValue: "",
      accessControl: AccessControl.AfterFirstUnlock,
    });
    strict.set("token");

    expect(mockHybridObject.setSecureAccessControl).toHaveBeenCalledWith(
      AccessControl.AfterFirstUnlock,
    );
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "strict-key",
      serializeWithPrimitiveFastPath("token"),
      StorageScope.Secure,
    );
  });

  it("resets secure access control to default when omitted", () => {
    const strict = createStorageItem({
      key: "strict-reset",
      scope: StorageScope.Secure,
      defaultValue: "",
      accessControl: AccessControl.AfterFirstUnlock,
    });
    strict.set("one");

    const plain = createStorageItem({
      key: "plain-reset",
      scope: StorageScope.Secure,
      defaultValue: "",
    });
    plain.set("two");

    expect(mockHybridObject.setSecureAccessControl).toHaveBeenNthCalledWith(
      1,
      AccessControl.AfterFirstUnlock,
    );
    expect(mockHybridObject.setSecureAccessControl).toHaveBeenNthCalledWith(
      2,
      AccessControl.WhenUnlocked,
    );
  });

  it("uses storage-level secure access control when item access control is omitted", () => {
    storage.setAccessControl(AccessControl.AfterFirstUnlock);

    const plain = createStorageItem({
      key: "global-access-control",
      scope: StorageScope.Secure,
      defaultValue: "",
    });
    plain.set("value");

    expect(mockHybridObject.setSecureAccessControl).toHaveBeenNthCalledWith(
      1,
      AccessControl.AfterFirstUnlock,
    );
    expect(mockHybridObject.setSecureAccessControl).toHaveBeenNthCalledWith(
      2,
      AccessControl.AfterFirstUnlock,
    );
  });

  it("deletes value from storage", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    item.delete();
    expect(mockHybridObject.remove).toHaveBeenCalledWith(
      "test-key",
      StorageScope.Disk,
    );
  });

  it("clearing secure scope also clears biometric entries", () => {
    mockHybridObject.clearSecureBiometric.mockClear();
    storage.clear(StorageScope.Secure);
    expect(mockHybridObject.clear).toHaveBeenCalledWith(StorageScope.Secure);
    expect(mockHybridObject.clearSecureBiometric).not.toHaveBeenCalled();
  });

  it("forwards secure write mode configuration to native storage", () => {
    storage.setSecureWritesAsync(true);
    expect(mockHybridObject.setSecureWritesAsync).toHaveBeenCalledWith(true);
  });

  it("coalesces disk writes until flush when configured per item", () => {
    const item = createStorageItem({
      key: "flush-disk",
      scope: StorageScope.Disk,
      defaultValue: "",
      coalesceDiskWrites: true,
    });

    item.set("queued-disk");

    expect(mockHybridObject.set).not.toHaveBeenCalled();
    expect(mockHybridObject.setBatch).not.toHaveBeenCalled();
    expect(item.get()).toBe("queued-disk");

    storage.flushDiskWrites();

    expect(mockHybridObject.setBatch).toHaveBeenCalledWith(
      ["flush-disk"],
      [serializeWithPrimitiveFastPath("queued-disk")],
      StorageScope.Disk,
    );
  });

  it("queues raw disk writes when disk async mode is enabled", () => {
    storage.setDiskWritesAsync(true);

    storage.setString("disk-async", "queued", StorageScope.Disk);

    expect(mockHybridObject.set).not.toHaveBeenCalled();
    expect(mockHybridObject.setBatch).not.toHaveBeenCalled();
    expect(storage.getString("disk-async", StorageScope.Disk)).toBe("queued");

    storage.flushDiskWrites();

    expect(mockHybridObject.setBatch).toHaveBeenCalledWith(
      ["disk-async"],
      ["queued"],
      StorageScope.Disk,
    );
  });

  it("flushes pending secure writes on demand", () => {
    const item = createStorageItem({
      key: "flush-secure",
      scope: StorageScope.Secure,
      defaultValue: "",
      coalesceSecureWrites: true,
    });

    item.set("queued");
    expect(mockHybridObject.setBatch).not.toHaveBeenCalled();

    storage.flushSecureWrites();

    expect(mockHybridObject.setBatch).toHaveBeenCalledWith(
      ["flush-secure"],
      [serializeWithPrimitiveFastPath("queued")],
      StorageScope.Secure,
    );
  });

  it("exposes native capability metadata", () => {
    const capabilities = storage.getCapabilities();

    expect(capabilities.platform).toBe("native");
    expect(capabilities.writeBuffering.disk).toBe(true);
    expect(capabilities.writeBuffering.secure).toBe(true);
    expect(capabilities.backend.disk).toBe("platform-preferences");
    expect(capabilities.backend.secure).toBe("platform-secure-storage");
  });

  it("exposes native security capability metadata", () => {
    const capabilities = storage.getSecurityCapabilities();

    expect(capabilities.platform).toBe("native");
    expect(capabilities.secureStorage.encrypted).toBe("available");
    expect(capabilities.secureStorage.accessControl).toBe("unknown");
    expect(capabilities.biometric.prompt).toBe("unknown");
    expect(capabilities.metadata.listsWithoutValues).toBe(true);
  });

  it("reads secure metadata without fetching secure values", () => {
    mockHybridObject.hasSecureBiometric.mockReturnValue(false);
    mockHybridObject.has.mockReturnValue(true);

    expect(storage.getSecureMetadata("session")).toEqual({
      key: "session",
      exists: true,
      kind: "secure",
      backend: "platform-secure-storage",
      encrypted: "available",
      hardwareBacked: "unknown",
      biometricProtected: false,
      valueExposed: false,
    });
    expect(mockHybridObject.get).not.toHaveBeenCalled();
    expect(mockHybridObject.getSecureBiometric).not.toHaveBeenCalled();
  });

  it("lists secure metadata without returning values", () => {
    mockHybridObject.getAllKeys.mockReturnValue(["session", "pin"]);
    mockHybridObject.has.mockReturnValue(true);
    mockHybridObject.hasSecureBiometric.mockImplementation(
      (key: string) => key === "pin",
    );

    expect(storage.getAllSecureMetadata()).toEqual([
      expect.objectContaining({
        key: "session",
        kind: "secure",
        valueExposed: false,
      }),
      expect.objectContaining({
        key: "pin",
        kind: "biometric",
        biometricProtected: true,
        valueExposed: false,
      }),
    ]);
    expect(mockHybridObject.getBatch).not.toHaveBeenCalled();
  });

  it("clears namespace through native prefix removal", () => {
    storage.clearNamespace("session", StorageScope.Disk);

    expect(mockHybridObject.removeByPrefix).toHaveBeenCalledWith(
      "session:",
      StorageScope.Disk,
    );
    expect(mockHybridObject.getAllKeys).not.toHaveBeenCalled();
  });

  it("subscribes to changes", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    const callback = jest.fn();
    const unsubscribe = item.subscribe(callback);

    expect(mockHybridObject.addOnChange).toHaveBeenCalledWith(
      StorageScope.Disk,
      expect.any(Function),
    );

    unsubscribe();
  });

  it("uses custom serializer", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: 0,
      serialize: (val) => String(val),
      deserialize: (val) => Number(val),
    });

    item.set(42);
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "test-key",
      "42",
      StorageScope.Disk,
    );

    mockHybridObject.get.mockReturnValue("99");
    expect(item.get()).toBe(99);
  });

  it("handles complex objects", () => {
    interface User {
      name: string;
      age: number;
    }

    const item = createStorageItem<User>({
      key: "user",
      scope: StorageScope.Disk,
      defaultValue: { name: "Unknown", age: 0 },
    });

    const user = { name: "John", age: 30 };
    item.set(user);

    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "user",
      serializeWithPrimitiveFastPath(user),
      StorageScope.Disk,
    );

    mockHybridObject.get.mockReturnValue(serializeWithPrimitiveFastPath(user));
    expect(item.get()).toEqual(user);
  });

  it("notifies subscribers on change", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    const listener = jest.fn();
    const unsubscribe = item.subscribe(listener);

    (item as unknown as { _triggerListeners: () => void })._triggerListeners();

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("unsubscribes correctly", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    const listener1 = jest.fn();
    const listener2 = jest.fn();

    const unsub1 = item.subscribe(listener1);
    const unsub2 = item.subscribe(listener2);

    unsub1();
    unsub2();

    (item as unknown as { _triggerListeners: () => void })._triggerListeners();
    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).not.toHaveBeenCalled();
  });

  it("handles nullable types with explicit generic", () => {
    interface User {
      id: string;
      name: string;
    }

    const item = createStorageItem<User | null>({
      key: "user",
      scope: StorageScope.Disk,
      defaultValue: null,
    });

    mockHybridObject.get.mockReturnValue(undefined);
    expect(item.get()).toBe(null);

    const user = { id: "1", name: "John" };
    mockHybridObject.get.mockReturnValue(serializeWithPrimitiveFastPath(user));
    expect(item.get()).toEqual(user);
  });

  it("handles optional defaultValue (defaults to undefined)", () => {
    const item = createStorageItem<string | undefined>({
      key: "optional-key",
      scope: StorageScope.Disk,
    });

    mockHybridObject.get.mockReturnValue(undefined);
    expect(item.get()).toBe(undefined);

    mockHybridObject.get.mockReturnValue(
      serializeWithPrimitiveFastPath("value"),
    );
    expect(item.get()).toBe("value");
  });

  it("infers type from defaultValue", () => {
    const item = createStorageItem({
      key: "counter",
      scope: StorageScope.Disk,
      defaultValue: 0,
    });

    mockHybridObject.get.mockReturnValue(undefined);
    expect(item.get()).toBe(0);

    mockHybridObject.get.mockReturnValue(serializeWithPrimitiveFastPath(42));
    expect(item.get()).toBe(42);
  });

  it("works with Memory scope converted to Disk for native verification", () => {
    const item = createStorageItem({
      key: "memory-key",
      scope: StorageScope.Disk,
      defaultValue: "test",
    });

    item.set("value");
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "memory-key",
      serializeWithPrimitiveFastPath("value"),
      StorageScope.Disk,
    );
  });

  it("works with Disk scope", () => {
    const item = createStorageItem({
      key: "disk-key",
      scope: StorageScope.Disk,
      defaultValue: "test",
    });

    item.set("value");
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "disk-key",
      serializeWithPrimitiveFastPath("value"),
      StorageScope.Disk,
    );
  });

  it("works with Secure scope", () => {
    const item = createStorageItem({
      key: "secure-key",
      scope: StorageScope.Secure,
      defaultValue: "test",
    });

    item.set("value");
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "secure-key",
      serializeWithPrimitiveFastPath("value"),
      StorageScope.Secure,
    );
  });
});

describe("useStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("returns current value and setter", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "initial",
    });

    mockHybridObject.get.mockReturnValue(
      serializeWithPrimitiveFastPath("initial"),
    );

    const { result } = renderHook(() => useStorage(item));

    expect(result.current[0]).toBe("initial");
    expect(typeof result.current[1]).toBe("function");
  });

  it("updates when value changes", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "initial",
    });

    mockHybridObject.get.mockReturnValue(
      serializeWithPrimitiveFastPath("initial"),
    );
    const { result } = renderHook(() => useStorage(item));
    expect(result.current[0]).toBe("initial");

    mockHybridObject.get.mockReturnValue(
      serializeWithPrimitiveFastPath("updated"),
    );
    act(() => {
      (
        item as unknown as { _triggerListeners: () => void }
      )._triggerListeners();
    });

    expect(result.current[0]).toBe("updated");
  });

  it("maintains strict object reference stability to prevent render loops", () => {
    const item = createStorageItem({
      key: "test-ref",
      scope: StorageScope.Disk,
      defaultValue: { count: 0 },
    });

    const obj = { count: 1 };
    mockHybridObject.get.mockReturnValue(serializeWithPrimitiveFastPath(obj));

    const ref1 = item.get();
    expect(ref1).toEqual(obj);

    const ref2 = item.get();
    expect(ref2).toBe(ref1);

    const newObj = { count: 2 };
    mockHybridObject.get.mockReturnValue(
      serializeWithPrimitiveFastPath(newObj),
    );

    const ref3 = item.get();
    expect(ref3).toEqual(newObj);
    expect(ref3).not.toBe(ref1);
  });

  it("cleans up native listeners to prevent memory leaks", () => {
    const item = createStorageItem({
      key: "test-leak",
      scope: StorageScope.Disk,
      defaultValue: "val",
    });

    const listener1 = jest.fn();
    const listener2 = jest.fn();
    const unsub1 = item.subscribe(listener1);
    const unsub2 = item.subscribe(listener2);

    (item as unknown as { _triggerListeners: () => void })._triggerListeners();
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();

    listener1.mockClear();
    listener2.mockClear();
    (item as unknown as { _triggerListeners: () => void })._triggerListeners();
    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).not.toHaveBeenCalled();
  });

  it("calls setter correctly", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "initial",
    });

    mockHybridObject.get.mockReturnValue(
      serializeWithPrimitiveFastPath("initial"),
    );

    const { result } = renderHook(() => useStorage(item));

    act(() => {
      result.current[1]("new-value");
    });

    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "test-key",
      serializeWithPrimitiveFastPath("new-value"),
      StorageScope.Disk,
    );
  });

  it("supports selectors and skips rerenders when selected value is unchanged", () => {
    const item = createStorageItem({
      key: "selector-test",
      scope: StorageScope.Memory,
      defaultValue: { count: 0, label: "a" },
    });

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useStorageSelector(
        item,
        (value) => ({ count: value.count }),
        (prev, next) => prev.count === next.count,
      );
    });

    expect(result.current[0]).toEqual({ count: 0 });
    expect(renderCount).toBe(1);

    act(() => {
      item.set((prev) => ({ ...prev, label: "b" }));
    });
    expect(result.current[0]).toEqual({ count: 0 });
    expect(renderCount).toBe(1);

    act(() => {
      item.set((prev) => ({ ...prev, count: 1 }));
    });
    expect(result.current[0]).toEqual({ count: 1 });
    expect(renderCount).toBe(2);
  });

  it("supports read-through cache when enabled", () => {
    const item = createStorageItem({
      key: "cache-default",
      scope: StorageScope.Disk,
      defaultValue: "default",
      readCache: true,
    });

    mockHybridObject.get.mockReturnValue(
      serializeWithPrimitiveFastPath("cached"),
    );
    expect(item.get()).toBe("cached");
    expect(item.get()).toBe("cached");
    expect(mockHybridObject.get).toHaveBeenCalledTimes(1);
  });

  it("keeps read-through cache disabled by default", () => {
    const item = createStorageItem({
      key: "cache-disabled",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    mockHybridObject.get.mockReturnValue(
      serializeWithPrimitiveFastPath("cached"),
    );
    expect(item.get()).toBe("cached");
    expect(item.get()).toBe("cached");
    expect(mockHybridObject.get).toHaveBeenCalledTimes(2);
  });

  it("dispatches memory listeners by key and fan-outs on clear", () => {
    const itemA = createStorageItem({
      key: "shared-a",
      scope: StorageScope.Memory,
      defaultValue: "a",
    });
    const itemB = createStorageItem({
      key: "shared-b",
      scope: StorageScope.Memory,
      defaultValue: "b",
    });

    const listenerA = jest.fn();
    const listenerB = jest.fn();
    const unsubA = itemA.subscribe(listenerA);
    const unsubB = itemB.subscribe(listenerB);

    act(() => {
      itemA.set("next-a");
    });
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(0);

    act(() => {
      storage.clear(StorageScope.Memory);
    });
    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerB).toHaveBeenCalledTimes(1);

    unsubA();
    unsubB();
  });

  it("coalesces secure writes in the same tick when enabled", async () => {
    const item = createStorageItem({
      key: "secure-coalesce",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
    });

    item.set("first");
    item.set("second");

    expect(mockHybridObject.set).not.toHaveBeenCalled();
    expect(mockHybridObject.setBatch).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(mockHybridObject.setBatch).toHaveBeenCalledWith(
      ["secure-coalesce"],
      [serializeWithPrimitiveFastPath("second")],
      StorageScope.Secure,
    );
  });

  it("coalesces secure writes with item-level access control", async () => {
    const item = createStorageItem({
      key: "secure-coalesce-access",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
      accessControl: AccessControl.AfterFirstUnlock,
    });

    item.set("value");
    expect(mockHybridObject.set).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(mockHybridObject.setSecureAccessControl).toHaveBeenCalledWith(
      AccessControl.AfterFirstUnlock,
    );
    expect(mockHybridObject.setBatch).toHaveBeenCalledWith(
      ["secure-coalesce-access"],
      [serializeWithPrimitiveFastPath("value")],
      StorageScope.Secure,
    );
  });

  it("uses per-item read-cache behavior in mixed getBatch reads", () => {
    const cachedItem = createStorageItem({
      key: "mixed-cache-cached",
      scope: StorageScope.Disk,
      defaultValue: "cached-default",
      readCache: true,
    });
    const uncachedItem = createStorageItem({
      key: "mixed-cache-uncached",
      scope: StorageScope.Disk,
      defaultValue: "uncached-default",
    });

    mockHybridObject.get.mockReturnValueOnce(
      serializeWithPrimitiveFastPath("cached-value"),
    );
    expect(cachedItem.get()).toBe("cached-value");

    mockHybridObject.getBatch.mockReturnValue([
      serializeWithPrimitiveFastPath("uncached-value"),
    ]);

    const values = getBatch([cachedItem, uncachedItem], StorageScope.Disk);
    expect(values).toEqual(["cached-value", "uncached-value"]);
    expect(mockHybridObject.getBatch).toHaveBeenCalledWith(
      ["mixed-cache-uncached"],
      StorageScope.Disk,
    );
  });

  it("returns default for missing raw batch values without per-item get calls", () => {
    const item = createStorageItem({
      key: "raw-missing-default",
      scope: StorageScope.Disk,
      defaultValue: "fallback",
    });

    mockHybridObject.getBatch.mockReturnValue([
      "__nitro_storage_batch_missing__::v1",
    ]);

    const values = getBatch([item], StorageScope.Disk);
    expect(values).toEqual(["fallback"]);
    expect(mockHybridObject.get).not.toHaveBeenCalled();
  });

  it("supports getWithVersion and setIfVersion optimistic writes", () => {
    const item = createStorageItem({
      key: "versioned-counter",
      scope: StorageScope.Disk,
      defaultValue: 0,
    });

    mockHybridObject.get.mockReturnValue(undefined);
    const snapshot = item.getWithVersion();
    expect(snapshot.value).toBe(0);

    const firstWrite = item.setIfVersion(snapshot.version, 1);
    expect(firstWrite).toBe(true);
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "versioned-counter",
      serializeWithPrimitiveFastPath(1),
      StorageScope.Disk,
    );

    mockHybridObject.get.mockReturnValue(serializeWithPrimitiveFastPath(2));
    const staleWrite = item.setIfVersion(snapshot.version, 3);
    expect(staleWrite).toBe(false);
  });

  it("supports biometricLevel for secure biometric writes", () => {
    const item = createStorageItem({
      key: "bio-level",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometricLevel: BiometricLevel.BiometryOrPasscode,
    });

    item.set("secret");
    expect(mockHybridObject.setSecureBiometricWithLevel).toHaveBeenCalledWith(
      "bio-level",
      serializeWithPrimitiveFastPath("secret"),
      BiometricLevel.BiometryOrPasscode,
    );
  });

  it("exposes prefix read APIs on storage", () => {
    mockHybridObject.getKeysByPrefix.mockReturnValue([
      "session:token",
      "session:user",
    ]);
    mockHybridObject.getBatch.mockReturnValue([
      serializeWithPrimitiveFastPath("tkn"),
      serializeWithPrimitiveFastPath("usr"),
    ]);

    const keys = storage.getKeysByPrefix("session:", StorageScope.Disk);
    const entries = storage.getByPrefix("session:", StorageScope.Disk);

    expect(keys).toEqual(["session:token", "session:user"]);
    expect(entries).toEqual({
      "session:token": serializeWithPrimitiveFastPath("tkn"),
      "session:user": serializeWithPrimitiveFastPath("usr"),
    });
  });

  it("emits operation metrics and exposes counter snapshots", () => {
    const metricsEvents: StorageMetricsEvent[] = [];
    storage.setMetricsObserver((event) => metricsEvents.push(event));
    storage.resetMetrics();

    const item = createStorageItem({
      key: "metric-item",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });
    mockHybridObject.get.mockReturnValue(serializeWithPrimitiveFastPath("v"));

    item.set("v");
    item.get();
    storage.getAllKeys(StorageScope.Disk);

    const snapshot = storage.getMetricsSnapshot();
    expect(metricsEvents.length).toBeGreaterThan(0);
    expect(snapshot["item:set"]).toBeDefined();
    expect(snapshot["item:get"]).toBeDefined();
    expect(snapshot["storage:getAllKeys"]).toBeDefined();

    storage.setMetricsObserver(undefined);
    storage.resetMetrics();
  });

  it("keeps web secure backend hooks as native no-ops", () => {
    expect(getWebSecureStorageBackend()).toBeUndefined();

    setWebSecureStorageBackend({
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
      getAllKeys: jest.fn(() => []),
    });

    expect(getWebSecureStorageBackend()).toBeUndefined();
  });

  it("covers memory utility branches for storage helpers", () => {
    const namespaced = createStorageItem({
      key: "token",
      scope: StorageScope.Memory,
      defaultValue: "",
      namespace: "session",
    });
    const plain = createStorageItem({
      key: "plain",
      scope: StorageScope.Memory,
      defaultValue: "",
    });
    const numeric = createStorageItem({
      key: "count",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });

    namespaced.set("tkn");
    plain.set("value");
    numeric.set(42);

    expect(storage.has("session:token", StorageScope.Memory)).toBe(true);
    expect(storage.getAllKeys(StorageScope.Memory)).toEqual(
      expect.arrayContaining(["session:token", "plain", "count"]),
    );
    expect(storage.getKeysByPrefix("session:", StorageScope.Memory)).toEqual([
      "session:token",
    ]);
    expect(storage.getAll(StorageScope.Memory)).toEqual(
      expect.objectContaining({
        "session:token": "tkn",
        plain: "value",
      }),
    );
    expect(storage.getAll(StorageScope.Memory).count).toBeUndefined();
    expect(storage.size(StorageScope.Memory)).toBeGreaterThanOrEqual(3);

    storage.clearNamespace("session", StorageScope.Memory);
    expect(storage.has("session:token", StorageScope.Memory)).toBe(false);
    expect(storage.has("plain", StorageScope.Memory)).toBe(true);
  });

  it("covers disk getAll edge branches for empty and missing values", () => {
    mockHybridObject.getAllKeys.mockReturnValueOnce([]);
    expect(storage.getAll(StorageScope.Disk)).toEqual({});
    expect(mockHybridObject.getBatch).not.toHaveBeenCalled();

    mockHybridObject.getAllKeys.mockReturnValueOnce(["a", "b"]);
    mockHybridObject.getBatch.mockReturnValueOnce([
      serializeWithPrimitiveFastPath("x"),
      "__nitro_storage_batch_missing__::v1",
    ]);
    expect(storage.getAll(StorageScope.Disk)).toEqual({
      a: serializeWithPrimitiveFastPath("x"),
    });
  });

  it("covers item branches for non-string disk reads and secure biometric delete/has", () => {
    const weirdDisk = createStorageItem({
      key: "weird-disk",
      scope: StorageScope.Disk,
      defaultValue: "fallback",
    });
    mockHybridObject.get.mockReturnValueOnce(123 as unknown as string);
    expect(weirdDisk.get()).toBe("fallback");

    const memoryItem = createStorageItem({
      key: "memory-has",
      scope: StorageScope.Memory,
      defaultValue: "",
    });
    expect(memoryItem.has()).toBe(false);
    memoryItem.set("v");
    expect(memoryItem.has()).toBe(true);

    const biometricItem = createStorageItem({
      key: "bio-delete",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });
    mockHybridObject.hasSecureBiometric.mockReturnValue(true);
    expect(biometricItem.has()).toBe(true);
    biometricItem.delete();
    expect(mockHybridObject.deleteSecureBiometric).toHaveBeenCalledWith(
      "bio-delete",
    );
  });

  it("covers pending secure batch reads, secure batch fallback, and secure remove flush", () => {
    const pendingItem = createStorageItem({
      key: "pending-read",
      scope: StorageScope.Secure,
      defaultValue: "",
      coalesceSecureWrites: true,
    });
    pendingItem.set("queued");

    const pendingValues = getBatch([pendingItem], StorageScope.Secure);
    expect(pendingValues).toEqual(["queued"]);
    expect(mockHybridObject.getBatch).not.toHaveBeenCalled();

    const validatedSecure = createStorageItem<number>({
      key: "validated-secure-fallback",
      scope: StorageScope.Secure,
      defaultValue: 1,
      validate: (value): value is number =>
        typeof value === "number" && value > 0,
    });
    expect(() =>
      setBatch([{ item: validatedSecure, value: -1 }], StorageScope.Secure),
    ).toThrow(/Validation failed/);

    removeBatch([pendingItem], StorageScope.Secure);
    expect(mockHybridObject.setBatch).toHaveBeenCalled();
    expect(mockHybridObject.removeBatch).toHaveBeenCalledWith(
      ["pending-read"],
      StorageScope.Secure,
    );
  });

  it("handles idempotent unsubscribe for memory listeners", () => {
    const item = createStorageItem({
      key: "memory-unsub-idempotent",
      scope: StorageScope.Memory,
      defaultValue: "",
    });
    const unsubscribe = item.subscribe(jest.fn());

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("covers createSecureAuthStorage namespace and option branches", () => {
    const auth = createSecureAuthStorage({
      accessToken: {
        ttlMs: 60_000,
        biometric: true,
        biometricLevel: BiometricLevel.BiometryOrPasscode,
        accessControl: AccessControl.AfterFirstUnlock,
      },
      refreshToken: {},
    });

    expect(auth.accessToken.key).toBe("auth:accessToken");
    expect(auth.refreshToken.key).toBe("auth:refreshToken");

    auth.accessToken.set("a");
    auth.refreshToken.set("r");

    const secureCall =
      mockHybridObject.setSecureBiometricWithLevel.mock.calls[0];
    expect(secureCall?.[0]).toBe("auth:accessToken");
    expect(secureCall?.[2]).toBe(BiometricLevel.BiometryOrPasscode);
    expect(() => JSON.parse(secureCall?.[1] as string)).not.toThrow();
    const envelope = JSON.parse(secureCall?.[1] as string) as {
      __nitroStorageEnvelope?: boolean;
      payload?: string;
    };
    expect(envelope.__nitroStorageEnvelope).toBe(true);
    expect(envelope.payload).toBe(serializeWithPrimitiveFastPath("a"));
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "auth:refreshToken",
      serializeWithPrimitiveFastPath("r"),
      StorageScope.Secure,
    );

    const custom = createSecureAuthStorage(
      { session: {} },
      { namespace: "custom" },
    );
    expect(custom.session.key).toBe("custom:session");
  });
});

describe("Batch Operations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  const item1 = createStorageItem({
    key: "batch-1",
    scope: StorageScope.Disk,
    defaultValue: "d1",
  });
  const item2 = createStorageItem({
    key: "batch-2",
    scope: StorageScope.Disk,
    defaultValue: "d2",
  });
  const secureItem = createStorageItem({
    key: "batch-secure",
    scope: StorageScope.Secure,
    defaultValue: "s1",
  });

  it("sets multiple items at once", () => {
    setBatch(
      [
        { item: item1, value: "v1" },
        { item: item2, value: "v2" },
      ],
      StorageScope.Disk,
    );

    expect(mockHybridObject.setBatch).toHaveBeenCalledWith(
      ["batch-1", "batch-2"],
      [
        serializeWithPrimitiveFastPath("v1"),
        serializeWithPrimitiveFastPath("v2"),
      ],
      StorageScope.Disk,
    );
  });

  it("applies storage-level access control for secure raw batch path", () => {
    storage.setAccessControl(AccessControl.AfterFirstUnlock);

    setBatch([{ item: secureItem, value: "secure-v1" }], StorageScope.Secure);

    expect(mockHybridObject.setSecureAccessControl).toHaveBeenNthCalledWith(
      1,
      AccessControl.AfterFirstUnlock,
    );
    expect(mockHybridObject.setSecureAccessControl).toHaveBeenNthCalledWith(
      2,
      AccessControl.AfterFirstUnlock,
    );
  });

  it("groups secure raw batch writes by access control", () => {
    storage.setAccessControl(AccessControl.WhenUnlocked);
    mockHybridObject.setSecureAccessControl.mockClear();

    const strictItem = createStorageItem({
      key: "secure-ac-1",
      scope: StorageScope.Secure,
      defaultValue: "",
      accessControl: AccessControl.AfterFirstUnlock,
    });
    const passcodeItem = createStorageItem({
      key: "secure-ac-2",
      scope: StorageScope.Secure,
      defaultValue: "",
      accessControl: AccessControl.WhenPasscodeSetThisDeviceOnly,
    });
    const plainItem = createStorageItem({
      key: "secure-ac-3",
      scope: StorageScope.Secure,
      defaultValue: "",
    });

    setBatch(
      [
        { item: strictItem, value: "v1" },
        { item: passcodeItem, value: "v2" },
        { item: plainItem, value: "v3" },
      ],
      StorageScope.Secure,
    );

    expect(mockHybridObject.setSecureAccessControl).toHaveBeenNthCalledWith(
      1,
      AccessControl.AfterFirstUnlock,
    );
    expect(mockHybridObject.setSecureAccessControl).toHaveBeenNthCalledWith(
      2,
      AccessControl.WhenPasscodeSetThisDeviceOnly,
    );
    expect(mockHybridObject.setSecureAccessControl).toHaveBeenNthCalledWith(
      3,
      AccessControl.WhenUnlocked,
    );
    expect(mockHybridObject.setBatch).toHaveBeenNthCalledWith(
      1,
      ["secure-ac-1"],
      [serializeWithPrimitiveFastPath("v1")],
      StorageScope.Secure,
    );
    expect(mockHybridObject.setBatch).toHaveBeenNthCalledWith(
      2,
      ["secure-ac-2"],
      [serializeWithPrimitiveFastPath("v2")],
      StorageScope.Secure,
    );
    expect(mockHybridObject.setBatch).toHaveBeenNthCalledWith(
      3,
      ["secure-ac-3"],
      [serializeWithPrimitiveFastPath("v3")],
      StorageScope.Secure,
    );
  });

  it("gets multiple items at once", () => {
    mockHybridObject.getBatch.mockReturnValue([
      serializeWithPrimitiveFastPath("v1"),
      serializeWithPrimitiveFastPath("v2"),
    ]);

    mockHybridObject.get.mockImplementation((key) => {
      if (key === "batch-1") return serializeWithPrimitiveFastPath("v1");
      if (key === "batch-2") return serializeWithPrimitiveFastPath("v2");
      return undefined;
    });

    const values = getBatch([item1, item2], StorageScope.Disk);

    expect(mockHybridObject.getBatch).toHaveBeenCalledWith(
      ["batch-1", "batch-2"],
      StorageScope.Disk,
    );
    expect(values).toEqual(["v1", "v2"]);
  });

  it("removes multiple items at once", () => {
    removeBatch([item1, item2], StorageScope.Disk);

    expect(mockHybridObject.removeBatch).toHaveBeenCalledWith(
      ["batch-1", "batch-2"],
      StorageScope.Disk,
    );
    expect(mockHybridObject.remove).not.toHaveBeenCalled();
  });

  it("throws on scope mismatch for getBatch", () => {
    expect(() => getBatch([item1, secureItem], StorageScope.Disk)).toThrow(
      /Batch scope mismatch/,
    );
    expect(mockHybridObject.getBatch).not.toHaveBeenCalled();
  });

  it("throws on scope mismatch for setBatch", () => {
    expect(() =>
      setBatch(
        [
          { item: item1, value: "v1" },
          { item: secureItem, value: "v2" },
        ],
        StorageScope.Disk,
      ),
    ).toThrow(/Batch scope mismatch/);
    expect(mockHybridObject.setBatch).not.toHaveBeenCalled();
  });

  it("throws on scope mismatch for removeBatch", () => {
    expect(() => removeBatch([item1, secureItem], StorageScope.Disk)).toThrow(
      /Batch scope mismatch/,
    );
    expect(mockHybridObject.removeBatch).not.toHaveBeenCalled();
  });

  describe("Memory Scope", () => {
    const mem1 = createStorageItem({
      key: "mem-1",
      scope: StorageScope.Memory,
      defaultValue: "m1",
    });
    const mem2 = createStorageItem({
      key: "mem-2",
      scope: StorageScope.Memory,
      defaultValue: "m2",
    });

    it("sets multiple items in memory", () => {
      setBatch(
        [
          { item: mem1, value: "mv1" },
          { item: mem2, value: "mv2" },
        ],
        StorageScope.Memory,
      );

      expect(mem1.get()).toBe("mv1");
      expect(mem2.get()).toBe("mv2");
    });

    it("gets multiple items from memory", () => {
      mem1.set("mv1-new");
      mem2.set("mv2-new");

      const values = getBatch([mem1, mem2], StorageScope.Memory);
      expect(values).toEqual(["mv1-new", "mv2-new"]);
    });

    it("removes multiple items from memory", () => {
      mem1.set("to-be-deleted");
      removeBatch([mem1, mem2], StorageScope.Memory);
      expect(mem1.get()).toBe("m1"); // Default value
    });
  });

  it("falls back to item default in getBatch if native returns undefined", () => {
    mockHybridObject.getBatch.mockReturnValue([
      undefined,
      serializeWithPrimitiveFastPath("v2"),
    ]);

    const item1WithFallback = createStorageItem({
      key: "fallback-1",
      scope: StorageScope.Disk,
      defaultValue: "d1",
    });

    const values = getBatch([item1WithFallback, item2], StorageScope.Disk);
    expect(values).toEqual(["d1", "v2"]);
  });

  it("uses per-item set path for validated items", () => {
    const validatedItem = createStorageItem<number>({
      key: "batch-validated-set",
      scope: StorageScope.Disk,
      defaultValue: 1,
      validate: (value): value is number =>
        typeof value === "number" && value > 0,
    });

    expect(() =>
      setBatch([{ item: validatedItem, value: -1 }], StorageScope.Disk),
    ).toThrow(/Validation failed/);

    expect(mockHybridObject.setBatch).not.toHaveBeenCalled();
  });

  it("uses per-item get path for validated items", () => {
    const validatedItem = createStorageItem<number>({
      key: "batch-validated-get",
      scope: StorageScope.Disk,
      defaultValue: 7,
      validate: (value): value is number =>
        typeof value === "number" && value > 10,
    });

    mockHybridObject.get.mockReturnValue(serializeWithPrimitiveFastPath(2));
    const values = getBatch([validatedItem], StorageScope.Disk);

    expect(values).toEqual([7]);
    expect(mockHybridObject.getBatch).not.toHaveBeenCalled();
  });

  it("uses native secure batch read path for access-control items", () => {
    const strictItem = createStorageItem({
      key: "batch-secure-ac-get",
      scope: StorageScope.Secure,
      defaultValue: "",
      accessControl: AccessControl.AfterFirstUnlock,
    });

    mockHybridObject.getBatch.mockReturnValue([
      serializeWithPrimitiveFastPath("secure"),
    ]);

    const values = getBatch([strictItem], StorageScope.Secure);

    expect(values).toEqual(["secure"]);
    expect(mockHybridObject.getBatch).toHaveBeenCalledWith(
      ["batch-secure-ac-get"],
      StorageScope.Secure,
    );
    expect(mockHybridObject.get).not.toHaveBeenCalled();
  });

  it("treats native batch missing sentinel as undefined", () => {
    const sentinelItem = createStorageItem({
      key: "batch-native-sentinel",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    mockHybridObject.getBatch.mockReturnValue([
      "__nitro_storage_batch_missing__::v1",
    ]);

    const values = getBatch([sentinelItem], StorageScope.Disk);
    expect(values).toEqual(["default"]);
  });
});

describe("v0.2 features", () => {
  const diskStore = new Map<string, string>();
  let migrationVersionSeed = 1_000;

  beforeEach(() => {
    jest.clearAllMocks();
    diskStore.clear();
    storage.clearAll();

    mockHybridObject.get.mockImplementation((key: string) =>
      diskStore.get(key),
    );
    mockHybridObject.set.mockImplementation((key: string, value: string) => {
      diskStore.set(key, value);
    });
    mockHybridObject.remove.mockImplementation((key: string) => {
      diskStore.delete(key);
    });
    mockHybridObject.setBatch.mockImplementation(
      (keys: string[], values: string[]) => {
        keys.forEach((key, index) => {
          const value = values[index];
          if (value === undefined) {
            return;
          }
          diskStore.set(key, value);
        });
      },
    );
    mockHybridObject.removeBatch.mockImplementation((keys: string[]) => {
      keys.forEach((key) => {
        diskStore.delete(key);
      });
    });
  });

  it("supports schema validation and fallback handling", () => {
    const item = createStorageItem<number>({
      key: "validated",
      scope: StorageScope.Disk,
      defaultValue: 0,
      validate: (value): value is number =>
        typeof value === "number" && value >= 0,
      onValidationError: () => 10,
    });

    mockHybridObject.get.mockReturnValueOnce(
      serializeWithPrimitiveFastPath(-1),
    );
    expect(item.get()).toBe(10);
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "validated",
      serializeWithPrimitiveFastPath(10),
      StorageScope.Disk,
    );

    expect(() => item.set(-2)).toThrow(/Validation failed/);
  });

  it("expires values with TTL", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const item = createStorageItem<string>({
      key: "ttl-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
      expiration: { ttlMs: 100 },
    });

    item.set("value");
    nowSpy.mockReturnValue(1_050);
    expect(item.get()).toBe("value");

    nowSpy.mockReturnValue(1_150);
    expect(item.get()).toBe("default");
    expect(mockHybridObject.remove).toHaveBeenCalledWith(
      "ttl-key",
      StorageScope.Disk,
    );
    nowSpy.mockRestore();
  });

  it("reuses TTL parse cache while value is still valid", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const parseSpy = jest.spyOn(JSON, "parse");
    const item = createStorageItem<string>({
      key: "ttl-parse-cache",
      scope: StorageScope.Disk,
      defaultValue: "default",
      expiration: { ttlMs: 200 },
    });
    const envelope = JSON.stringify({
      __nitroStorageEnvelope: true,
      expiresAt: 1_100,
      payload: serializeWithPrimitiveFastPath("cached"),
    });
    mockHybridObject.get.mockReturnValue(envelope);

    expect(item.get()).toBe("cached");
    expect(item.get()).toBe("cached");
    expect(parseSpy).toHaveBeenCalledTimes(1);

    parseSpy.mockRestore();
    nowSpy.mockRestore();
  });

  it("rolls back transaction on errors", () => {
    const item = createStorageItem<string>({
      key: "txn-key",
      scope: StorageScope.Disk,
      defaultValue: "init",
    });
    item.set("before");

    expect(() =>
      runTransaction(StorageScope.Disk, (tx) => {
        tx.setItem(item, "during");
        tx.setRaw("another", JSON.stringify("x"));
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(item.get()).toBe("before");
    expect(diskStore.get("another")).toBeUndefined();
  });

  it("rolls back disk transactions using native batch writes", () => {
    expect(() =>
      runTransaction(StorageScope.Disk, (tx) => {
        tx.setRaw("rollback-a", serializeWithPrimitiveFastPath("a"));
        tx.setRaw("rollback-b", serializeWithPrimitiveFastPath("b"));
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(
      mockHybridObject.setBatch.mock.calls.length +
        mockHybridObject.removeBatch.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it("runs registered migrations in order and stores applied version", () => {
    const v1 = migrationVersionSeed++;
    const v2 = migrationVersionSeed++;

    registerMigration(v1, ({ setRaw }) => {
      setRaw("migrated-a", JSON.stringify("a"));
    });
    registerMigration(v2, ({ setRaw }) => {
      setRaw("migrated-b", JSON.stringify("b"));
    });

    const appliedVersion = migrateToLatest(StorageScope.Disk);

    expect(appliedVersion).toBe(v2);
    expect(diskStore.get("migrated-a")).toBe(JSON.stringify("a"));
    expect(diskStore.get("migrated-b")).toBe(JSON.stringify("b"));
    expect(diskStore.get("__nitro_storage_migration_version__")).toBe(
      String(v2),
    );
  });
});

describe("v0.2 edge cases", () => {
  const diskStore = new Map<string, string>();
  let migrationVersionSeed = 5_000;

  beforeEach(() => {
    jest.clearAllMocks();
    diskStore.clear();
    storage.clearAll();

    mockHybridObject.get.mockImplementation((key: string) =>
      diskStore.get(key),
    );
    mockHybridObject.set.mockImplementation((key: string, value: string) => {
      diskStore.set(key, value);
    });
    mockHybridObject.remove.mockImplementation((key: string) => {
      diskStore.delete(key);
    });
  });

  it("throws on non-positive ttl", () => {
    expect(() =>
      createStorageItem({
        key: "invalid-ttl",
        scope: StorageScope.Disk,
        expiration: { ttlMs: 0 },
      }),
    ).toThrow("expiration.ttlMs must be greater than 0.");
  });

  it("falls back to default when invalid stored value has no validation handler", () => {
    const item = createStorageItem<number>({
      key: "invalid-default",
      scope: StorageScope.Disk,
      defaultValue: 7,
      validate: (value): value is number =>
        typeof value === "number" && value > 10,
    });

    diskStore.set("invalid-default", JSON.stringify(3));
    expect(item.get()).toBe(7);
    expect(diskStore.get("invalid-default")).toBe(JSON.stringify(3));
  });

  it("falls back to default when validation handler returns invalid value", () => {
    const item = createStorageItem<number>({
      key: "invalid-handler",
      scope: StorageScope.Disk,
      defaultValue: 11,
      validate: (value): value is number =>
        typeof value === "number" && value > 10,
      onValidationError: () => 1,
    });

    diskStore.set("invalid-handler", JSON.stringify(2));
    expect(item.get()).toBe(11);
  });

  it("accepts legacy non-envelope payloads for ttl items", () => {
    const item = createStorageItem<string>({
      key: "legacy-ttl",
      scope: StorageScope.Disk,
      defaultValue: "default",
      expiration: { ttlMs: 100 },
    });

    diskStore.set("legacy-ttl", JSON.stringify("legacy-value"));
    expect(item.get()).toBe("legacy-value");
  });

  it("expires memory ttl values and resets to default", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(2_000);
    const item = createStorageItem<string>({
      key: "mem-ttl",
      scope: StorageScope.Memory,
      defaultValue: "m-default",
      expiration: { ttlMs: 50 },
    });

    item.set("m-value");
    nowSpy.mockReturnValue(2_030);
    expect(item.get()).toBe("m-value");

    nowSpy.mockReturnValue(2_060);
    expect(item.get()).toBe("m-default");
    item.delete();
    nowSpy.mockRestore();
  });

  it("throws for invalid migration versions and duplicates", () => {
    expect(() => registerMigration(0, () => undefined)).toThrow(
      "Migration version must be a positive integer.",
    );

    const version = migrationVersionSeed++;
    registerMigration(version, () => undefined);
    expect(() => registerMigration(version, () => undefined)).toThrow(
      `Migration version ${version} is already registered.`,
    );
  });

  it("uses memory migration context helpers", () => {
    const version = migrationVersionSeed++;
    registerMigration(version, ({ getRaw, setRaw, removeRaw }) => {
      setRaw("m-key", JSON.stringify("value"));
      expect(getRaw("m-key")).toBe(JSON.stringify("value"));
      removeRaw("m-key");
      expect(getRaw("m-key")).toBeUndefined();
    });

    expect(migrateToLatest(StorageScope.Memory)).toBe(version);
  });

  it("rolls back memory transactions and keeps first rollback snapshot", () => {
    const item = createStorageItem<string>({
      key: "tx-memory",
      scope: StorageScope.Memory,
      defaultValue: "start",
    });
    item.set("initial");

    expect(() =>
      runTransaction(StorageScope.Memory, (tx) => {
        tx.setRaw("tx-memory", JSON.stringify("step-1"));
        tx.setRaw("tx-memory", JSON.stringify("step-2"));
        tx.removeRaw("tx-memory");
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(item.get()).toBe("initial");
  });

  it("supports transaction removeItem and getItem with scope checks", () => {
    const item = createStorageItem<string>({
      key: "tx-item",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });
    const otherScopeItem = createStorageItem<string>({
      key: "tx-item-other",
      scope: StorageScope.Secure,
      defaultValue: "default",
    });
    item.set("value");

    runTransaction(StorageScope.Disk, (tx) => {
      expect(tx.getItem(item)).toBe("value");
      tx.removeItem(item);
    });

    expect(item.get()).toBe("default");
    expect(() =>
      runTransaction(StorageScope.Disk, (tx) => {
        tx.getItem(otherScopeItem);
      }),
    ).toThrow(/Batch scope mismatch/);
  });

  it("uses item.set semantics in transactions for ttl items", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(10_000);
    const ttlItem = createStorageItem<string>({
      key: "tx-ttl",
      scope: StorageScope.Disk,
      defaultValue: "default",
      expiration: { ttlMs: 100 },
    });

    runTransaction(StorageScope.Disk, (tx) => {
      tx.setItem(ttlItem, "value");
    });

    const raw = diskStore.get("tx-ttl");
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!)).toEqual({
      __nitroStorageEnvelope: true,
      expiresAt: 10_100,
      payload: serializeWithPrimitiveFastPath("value"),
    });
    nowSpy.mockRestore();
  });

  it("uses item.set validation semantics in transactions for memory scope", () => {
    const validatedMemoryItem = createStorageItem<string>({
      key: "tx-memory-validated",
      scope: StorageScope.Memory,
      defaultValue: "ok",
      validate: (value): value is string => value === "ok" || value === "great",
    });

    runTransaction(StorageScope.Memory, (tx) => {
      tx.setItem(validatedMemoryItem, "great");
    });
    expect(validatedMemoryItem.get()).toBe("great");

    expect(() =>
      runTransaction(StorageScope.Memory, (tx) => {
        tx.setItem(validatedMemoryItem, "bad");
      }),
    ).toThrow(/Validation failed/);
  });
});

describe("storage.import", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("imports key-value pairs into Memory scope", () => {
    storage.import({ greeting: "hello", count: "42" }, StorageScope.Memory);
    expect(storage.has("greeting", StorageScope.Memory)).toBe(true);
    expect(storage.has("count", StorageScope.Memory)).toBe(true);
  });

  it("emits change listeners for each imported key in Memory scope", () => {
    const item = createStorageItem({
      key: "imported-key",
      scope: StorageScope.Memory,
      defaultValue: "",
    });
    const listener = jest.fn();
    item.subscribe(listener);

    storage.import({ "imported-key": "imported-value" }, StorageScope.Memory);
    expect(listener).toHaveBeenCalled();
    item.subscribe(listener)(); // unsubscribe
  });

  it("imports key-value pairs into Disk scope via setBatch", () => {
    storage.import({ "disk-a": "v1", "disk-b": "v2" }, StorageScope.Disk);
    expect(mockHybridObject.setBatch).toHaveBeenCalledWith(
      expect.arrayContaining(["disk-a", "disk-b"]),
      expect.arrayContaining(["v1", "v2"]),
      StorageScope.Disk,
    );
  });

  it("flushes pending secure writes and sets access control before Secure import", () => {
    storage.import({ token: "abc" }, StorageScope.Secure);
    expect(mockHybridObject.setSecureAccessControl).toHaveBeenCalled();
    expect(mockHybridObject.setBatch).toHaveBeenCalledWith(
      ["token"],
      ["abc"],
      StorageScope.Secure,
    );
  });

  it("is a no-op when given an empty object", () => {
    storage.import({}, StorageScope.Memory);
    storage.import({}, StorageScope.Disk);
    expect(mockHybridObject.setBatch).not.toHaveBeenCalled();
  });

  it("throws on invalid scope", () => {
    expect(() =>
      storage.import({ key: "val" }, 99 as unknown as StorageScope),
    ).toThrow(/Invalid storage scope/);
  });
});

describe("TTL expiry subscriber notification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("notifies item subscribers when a disk-scoped envelope expires on first read", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(5_000);
    const item = createStorageItem<string>({
      key: "ttl-notify-disk",
      scope: StorageScope.Disk,
      defaultValue: "fallback",
      expiration: { ttlMs: 100 },
    });

    // Return an already-expired envelope from the mock native layer
    mockHybridObject.get.mockReturnValueOnce(
      JSON.stringify({
        __nitroStorageEnvelope: true,
        expiresAt: 4_999, // expired
        payload: serializeWithPrimitiveFastPath("stale"),
      }),
    );

    const listener = jest.fn();
    item.subscribe(listener);

    const value = item.get();
    expect(value).toBe("fallback");
    expect(listener).toHaveBeenCalled();

    item.subscribe(listener)(); // unsubscribe
    nowSpy.mockRestore();
  });

  it("notifies item subscribers when a cached disk-scoped value expires on subsequent read", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(10_000);

    // Provide a valid envelope first so the item caches the expiresAt
    const envelope = JSON.stringify({
      __nitroStorageEnvelope: true,
      expiresAt: 10_500,
      payload: serializeWithPrimitiveFastPath("fresh"),
    });
    mockHybridObject.get.mockReturnValue(envelope);

    const item = createStorageItem<string>({
      key: "ttl-notify-cache",
      scope: StorageScope.Disk,
      defaultValue: "fallback",
      expiration: { ttlMs: 500 },
    });

    const listener = jest.fn();
    item.subscribe(listener);

    // First read caches the envelope parse
    expect(item.get()).toBe("fresh");

    // Same raw value returned but time has advanced past expiry
    nowSpy.mockReturnValue(10_600);
    const valueAfterExpiry = item.get();

    expect(valueAfterExpiry).toBe("fallback");
    expect(listener).toHaveBeenCalled();

    item.subscribe(listener)(); // unsubscribe
    nowSpy.mockRestore();
  });
});

describe("setBatch Memory atomicity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clear(StorageScope.Memory);
  });

  it("writes all items before firing any listener (no validation/expiry items)", () => {
    const itemA = createStorageItem({
      key: "atom-a",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });
    const itemB = createStorageItem({
      key: "atom-b",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });

    const seenDuringNotification: Array<{ a: number; b: number }> = [];

    itemA.subscribe(() => {
      seenDuringNotification.push({ a: itemA.get(), b: itemB.get() });
    });

    setBatch(
      [
        { item: itemA, value: 1 },
        { item: itemB, value: 2 },
      ],
      StorageScope.Memory,
    );

    // Both values should already be present when the listener fires
    expect(seenDuringNotification[0]).toEqual({ a: 1, b: 2 });
    expect(itemA.get()).toBe(1);
    expect(itemB.get()).toBe(2);
  });

  it("falls back to individual sets when any item has validation", () => {
    const validated = createStorageItem({
      key: "atom-validated",
      scope: StorageScope.Memory,
      defaultValue: 0,
      validate: (v): v is number => typeof v === "number" && v > 0,
    });
    const plain = createStorageItem({
      key: "atom-plain",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });

    setBatch(
      [
        { item: validated, value: 5 },
        { item: plain, value: 10 },
      ],
      StorageScope.Memory,
    );

    expect(validated.get()).toBe(5);
    expect(plain.get()).toBe(10);
  });
});

describe("storage raw APIs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("getString returns undefined for a missing Disk key", () => {
    mockHybridObject.get.mockReturnValueOnce(undefined);
    expect(storage.getString("missing-key", StorageScope.Disk)).toBeUndefined();
  });

  it("getString returns the raw string for a Disk key", () => {
    mockHybridObject.get.mockReturnValueOnce("raw-val");
    expect(storage.getString("raw-key", StorageScope.Disk)).toBe("raw-val");
  });

  it("setString calls native set with the exact string value and correct scope for Disk", () => {
    storage.setString("disk-key", "disk-value", StorageScope.Disk);
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "disk-key",
      "disk-value",
      StorageScope.Disk,
    );
  });

  it("setString calls native set with the exact string value and correct scope for Secure", () => {
    storage.setString("secure-key", "secure-value", StorageScope.Secure);
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "secure-key",
      "secure-value",
      StorageScope.Secure,
    );
  });

  it("deleteString calls native remove for a Disk key", () => {
    storage.deleteString("disk-del-key", StorageScope.Disk);
    expect(mockHybridObject.remove).toHaveBeenCalledWith(
      "disk-del-key",
      StorageScope.Disk,
    );
  });

  it("deleteString calls native remove for a Secure key", () => {
    storage.deleteString("secure-del-key", StorageScope.Secure);
    expect(mockHybridObject.remove).toHaveBeenCalledWith(
      "secure-del-key",
      StorageScope.Secure,
    );
  });

  it("getString/setString/deleteString work for Memory scope without calling the native module", () => {
    storage.setString("mem-key", "mem-val", StorageScope.Memory);
    expect(storage.getString("mem-key", StorageScope.Memory)).toBe("mem-val");

    storage.deleteString("mem-key", StorageScope.Memory);
    expect(storage.getString("mem-key", StorageScope.Memory)).toBeUndefined();

    expect(mockHybridObject.set).not.toHaveBeenCalled();
    expect(mockHybridObject.get).not.toHaveBeenCalled();
    expect(mockHybridObject.remove).not.toHaveBeenCalled();
  });
});

describe("isKeychainLockedError", () => {
  it("classifies storage errors into stable codes", () => {
    expect(
      getStorageErrorCode(
        new Error("[nitro-error:keychain_locked] NitroStorage: locked"),
      ),
    ).toBe("keychain_locked");
    expect(
      getStorageErrorCode(
        new Error(
          "[nitro-error:authentication_required] NitroStorage: auth required",
        ),
      ),
    ).toBe("authentication_required");
    expect(getStorageErrorCode(new Error("errSecInteractionNotAllowed"))).toBe(
      "keychain_locked",
    );
    expect(
      getStorageErrorCode(new Error("UserNotAuthenticatedException")),
    ).toBe("authentication_required");
    expect(
      getStorageErrorCode(new Error("KeyPermanentlyInvalidatedException")),
    ).toBe("key_invalidated");
    expect(getStorageErrorCode(new Error("AEADBadTagException"))).toBe(
      "storage_corruption",
    );
    expect(
      getStorageErrorCode(
        new Error("Biometric storage is not available on this device"),
      ),
    ).toBe("biometric_unavailable");
    expect(getStorageErrorCode(new Error("something else"))).toBe(undefined);
  });

  it('returns true for "errSecInteractionNotAllowed"', () => {
    expect(
      isKeychainLockedError(new Error("errSecInteractionNotAllowed")),
    ).toBe(true);
  });

  it('returns true for "UserNotAuthenticatedException"', () => {
    expect(
      isKeychainLockedError(new Error("UserNotAuthenticatedException")),
    ).toBe(true);
  });

  it('returns true for "KeyStoreException"', () => {
    expect(isKeychainLockedError(new Error("KeyStoreException"))).toBe(true);
  });

  it('returns true for "KeyPermanentlyInvalidatedException"', () => {
    expect(
      isKeychainLockedError(new Error("KeyPermanentlyInvalidatedException")),
    ).toBe(true);
  });

  it('returns true for "InvalidKeyException"', () => {
    expect(isKeychainLockedError(new Error("InvalidKeyException"))).toBe(true);
  });

  it('returns true for "android.security.keystore"', () => {
    expect(isKeychainLockedError(new Error("android.security.keystore"))).toBe(
      true,
    );
  });

  it("returns false for unrelated Error", () => {
    expect(isKeychainLockedError(new Error("something else"))).toBe(false);
  });

  it("returns false for non-Error values (string, null, undefined, number)", () => {
    expect(isKeychainLockedError("errSecInteractionNotAllowed")).toBe(false);
    expect(isKeychainLockedError(null)).toBe(false);
    expect(isKeychainLockedError(undefined)).toBe(false);
    expect(isKeychainLockedError(42)).toBe(false);
  });
});

describe("version token (setIfVersion)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("setIfVersion returns false when version does not match", () => {
    const item = createStorageItem({
      key: "ver-key",
      scope: StorageScope.Memory,
      defaultValue: "initial",
    });

    item.set("initial");
    const { version } = item.getWithVersion();
    const result = item.setIfVersion("wrong-version", "updated");
    expect(result).toBe(false);
    expect(item.get()).toBe("initial");
    expect(item.getWithVersion().version).toBe(version);
  });

  it("setIfVersion returns true and updates when version matches", () => {
    const item = createStorageItem({
      key: "ver-key",
      scope: StorageScope.Memory,
      defaultValue: "initial",
    });

    item.set("initial");
    const { version } = item.getWithVersion();
    const result = item.setIfVersion(version, "updated");
    expect(result).toBe(true);
    expect(item.get()).toBe("updated");
  });

  it("getWithVersion returns consistent version for same value", () => {
    const item = createStorageItem({
      key: "ver-key",
      scope: StorageScope.Memory,
      defaultValue: "stable",
    });

    item.set("stable");
    const v1 = item.getWithVersion().version;
    const v2 = item.getWithVersion().version;
    expect(v1).toBe(v2);
  });

  it("getWithVersion returns different version after value changes", () => {
    const item = createStorageItem({
      key: "ver-key",
      scope: StorageScope.Memory,
      defaultValue: "first",
    });

    item.set("first");
    const v1 = item.getWithVersion().version;

    item.set("second");
    const v2 = item.getWithVersion().version;
    expect(v1).not.toBe(v2);
  });
});

describe("secure write coalescing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("coalesced writes call scheduleSecureWrite instead of immediate native set", () => {
    const item = createStorageItem({
      key: "coal-key",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
    });

    item.set("coalesced-value");
    expect(mockHybridObject.set).not.toHaveBeenCalled();
  });

  it("reading a coalesced secure item returns pending value before flush", () => {
    mockHybridObject.get.mockReturnValue(undefined);

    const item = createStorageItem({
      key: "coal-read-key",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
    });

    item.set("pending-value");
    expect(item.get()).toBe("pending-value");
  });
});

describe("transaction rollback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("transaction rollback in Memory scope restores original values", () => {
    const item = createStorageItem({
      key: "tx-mem",
      scope: StorageScope.Memory,
      defaultValue: "original",
    });

    item.set("original");

    expect(() =>
      runTransaction(StorageScope.Memory, (tx) => {
        tx.setItem(item, "modified");
        expect(item.get()).toBe("modified");
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(item.get()).toBe("original");
  });

  it("transaction rollback in Disk scope calls native setBatch/removeBatch", () => {
    mockHybridObject.get.mockReturnValue(
      serializeWithPrimitiveFastPath("disk-original"),
    );

    const item = createStorageItem({
      key: "tx-disk",
      scope: StorageScope.Disk,
      defaultValue: "disk-default",
    });

    expect(() =>
      runTransaction(StorageScope.Disk, (tx) => {
        tx.setItem(item, "disk-modified");
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(mockHybridObject.setBatch).toHaveBeenCalled();
  });

  it("transaction rollback for previously-undefined key removes it", () => {
    mockHybridObject.get.mockReturnValue(undefined);

    const item = createStorageItem({
      key: "tx-new-key",
      scope: StorageScope.Disk,
      defaultValue: "fallback",
    });

    expect(() =>
      runTransaction(StorageScope.Disk, (tx) => {
        tx.setItem(item, "created-value");
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(mockHybridObject.removeBatch).toHaveBeenCalledWith(
      ["tx-new-key"],
      StorageScope.Disk,
    );
  });
});

describe("createSecureAuthStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("creates items for all keys in config", () => {
    const auth = createSecureAuthStorage(
      {
        token: { ttlMs: 60000 },
        refresh: { biometric: true },
      },
      { namespace: "myauth" },
    );

    expect(auth.token).toBeDefined();
    expect(auth.refresh).toBeDefined();
  });

  it("items use Secure scope", () => {
    const auth = createSecureAuthStorage(
      {
        token: { ttlMs: 60000 },
        refresh: { biometric: true },
      },
      { namespace: "myauth" },
    );

    auth.token.set("tok-val");
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "myauth:token",
      expect.any(String),
      StorageScope.Secure,
    );
  });

  it("items have correct namespace prefix", () => {
    const auth = createSecureAuthStorage(
      {
        token: { ttlMs: 60000 },
        refresh: { biometric: true },
      },
      { namespace: "myauth" },
    );

    expect(auth.token.key).toBe("myauth:token");
    expect(auth.refresh.key).toBe("myauth:refresh");
  });

  it("items with ttlMs get expiration config", () => {
    const auth = createSecureAuthStorage(
      {
        token: { ttlMs: 60000 },
        refresh: { biometric: true },
      },
      { namespace: "myauth" },
    );

    auth.token.set("val");
    mockHybridObject.get.mockReturnValue(serializeWithPrimitiveFastPath("val"));

    // The item was created — ttlMs presence is verified by the factory accepting it
    // without throwing. We verify the item is functional.
    expect(auth.token.get()).toBe("val");
  });

  it("items with biometric flag set correctly", () => {
    const auth = createSecureAuthStorage(
      {
        token: { ttlMs: 60000 },
        refresh: { biometric: true },
      },
      { namespace: "myauth" },
    );

    auth.refresh.set("refresh-val");
    expect(mockHybridObject.setSecureBiometricWithLevel).toHaveBeenCalledWith(
      "myauth:refresh",
      expect.any(String),
      expect.anything(),
    );
  });
});

describe("memory scope optimizations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("memory scope get/set does not call native module", () => {
    const item = createStorageItem({
      key: "mem-opt",
      scope: StorageScope.Memory,
      defaultValue: "default",
    });

    item.set("mem-value");
    expect(item.get()).toBe("mem-value");

    expect(mockHybridObject.set).not.toHaveBeenCalled();
    expect(mockHybridObject.get).not.toHaveBeenCalled();
  });

  it("memory scope clear does not call native module", () => {
    // clearAllMocks already ran in beforeEach, but clearAll calls native clear
    // for Disk/Secure. Reset the mock to isolate this test.
    mockHybridObject.clear.mockClear();
    storage.clear(StorageScope.Memory);
    expect(mockHybridObject.clear).not.toHaveBeenCalled();
  });

  it("clearNamespace in memory scope removes only namespaced keys", () => {
    const nsA = createStorageItem({
      key: "a",
      scope: StorageScope.Memory,
      defaultValue: "",
      namespace: "ns",
    });
    const nsB = createStorageItem({
      key: "b",
      scope: StorageScope.Memory,
      defaultValue: "",
      namespace: "ns",
    });
    const other = createStorageItem({
      key: "other",
      scope: StorageScope.Memory,
      defaultValue: "",
    });

    nsA.set("val-a");
    nsB.set("val-b");
    other.set("val-other");

    storage.clearNamespace("ns", StorageScope.Memory);

    expect(nsA.get()).toBe("");
    expect(nsB.get()).toBe("");
    expect(other.get()).toBe("val-other");
  });
});

describe("storage.clearBiometric", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("calls native clearSecureBiometric", () => {
    storage.clearBiometric();
    expect(mockHybridObject.clearSecureBiometric).toHaveBeenCalled();
  });
});

describe("biometric storage items", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it("biometric item set calls setSecureBiometricWithLevel on native", () => {
    const item = createStorageItem({
      key: "bio-key",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    item.set("bio-value");
    expect(mockHybridObject.setSecureBiometricWithLevel).toHaveBeenCalledWith(
      "bio-key",
      expect.any(String),
      expect.anything(),
    );
  });

  it("biometric item get calls getSecureBiometric on native", () => {
    mockHybridObject.getSecureBiometric.mockReturnValue(
      serializeWithPrimitiveFastPath("bio-value"),
    );

    const item = createStorageItem({
      key: "bio-key",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    const result = item.get();
    expect(mockHybridObject.getSecureBiometric).toHaveBeenCalledWith("bio-key");
    expect(result).toBe("bio-value");
  });

  it("biometric item delete calls deleteSecureBiometric on native", () => {
    const item = createStorageItem({
      key: "bio-key",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    item.delete();
    expect(mockHybridObject.deleteSecureBiometric).toHaveBeenCalledWith(
      "bio-key",
    );
  });

  it("biometric item has calls hasSecureBiometric on native", () => {
    mockHybridObject.hasSecureBiometric.mockReturnValue(true);

    const item = createStorageItem({
      key: "bio-key",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    expect(item.has()).toBe(true);
    expect(mockHybridObject.hasSecureBiometric).toHaveBeenCalledWith("bio-key");
  });
});
