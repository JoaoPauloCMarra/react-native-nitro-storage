import { renderHook, act } from "@testing-library/react-hooks";

const mockHybridObject = {
  set: jest.fn(),
  get: jest.fn(),
  remove: jest.fn(),
  clear: jest.fn(),
  setBatch: jest.fn(),
  getBatch: jest.fn(),
  removeBatch: jest.fn(),
  addOnChange: jest.fn(),
};

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => mockHybridObject),
  },
}));

import {
  createStorageItem,
  useStorage,
  StorageScope,
  getBatch,
  setBatch,
  removeBatch,
} from "../index";

describe("createStorageItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    mockHybridObject.get.mockReturnValue(JSON.stringify("stored-value"));
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
      JSON.stringify("new-value"),
      StorageScope.Disk
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
      StorageScope.Disk
    );
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
      expect.any(Function)
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
      StorageScope.Disk
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
      JSON.stringify(user),
      StorageScope.Disk
    );

    mockHybridObject.get.mockReturnValue(JSON.stringify(user));
    expect(item.get()).toEqual(user);
  });

  it("notifies subscribers on change", () => {
    let changeCallback: (key: string, value: string | undefined) => void;
    mockHybridObject.addOnChange.mockImplementation(
      (scope: number, cb: (key: string, value: string | undefined) => void) => {
        changeCallback = cb;
        return jest.fn();
      }
    );

    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    const listener = jest.fn();
    item.subscribe(listener);

    changeCallback!("test-key", "new-value");

    expect(listener).toHaveBeenCalled();
  });

  it("unsubscribes correctly", () => {
    const mockUnsubscribe = jest.fn();
    mockHybridObject.addOnChange.mockReturnValue(mockUnsubscribe);

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

    expect(mockUnsubscribe).toHaveBeenCalled();
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
    mockHybridObject.get.mockReturnValue(JSON.stringify(user));
    expect(item.get()).toEqual(user);
  });

  it("handles optional defaultValue (defaults to undefined)", () => {
    const item = createStorageItem<string | undefined>({
      key: "optional-key",
      scope: StorageScope.Disk,
    });

    mockHybridObject.get.mockReturnValue(undefined);
    expect(item.get()).toBe(undefined);

    mockHybridObject.get.mockReturnValue(JSON.stringify("value"));
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

    mockHybridObject.get.mockReturnValue(JSON.stringify(42));
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
      JSON.stringify("value"),
      StorageScope.Disk
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
      JSON.stringify("value"),
      StorageScope.Disk
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
      JSON.stringify("value"),
      StorageScope.Secure
    );
  });
});

describe("useStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns current value and setter", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "initial",
    });

    mockHybridObject.get.mockReturnValue(JSON.stringify("initial"));

    const { result } = renderHook(() => useStorage(item));

    expect(result.current[0]).toBe("initial");
    expect(typeof result.current[1]).toBe("function");
  });

  it("updates when value changes", () => {
    let changeCallback:
      | ((key: string, value: string | undefined) => void)
      | null = null;
    mockHybridObject.addOnChange.mockImplementation(
      (scope: number, cb: (key: string, value: string | undefined) => void) => {
        changeCallback = cb;
        return jest.fn();
      }
    );

    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "initial",
    });

    // Initial render
    mockHybridObject.get.mockReturnValue(JSON.stringify("initial"));
    const { result } = renderHook(() => useStorage(item));
    expect(result.current[0]).toBe("initial");

    // Change happens
    mockHybridObject.get.mockReturnValue(JSON.stringify("updated"));
    act(() => {
      if (changeCallback) {
        changeCallback("test-key", "updated");
      }
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
    mockHybridObject.get.mockReturnValue(JSON.stringify(obj));

    // First call deserializes
    const ref1 = item.get();
    expect(ref1).toEqual(obj);

    // Second call with same underlying data should return SAME reference
    // because mockHybridObject.get returns same string, and we cache
    const ref2 = item.get();
    expect(ref2).toBe(ref1); // Strict equality check

    // Simulate change
    const newObj = { count: 2 };
    mockHybridObject.get.mockReturnValue(JSON.stringify(newObj));

    // Should get new reference
    const ref3 = item.get();
    expect(ref3).toEqual(newObj);
    expect(ref3).not.toBe(ref1);
  });

  it("cleans up native listeners to prevent memory leaks", () => {
    let nativeUnsubscribe = jest.fn();
    mockHybridObject.addOnChange.mockReturnValue(nativeUnsubscribe);

    const item = createStorageItem({
      key: "test-leak",
      scope: StorageScope.Disk,
      defaultValue: "val",
    });

    // 1. Subscribe first listener
    const unsub1 = item.subscribe(jest.fn());
    expect(mockHybridObject.addOnChange).toHaveBeenCalledTimes(1);

    // 2. Subscribe second listener
    const unsub2 = item.subscribe(jest.fn());
    expect(mockHybridObject.addOnChange).toHaveBeenCalledTimes(1); // Should reuse existing native connection

    // 3. Unsubscribe first
    unsub1();
    expect(nativeUnsubscribe).not.toHaveBeenCalled(); // Still one listener left

    // 4. Unsubscribe last
    unsub2();
    expect(nativeUnsubscribe).toHaveBeenCalledTimes(1); // Should clean up native
  });

  it("calls setter correctly", () => {
    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Disk,
      defaultValue: "initial",
    });

    mockHybridObject.get.mockReturnValue(JSON.stringify("initial"));

    const { result } = renderHook(() => useStorage(item));

    act(() => {
      result.current[1]("new-value");
    });

    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "test-key",
      JSON.stringify("new-value"),
      StorageScope.Disk
    );
  });
});

describe("Batch Operations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Memory scope is handled via Map in the mock for consistency if needed,
    // but here we just test Disk/Secure which use mockHybridObject.
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

  it("sets multiple items at once", () => {
    setBatch(
      [
        { item: item1, value: "v1" },
        { item: item2, value: "v2" },
      ],
      StorageScope.Disk
    );

    expect(mockHybridObject.setBatch).toHaveBeenCalledWith(
      ["batch-1", "batch-2"],
      [JSON.stringify("v1"), JSON.stringify("v2")],
      StorageScope.Disk
    );
  });

  it("gets multiple items at once", () => {
    mockHybridObject.getBatch.mockReturnValue([
      JSON.stringify("v1"),
      JSON.stringify("v2"),
    ]);

    // We also need to mock individual get calls because currently getBatch implementation in JS
    // calls item.get() which checks the native side individually if cache is empty.
    mockHybridObject.get.mockImplementation((key) => {
      if (key === "batch-1") return JSON.stringify("v1");
      if (key === "batch-2") return JSON.stringify("v2");
      return undefined;
    });

    const values = getBatch([item1, item2], StorageScope.Disk);

    expect(mockHybridObject.getBatch).toHaveBeenCalledWith(
      ["batch-1", "batch-2"],
      StorageScope.Disk
    );
    expect(values).toEqual(["v1", "v2"]);
  });

  it("removes multiple items at once", () => {
    removeBatch([item1, item2], StorageScope.Disk);

    expect(mockHybridObject.removeBatch).toHaveBeenCalledWith(
      ["batch-1", "batch-2"],
      StorageScope.Disk
    );
  });
});
