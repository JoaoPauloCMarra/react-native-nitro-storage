import { renderHook, act } from "@testing-library/react-hooks";
import {
  createStorageItem,
  useStorage,
  useSetStorage,
  storage,
  StorageScope,
} from "../index";

// Mock NitroModules to prevent native module resolution errors
jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => ({
      clear: jest.fn(),
      clearSecureBiometric: jest.fn(),
      set: jest.fn(),
      get: jest.fn(),
      remove: jest.fn(),
      has: jest.fn(),
      getAllKeys: jest.fn(() => []),
      size: jest.fn(() => 0),
      setBatch: jest.fn(),
      getBatch: jest.fn(),
      removeBatch: jest.fn(),
      addOnChange: jest.fn(() => () => {}),
      setSecureAccessControl: jest.fn(),
      setKeychainAccessGroup: jest.fn(),
      setSecureBiometric: jest.fn(),
      getSecureBiometric: jest.fn(),
      deleteSecureBiometric: jest.fn(),
      hasSecureBiometric: jest.fn(),
    })),
  },
}));

describe("Pure JS Memory Storage", () => {
  beforeEach(() => {
    storage.clearAll();
  });

  it("stores and retrieves basic values", () => {
    const item = createStorageItem({
      key: "test-basic",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });

    expect(item.get()).toBe(0);
    item.set(42);
    expect(item.get()).toBe(42);
  });

  it("stores and retrieves complex objects (references)", () => {
    const item = createStorageItem<Record<string, string>>({
      key: "test-obj",
      scope: StorageScope.Memory,
      defaultValue: {},
    });

    const obj = { foo: "bar" };
    item.set(obj);
    expect(item.get()).toBe(obj);
  });

  it("stores functions", () => {
    const item = createStorageItem<() => string>({
      key: "test-func",
      scope: StorageScope.Memory,
      defaultValue: () => "default",
    });

    const myFunc = () => "hello";
    // When storing a function and functional updates are supported,
    // we must pass a function that returns the function.
    item.set(() => myFunc);
    expect(item.get()).toBe(myFunc);
    expect(item.get()()).toBe("hello");
  });

  it("supports functional updates", () => {
    const item = createStorageItem({
      key: "test-func-update",
      scope: StorageScope.Memory,
      defaultValue: 10,
    });

    item.set((prev) => prev + 5);
    expect(item.get()).toBe(15);

    item.set((prev) => prev * 2);
    expect(item.get()).toBe(30);
  });

  it("notifies subscribers", () => {
    const item = createStorageItem({
      key: "test-sub",
      scope: StorageScope.Memory,
      defaultValue: "a",
    });

    const listener = jest.fn();
    const unsub = item.subscribe(listener);

    item.set("b");
    expect(listener).toHaveBeenCalledTimes(1);

    item.set((prev) => prev + "c");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(item.get()).toBe("bc");

    unsub();
  });

  it("clearAll clears memory items", () => {
    const item1 = createStorageItem({
      key: "k1",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });
    const item2 = createStorageItem({
      key: "k2",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });

    item1.set(10);
    item2.set(20);

    expect(item1.get()).toBe(10);
    expect(item2.get()).toBe(20);

    storage.clearAll();

    expect(item1.get()).toBe(0); // Back to default
    expect(item2.get()).toBe(0);
  });

  it("clearAll notifies memory item subscribers", () => {
    const item = createStorageItem({
      key: "clear-notify",
      scope: StorageScope.Memory,
      defaultValue: "default",
    });

    item.set("value");
    const listener = jest.fn();
    item.subscribe(listener);

    storage.clearAll();

    expect(item.get()).toBe("default");
    expect(listener).toHaveBeenCalled();
  });

  it("useStorage hook works with memory", () => {
    const item = createStorageItem({
      key: "hook-test",
      scope: StorageScope.Memory,
      defaultValue: "init",
    });

    const { result } = renderHook(() => useStorage(item));

    expect(result.current[0]).toBe("init");

    act(() => {
      // Functional update via hook
      result.current[1]((prev) => prev + "-updated");
    });

    expect(result.current[0]).toBe("init-updated");
    expect(item.get()).toBe("init-updated");
  });

  it("useSetStorage returns setter only", () => {
    const item = createStorageItem({
      key: "setter-test",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });

    const { result } = renderHook(() => useSetStorage(item));
    const setStorage = result.current;

    act(() => {
      setStorage(100);
    });

    expect(item.get()).toBe(100);
  });

  it("deletes memory items and notifies subscribers", () => {
    const item = createStorageItem({
      key: "delete-test",
      scope: StorageScope.Memory,
      defaultValue: "default",
    });

    item.set("value");
    expect(item.get()).toBe("value");

    const listener = jest.fn();
    item.subscribe(listener);

    item.delete();
    expect(item.get()).toBe("default");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
