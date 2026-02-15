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
  migrateToLatest,
  registerMigration,
  runTransaction,
  storage,
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
    expect(mockHybridObject.remove).not.toHaveBeenCalled();
  });

  it("throws on scope mismatch for getBatch", () => {
    expect(() =>
      getBatch([item1, secureItem], StorageScope.Disk)
    ).toThrow(/Batch scope mismatch/);
    expect(mockHybridObject.getBatch).not.toHaveBeenCalled();
  });

  it("throws on scope mismatch for setBatch", () => {
    expect(() =>
      setBatch(
        [
          { item: item1, value: "v1" },
          { item: secureItem, value: "v2" },
        ],
        StorageScope.Disk
      )
    ).toThrow(/Batch scope mismatch/);
    expect(mockHybridObject.setBatch).not.toHaveBeenCalled();
  });

  it("throws on scope mismatch for removeBatch", () => {
    expect(() =>
      removeBatch([item1, secureItem], StorageScope.Disk)
    ).toThrow(/Batch scope mismatch/);
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
        StorageScope.Memory
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

  it("falls back to item.get() in getBatch if native returns undefined", () => {
    mockHybridObject.getBatch.mockReturnValue([
      undefined,
      JSON.stringify("v2"),
    ]);
    mockHybridObject.get.mockReturnValue(JSON.stringify("v1-fallback"));

    const item1WithFallback = createStorageItem({
      key: "fallback-1",
      scope: StorageScope.Disk,
      defaultValue: "d1",
    });

    const values = getBatch([item1WithFallback, item2], StorageScope.Disk);
    expect(values).toEqual(["v1-fallback", "v2"]);
  });
});

describe("v0.2 features", () => {
  const diskStore = new Map<string, string>();
  let migrationVersionSeed = 1_000;

  beforeEach(() => {
    jest.clearAllMocks();
    diskStore.clear();
    storage.clearAll();

    mockHybridObject.get.mockImplementation((key: string) => diskStore.get(key));
    mockHybridObject.set.mockImplementation((key: string, value: string) => {
      diskStore.set(key, value);
    });
    mockHybridObject.remove.mockImplementation((key: string) => {
      diskStore.delete(key);
    });
  });

  it("supports schema validation and fallback handling", () => {
    const item = createStorageItem<number>({
      key: "validated",
      scope: StorageScope.Disk,
      defaultValue: 0,
      validate: (value): value is number => typeof value === "number" && value >= 0,
      onValidationError: () => 10,
    });

    mockHybridObject.get.mockReturnValueOnce(JSON.stringify(-1));
    expect(item.get()).toBe(10);
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "validated",
      JSON.stringify(10),
      StorageScope.Disk
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
    expect(mockHybridObject.remove).toHaveBeenCalledWith("ttl-key", StorageScope.Disk);
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
      })
    ).toThrow("boom");

    expect(item.get()).toBe("before");
    expect(diskStore.get("another")).toBeUndefined();
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
    expect(diskStore.get("__nitro_storage_migration_version__")).toBe(String(v2));
  });
});

describe("v0.2 edge cases", () => {
  const diskStore = new Map<string, string>();
  let migrationVersionSeed = 5_000;

  beforeEach(() => {
    jest.clearAllMocks();
    diskStore.clear();
    storage.clearAll();

    mockHybridObject.get.mockImplementation((key: string) => diskStore.get(key));
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
      })
    ).toThrow("expiration.ttlMs must be greater than 0.");
  });

  it("falls back to default when invalid stored value has no validation handler", () => {
    const item = createStorageItem<number>({
      key: "invalid-default",
      scope: StorageScope.Disk,
      defaultValue: 7,
      validate: (value): value is number => typeof value === "number" && value > 10,
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
      validate: (value): value is number => typeof value === "number" && value > 10,
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
      "Migration version must be a positive integer."
    );

    const version = migrationVersionSeed++;
    registerMigration(version, () => undefined);
    expect(() => registerMigration(version, () => undefined)).toThrow(
      `Migration version ${version} is already registered.`
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
      })
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
      })
    ).toThrow(/Batch scope mismatch/);
  });
});
