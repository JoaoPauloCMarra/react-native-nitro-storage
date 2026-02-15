import { act, renderHook } from "@testing-library/react-hooks";
import {
  createStorageItem,
  getBatch,
  migrateFromMMKV,
  migrateToLatest,
  registerMigration,
  removeBatch,
  runTransaction,
  setBatch,
  storage,
  StorageScope,
  useSetStorage,
  useStorageSelector,
  useStorage,
} from "../index.web";
import { serializeWithPrimitiveFastPath } from "../internal";

function createStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("Web Storage", () => {
  let migrationVersionSeed = 2_000;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createStorageMock(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: createStorageMock(),
      configurable: true,
      writable: true,
    });
    storage.clearAll();
  });

  it("stores and retrieves disk values", () => {
    const diskItem = createStorageItem({
      key: "disk-key",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });
    const setSpy = jest.spyOn(globalThis.localStorage, "setItem");

    diskItem.set("value");

    expect(diskItem.get()).toBe("value");
    expect(setSpy).toHaveBeenCalledWith(
      "disk-key",
      serializeWithPrimitiveFastPath("value")
    );
  });

  it("stores and retrieves secure values", () => {
    const secureItem = createStorageItem({
      key: "secure-key",
      scope: StorageScope.Secure,
      defaultValue: "default",
    });
    const setSpy = jest.spyOn(globalThis.sessionStorage, "setItem");

    secureItem.set("value");

    expect(secureItem.get()).toBe("value");
    expect(setSpy).toHaveBeenCalledWith(
      "secure-key",
      serializeWithPrimitiveFastPath("value")
    );
  });

  it("clears disk and secure scopes", () => {
    const diskItem = createStorageItem({
      key: "disk-clear",
      scope: StorageScope.Disk,
      defaultValue: "disk-default",
    });
    const secureItem = createStorageItem({
      key: "secure-clear",
      scope: StorageScope.Secure,
      defaultValue: "secure-default",
    });
    const diskClearSpy = jest.spyOn(globalThis.localStorage, "clear");
    const secureClearSpy = jest.spyOn(globalThis.sessionStorage, "clear");

    diskItem.set("disk-value");
    secureItem.set("secure-value");

    storage.clear(StorageScope.Disk);
    storage.clear(StorageScope.Secure);

    expect(diskItem.get()).toBe("disk-default");
    expect(secureItem.get()).toBe("secure-default");
    expect(diskClearSpy).toHaveBeenCalledTimes(1);
    expect(secureClearSpy).toHaveBeenCalledTimes(1);
  });

  it("notifies memory subscribers when clearAll runs", () => {
    const memoryItem = createStorageItem({
      key: "mem-key",
      scope: StorageScope.Memory,
      defaultValue: "default",
    });

    const listener = jest.fn();
    memoryItem.subscribe(listener);
    memoryItem.set("value");
    listener.mockClear();

    storage.clearAll();

    expect(memoryItem.get()).toBe("default");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("supports useStorage and useSetStorage hooks", () => {
    const item = createStorageItem({
      key: "hook-key",
      scope: StorageScope.Disk,
      defaultValue: 0,
    });

    const storageHook = renderHook(() => useStorage(item));
    const setOnlyHook = renderHook(() => useSetStorage(item));

    expect(storageHook.result.current[0]).toBe(0);

    act(() => {
      storageHook.result.current[1]((prev) => prev + 1);
      setOnlyHook.result.current((prev) => prev + 1);
    });

    expect(storageHook.result.current[0]).toBe(2);
    expect(item.get()).toBe(2);
  });

  it("supports useStorageSelector and comparator-based rerender control", () => {
    const item = createStorageItem({
      key: "web-selector",
      scope: StorageScope.Memory,
      defaultValue: { count: 0, label: "a" },
    });

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useStorageSelector(
        item,
        (value) => ({ count: value.count }),
        (prev, next) => prev.count === next.count
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

  it("supports read-through cache when enabled on web disk scope", () => {
    const getSpy = jest.spyOn(globalThis.localStorage, "getItem");
    globalThis.localStorage.setItem(
      "web-cache-default",
      serializeWithPrimitiveFastPath("cached")
    );

    const item = createStorageItem({
      key: "web-cache-default",
      scope: StorageScope.Disk,
      defaultValue: "default",
      readCache: true,
    });

    expect(item.get()).toBe("cached");
    expect(item.get()).toBe("cached");
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps read-through cache disabled by default on web items", () => {
    const getSpy = jest.spyOn(globalThis.localStorage, "getItem");
    globalThis.localStorage.setItem(
      "web-cache-disabled",
      serializeWithPrimitiveFastPath("cached")
    );

    const item = createStorageItem({
      key: "web-cache-disabled",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    expect(item.get()).toBe("cached");
    expect(item.get()).toBe("cached");
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it("coalesces secure writes on the same tick when enabled", async () => {
    const setSpy = jest.spyOn(globalThis.sessionStorage, "setItem");
    const item = createStorageItem({
      key: "web-secure-coalesce",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
    });

    item.set("first");
    item.set("second");
    expect(setSpy).toHaveBeenCalledTimes(0);

    await Promise.resolve();

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(globalThis.sessionStorage.getItem("web-secure-coalesce")).toBe(
      serializeWithPrimitiveFastPath("second")
    );
  });

  it("runs batch operations for disk scope", () => {
    const item1 = createStorageItem({
      key: "batch-1",
      scope: StorageScope.Disk,
      defaultValue: "a",
    });
    const item2 = createStorageItem({
      key: "batch-2",
      scope: StorageScope.Disk,
      defaultValue: "b",
    });
    const removeSpy = jest.spyOn(globalThis.localStorage, "removeItem");

    setBatch(
      [
        { item: item1, value: "v1" },
        { item: item2, value: "v2" },
      ],
      StorageScope.Disk
    );

    const values = getBatch([item1, item2], StorageScope.Disk);
    expect(values).toEqual(["v1", "v2"]);

    removeBatch([item1, item2], StorageScope.Disk);
    expect(removeSpy).toHaveBeenCalledTimes(2);
  });

  it("throws for mixed scope batch operations", () => {
    const diskItem = createStorageItem({
      key: "batch-disk",
      scope: StorageScope.Disk,
      defaultValue: "d",
    });
    const secureItem = createStorageItem({
      key: "batch-secure",
      scope: StorageScope.Secure,
      defaultValue: "s",
    });

    expect(() =>
      getBatch([diskItem, secureItem], StorageScope.Disk)
    ).toThrow(/Batch scope mismatch/);
    expect(() =>
      setBatch(
        [
          { item: diskItem, value: "v1" },
          { item: secureItem, value: "v2" },
        ],
        StorageScope.Disk
      )
    ).toThrow(/Batch scope mismatch/);
    expect(() =>
      removeBatch([diskItem, secureItem], StorageScope.Disk)
    ).toThrow(/Batch scope mismatch/);
  });

  it("uses per-item set path for validated items in batch set", () => {
    const validatedItem = createStorageItem<number>({
      key: "batch-web-validated-set",
      scope: StorageScope.Disk,
      defaultValue: 1,
      validate: (value): value is number => typeof value === "number" && value > 0,
    });

    expect(() =>
      setBatch([{ item: validatedItem, value: -1 }], StorageScope.Disk)
    ).toThrow(/Validation failed/);
  });

  it("uses per-item get path for validated items in batch get", () => {
    const validatedItem = createStorageItem<number>({
      key: "batch-web-validated-get",
      scope: StorageScope.Disk,
      defaultValue: 7,
      validate: (value): value is number => typeof value === "number" && value > 10,
    });

    globalThis.localStorage.setItem("batch-web-validated-get", JSON.stringify(2));
    expect(getBatch([validatedItem], StorageScope.Disk)).toEqual([7]);
  });

  it("exports and runs MMKV migration from the root entrypoint", () => {
    const mmkv = {
      getString: jest.fn(() => JSON.stringify("migrated")),
      getNumber: jest.fn(() => undefined),
      getBoolean: jest.fn(() => undefined),
      contains: jest.fn(() => true),
      delete: jest.fn(),
      getAllKeys: jest.fn(() => []),
    };

    const item = createStorageItem({
      key: "migrate-key",
      scope: StorageScope.Memory,
      defaultValue: "default",
    });

    const migrated = migrateFromMMKV(mmkv, item, true);

    expect(migrated).toBe(true);
    expect(item.get()).toBe("migrated");
    expect(mmkv.delete).toHaveBeenCalledWith("migrate-key");
  });

  it("supports schema validation and fallback handling", () => {
    const item = createStorageItem<number>({
      key: "validated",
      scope: StorageScope.Disk,
      defaultValue: 0,
      validate: (value): value is number => typeof value === "number" && value >= 0,
      onValidationError: () => 10,
    });

    globalThis.localStorage.setItem("validated", JSON.stringify(-1));
    expect(item.get()).toBe(10);
    expect(globalThis.localStorage.getItem("validated")).toBe(
      serializeWithPrimitiveFastPath(10)
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
    expect(globalThis.localStorage.getItem("ttl-key")).toBeNull();
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
    expect(globalThis.localStorage.getItem("another")).toBeNull();
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
    expect(globalThis.localStorage.getItem("migrated-a")).toBe(JSON.stringify("a"));
    expect(globalThis.localStorage.getItem("migrated-b")).toBe(JSON.stringify("b"));
    expect(globalThis.localStorage.getItem("__nitro_storage_migration_version__")).toBe(
      String(v2)
    );
  });

  it("throws on invalid scope for transaction and migration APIs", () => {
    expect(() =>
      runTransaction(99 as StorageScope, () => undefined)
    ).toThrow(/Invalid storage scope/);
    expect(() => migrateToLatest(99 as StorageScope)).toThrow(/Invalid storage scope/);
  });

  it("handles memory-scope batch operations", () => {
    const mem1 = createStorageItem({
      key: "mem-batch-1",
      scope: StorageScope.Memory,
      defaultValue: "m1",
    });
    const mem2 = createStorageItem({
      key: "mem-batch-2",
      scope: StorageScope.Memory,
      defaultValue: "m2",
    });

    setBatch(
      [
        { item: mem1, value: "v1" },
        { item: mem2, value: "v2" },
      ],
      StorageScope.Memory
    );
    expect(getBatch([mem1, mem2], StorageScope.Memory)).toEqual(["v1", "v2"]);

    removeBatch([mem1, mem2], StorageScope.Memory);
    expect(mem1.get()).toBe("m1");
    expect(mem2.get()).toBe("m2");
  });

  it("throws for non-positive ttl", () => {
    expect(() =>
      createStorageItem({
        key: "bad-ttl-web",
        scope: StorageScope.Disk,
        expiration: { ttlMs: -1 },
      })
    ).toThrow("expiration.ttlMs must be greater than 0.");
  });

  it("falls back to default when invalid value has no validation handler", () => {
    const item = createStorageItem<number>({
      key: "invalid-web",
      scope: StorageScope.Disk,
      defaultValue: 3,
      validate: (value): value is number => typeof value === "number" && value > 10,
    });

    globalThis.localStorage.setItem("invalid-web", JSON.stringify(1));
    expect(item.get()).toBe(3);
    expect(globalThis.localStorage.getItem("invalid-web")).toBe(JSON.stringify(1));
  });

  it("falls back to default when validation handler returns invalid value", () => {
    const item = createStorageItem<number>({
      key: "invalid-handler-web",
      scope: StorageScope.Disk,
      defaultValue: 4,
      validate: (value): value is number => typeof value === "number" && value > 10,
      onValidationError: () => 1,
    });

    globalThis.localStorage.setItem("invalid-handler-web", JSON.stringify(2));
    expect(item.get()).toBe(4);
  });

  it("supports ttl items with legacy non-envelope payloads", () => {
    const item = createStorageItem<string>({
      key: "legacy-web",
      scope: StorageScope.Disk,
      defaultValue: "default",
      expiration: { ttlMs: 100 },
    });

    globalThis.localStorage.setItem("legacy-web", JSON.stringify("legacy"));
    expect(item.get()).toBe("legacy");
  });

  it("handles secure subscriptions and cleanup", () => {
    const secureItem = createStorageItem({
      key: "secure-sub",
      scope: StorageScope.Secure,
      defaultValue: "default",
    });
    const listener = jest.fn();

    const unsubscribe = secureItem.subscribe(listener);
    secureItem.set("next");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("runs transaction helpers for getRaw/removeRaw/getItem/removeItem", () => {
    const item = createStorageItem({
      key: "tx-web",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });
    const secureItem = createStorageItem({
      key: "tx-web-secure",
      scope: StorageScope.Secure,
      defaultValue: "default",
    });
    item.set("value");

    runTransaction(StorageScope.Disk, (tx) => {
      expect(tx.getRaw("tx-web")).toBe(serializeWithPrimitiveFastPath("value"));
      expect(tx.getItem(item)).toBe("value");
      tx.removeItem(item);
      tx.removeRaw("missing");
    });
    expect(item.get()).toBe("default");

    expect(() =>
      runTransaction(StorageScope.Disk, (tx) => {
        tx.getItem(secureItem);
      })
    ).toThrow(/Batch scope mismatch/);
  });

  it("uses item.set semantics in transactions for ttl items", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(20_000);
    const ttlItem = createStorageItem<string>({
      key: "tx-web-ttl",
      scope: StorageScope.Disk,
      defaultValue: "default",
      expiration: { ttlMs: 100 },
    });

    runTransaction(StorageScope.Disk, (tx) => {
      tx.setItem(ttlItem, "value");
    });

    const raw = globalThis.localStorage.getItem("tx-web-ttl");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({
      __nitroStorageEnvelope: true,
      expiresAt: 20_100,
      payload: serializeWithPrimitiveFastPath("value"),
    });
    nowSpy.mockRestore();
  });

  it("uses item.set validation semantics in memory transactions", () => {
    const validatedMemoryItem = createStorageItem<string>({
      key: "tx-web-memory-validated",
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
      })
    ).toThrow(/Validation failed/);
  });

  it("runs memory migration context and persists memory migration version", () => {
    const version = migrationVersionSeed++;
    registerMigration(version, ({ setRaw, getRaw, removeRaw }) => {
      setRaw("mem-migrated", JSON.stringify("x"));
      expect(getRaw("mem-migrated")).toBe(JSON.stringify("x"));
      removeRaw("mem-migrated");
      expect(getRaw("mem-migrated")).toBeUndefined();
    });

    expect(migrateToLatest(StorageScope.Memory)).toBe(version);
  });
});
