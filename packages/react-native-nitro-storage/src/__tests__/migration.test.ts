import { createStorageItem, StorageScope } from "../index";
import { migrateFromMMKV } from "../migration";

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(),
  },
}));

describe("migrateFromMMKV", () => {
  it("migrates string values from MMKV", () => {
    const mmkv = {
      getString: jest.fn(() => '"test-value"'),
      getNumber: jest.fn(() => undefined),
      getBoolean: jest.fn(() => undefined),
      contains: jest.fn(() => true),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Memory,
      defaultValue: "",
    });

    const result = migrateFromMMKV(mmkv, item);

    expect(result).toBe(true);
    expect(item.get()).toBe("test-value");
    expect(mmkv.delete).not.toHaveBeenCalled();
  });

  it("migrates and deletes from MMKV when deleteFromMMKV is true", () => {
    const mmkv = {
      getString: jest.fn(() => '"value"'),
      getNumber: jest.fn(() => undefined),
      getBoolean: jest.fn(() => undefined),
      contains: jest.fn(() => true),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "test-key",
      scope: StorageScope.Memory,
      defaultValue: "",
    });

    const result = migrateFromMMKV(mmkv, item, true);

    expect(result).toBe(true);
    expect(mmkv.delete).toHaveBeenCalledWith("test-key");
  });

  it("migrates number values from MMKV", () => {
    const mmkv = {
      getString: jest.fn(() => undefined),
      getNumber: jest.fn(() => 42),
      getBoolean: jest.fn(() => undefined),
      contains: jest.fn(() => true),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "num-key",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });

    const result = migrateFromMMKV(mmkv, item);

    expect(result).toBe(true);
    expect(item.get()).toBe(42);
  });

  it("migrates number values and deletes from MMKV", () => {
    const mmkv = {
      getString: jest.fn(() => undefined),
      getNumber: jest.fn(() => 100),
      getBoolean: jest.fn(() => undefined),
      contains: jest.fn(() => true),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "num-key",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });

    const result = migrateFromMMKV(mmkv, item, true);

    expect(result).toBe(true);
    expect(mmkv.delete).toHaveBeenCalledWith("num-key");
  });

  it("migrates boolean values from MMKV", () => {
    const mmkv = {
      getString: jest.fn(() => undefined),
      getNumber: jest.fn(() => undefined),
      getBoolean: jest.fn(() => true),
      contains: jest.fn(() => true),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "bool-key",
      scope: StorageScope.Memory,
      defaultValue: false,
    });

    const result = migrateFromMMKV(mmkv, item);

    expect(result).toBe(true);
    expect(item.get()).toBe(true);
  });

  it("migrates boolean values and deletes from MMKV", () => {
    const mmkv = {
      getString: jest.fn(() => undefined),
      getNumber: jest.fn(() => undefined),
      getBoolean: jest.fn(() => false),
      contains: jest.fn(() => true),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "bool-key",
      scope: StorageScope.Memory,
      defaultValue: true,
    });

    const result = migrateFromMMKV(mmkv, item, true);

    expect(result).toBe(true);
    expect(mmkv.delete).toHaveBeenCalledWith("bool-key");
  });

  it("returns false when key does not exist in MMKV", () => {
    const mmkv = {
      getString: jest.fn(() => undefined),
      getNumber: jest.fn(() => undefined),
      getBoolean: jest.fn(() => undefined),
      contains: jest.fn(() => false),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "missing-key",
      scope: StorageScope.Memory,
      defaultValue: "",
    });

    const result = migrateFromMMKV(mmkv, item);

    expect(result).toBe(false);
    expect(mmkv.getString).not.toHaveBeenCalled();
  });

  it("handles non-JSON string values", () => {
    const mmkv = {
      getString: jest.fn(() => "plain-string"),
      getNumber: jest.fn(() => undefined),
      getBoolean: jest.fn(() => undefined),
      contains: jest.fn(() => true),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "str-key",
      scope: StorageScope.Memory,
      defaultValue: "",
    });

    const result = migrateFromMMKV(mmkv, item);

    expect(result).toBe(true);
    expect(item.get()).toBe("plain-string");
  });

  it("migrates complex JSON objects", () => {
    const obj = { name: "John", age: 30 };
    const mmkv = {
      getString: jest.fn(() => JSON.stringify(obj)),
      getNumber: jest.fn(() => undefined),
      getBoolean: jest.fn(() => undefined),
      contains: jest.fn(() => true),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "obj-key",
      scope: StorageScope.Memory,
      defaultValue: {},
    });

    const result = migrateFromMMKV(mmkv, item);

    expect(result).toBe(true);
    expect(item.get()).toEqual(obj);
  });

  it("returns false when key exists but all values are undefined", () => {
    const mmkv = {
      getString: jest.fn(() => undefined),
      getNumber: jest.fn(() => undefined),
      getBoolean: jest.fn(() => undefined),
      contains: jest.fn(() => true),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "empty-key",
      scope: StorageScope.Memory,
      defaultValue: "",
    });

    const result = migrateFromMMKV(mmkv, item);

    expect(result).toBe(false);
    expect(item.get()).toBe("");
  });
});
