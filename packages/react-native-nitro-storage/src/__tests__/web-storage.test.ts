import { act, renderHook } from "@testing-library/react-hooks";
import {
  createStorageItem,
  createSecureAuthStorage,
  getBatch,
  migrateFromMMKV,
  migrateToLatest,
  registerMigration,
  removeBatch,
  runTransaction,
  setBatch,
  storage,
  StorageScope,
  AccessControl,
  useSetStorage,
  useStorageSelector,
  useStorage,
} from "../index.web";
import type { StorageItem } from "../index.web";
import {
  MIGRATION_VERSION_KEY,
  serializeWithPrimitiveFastPath,
} from "../internal";

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
      serializeWithPrimitiveFastPath("value"),
    );
  });

  it("stores and retrieves secure values", () => {
    const secureItem = createStorageItem({
      key: "secure-key",
      scope: StorageScope.Secure,
      defaultValue: "default",
    });
    const setSpy = jest.spyOn(globalThis.localStorage, "setItem");

    secureItem.set("value");

    expect(secureItem.get()).toBe("value");
    expect(setSpy).toHaveBeenCalledWith(
      "__secure_secure-key",
      serializeWithPrimitiveFastPath("value"),
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
    diskItem.set("disk-value");
    secureItem.set("secure-value");

    expect(globalThis.localStorage.getItem("disk-clear")).toBe(
      serializeWithPrimitiveFastPath("disk-value"),
    );
    expect(globalThis.localStorage.getItem("__secure_secure-clear")).toBe(
      serializeWithPrimitiveFastPath("secure-value"),
    );

    storage.clear(StorageScope.Disk);
    expect(globalThis.localStorage.getItem("disk-clear")).toBeNull();
    expect(globalThis.localStorage.getItem("__secure_secure-clear")).toBe(
      serializeWithPrimitiveFastPath("secure-value"),
    );

    storage.clear(StorageScope.Secure);
    expect(globalThis.localStorage.getItem("__secure_secure-clear")).toBeNull();

    expect(diskItem.get()).toBe("disk-default");
    expect(secureItem.get()).toBe("secure-default");
  });

  it("clearAll removes biometric secure values", () => {
    const biometric = createStorageItem({
      key: "clear-all-bio",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });
    biometric.set("secret");
    expect(globalThis.localStorage.getItem("__bio_clear-all-bio")).toBe(
      serializeWithPrimitiveFastPath("secret"),
    );

    storage.clearAll();
    expect(globalThis.localStorage.getItem("__bio_clear-all-bio")).toBeNull();
    expect(biometric.get()).toBe("");
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

  it("supports read-through cache when enabled on web disk scope", () => {
    const getSpy = jest.spyOn(globalThis.localStorage, "getItem");
    globalThis.localStorage.setItem(
      "web-cache-default",
      serializeWithPrimitiveFastPath("cached"),
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
      serializeWithPrimitiveFastPath("cached"),
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
    const setSpy = jest.spyOn(globalThis.localStorage, "setItem");
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
    expect(
      globalThis.localStorage.getItem("__secure_web-secure-coalesce"),
    ).toBe(serializeWithPrimitiveFastPath("second"));
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
      StorageScope.Disk,
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

    expect(() => getBatch([diskItem, secureItem], StorageScope.Disk)).toThrow(
      /Batch scope mismatch/,
    );
    expect(() =>
      setBatch(
        [
          { item: diskItem, value: "v1" },
          { item: secureItem, value: "v2" },
        ],
        StorageScope.Disk,
      ),
    ).toThrow(/Batch scope mismatch/);
    expect(() =>
      removeBatch([diskItem, secureItem], StorageScope.Disk),
    ).toThrow(/Batch scope mismatch/);
  });

  it("uses per-item set path for validated items in batch set", () => {
    const validatedItem = createStorageItem<number>({
      key: "batch-web-validated-set",
      scope: StorageScope.Disk,
      defaultValue: 1,
      validate: (value): value is number =>
        typeof value === "number" && value > 0,
    });

    expect(() =>
      setBatch([{ item: validatedItem, value: -1 }], StorageScope.Disk),
    ).toThrow(/Validation failed/);
  });

  it("uses per-item get path for validated items in batch get", () => {
    const validatedItem = createStorageItem<number>({
      key: "batch-web-validated-get",
      scope: StorageScope.Disk,
      defaultValue: 7,
      validate: (value): value is number =>
        typeof value === "number" && value > 10,
    });

    globalThis.localStorage.setItem(
      "batch-web-validated-get",
      JSON.stringify(2),
    );
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
      validate: (value): value is number =>
        typeof value === "number" && value >= 0,
      onValidationError: () => 10,
    });

    globalThis.localStorage.setItem("validated", JSON.stringify(-1));
    expect(item.get()).toBe(10);
    expect(globalThis.localStorage.getItem("validated")).toBe(
      serializeWithPrimitiveFastPath(10),
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
      }),
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
    expect(globalThis.localStorage.getItem("migrated-a")).toBe(
      JSON.stringify("a"),
    );
    expect(globalThis.localStorage.getItem("migrated-b")).toBe(
      JSON.stringify("b"),
    );
    expect(
      globalThis.localStorage.getItem("__nitro_storage_migration_version__"),
    ).toBe(String(v2));
  });

  it("throws on invalid scope for transaction and migration APIs", () => {
    expect(() => runTransaction(99 as StorageScope, () => undefined)).toThrow(
      /Invalid storage scope/,
    );
    expect(() => migrateToLatest(99 as StorageScope)).toThrow(
      /Invalid storage scope/,
    );
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
      StorageScope.Memory,
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
      }),
    ).toThrow("expiration.ttlMs must be greater than 0.");
  });

  it("falls back to default when invalid value has no validation handler", () => {
    const item = createStorageItem<number>({
      key: "invalid-web",
      scope: StorageScope.Disk,
      defaultValue: 3,
      validate: (value): value is number =>
        typeof value === "number" && value > 10,
    });

    globalThis.localStorage.setItem("invalid-web", JSON.stringify(1));
    expect(item.get()).toBe(3);
    expect(globalThis.localStorage.getItem("invalid-web")).toBe(
      JSON.stringify(1),
    );
  });

  it("falls back to default when validation handler returns invalid value", () => {
    const item = createStorageItem<number>({
      key: "invalid-handler-web",
      scope: StorageScope.Disk,
      defaultValue: 4,
      validate: (value): value is number =>
        typeof value === "number" && value > 10,
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
      }),
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
      }),
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

  it("reads pending secure values before coalesced writes flush", async () => {
    const item = createStorageItem({
      key: "pending-secure-read",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
    });

    item.set("queued");
    expect(item.get()).toBe("queued");

    await Promise.resolve();
    expect(
      globalThis.localStorage.getItem("__secure_pending-secure-read"),
    ).toBe(serializeWithPrimitiveFastPath("queued"));
  });

  it("keeps direct and coalesced secure write paths independent", async () => {
    const coalesced = createStorageItem({
      key: "queued-secure",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
    });
    const direct = createStorageItem({
      key: "direct-secure",
      scope: StorageScope.Secure,
      defaultValue: "default",
    });
    const setSpy = jest.spyOn(globalThis.localStorage, "setItem");
    const removeSpy = jest.spyOn(globalThis.localStorage, "removeItem");

    coalesced.set("queued-1");
    direct.set("direct-1");
    coalesced.delete();
    direct.delete();

    expect(setSpy).toHaveBeenCalledWith(
      "__secure_direct-secure",
      serializeWithPrimitiveFastPath("direct-1"),
    );
    expect(removeSpy).toHaveBeenCalledWith("__secure_direct-secure");

    await Promise.resolve();
    expect(removeSpy).toHaveBeenCalledWith("__secure_queued-secure");
  });

  it("handles memory TTL expiration and delete cleanup", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const listener = jest.fn();
    const item = createStorageItem<string>({
      key: "memory-ttl-web",
      scope: StorageScope.Memory,
      defaultValue: "fallback",
      expiration: { ttlMs: 10 },
    });

    item.subscribe(listener);
    item.set("live");
    expect(item.get()).toBe("live");

    nowSpy.mockReturnValue(1_020);
    expect(item.get()).toBe("fallback");

    item.set("second");
    item.delete();
    expect(item.get()).toBe("fallback");
    expect(listener).toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it("uses cache and pending secure paths in batch reads", async () => {
    const diskGetSpy = jest.spyOn(globalThis.localStorage, "getItem");
    const cachedDisk = createStorageItem({
      key: "disk-batch-cache",
      scope: StorageScope.Disk,
      defaultValue: "default",
      readCache: true,
    });
    cachedDisk.set("cached-value");
    diskGetSpy.mockClear();

    expect(getBatch([cachedDisk], StorageScope.Disk)).toEqual(["cached-value"]);
    expect(diskGetSpy).toHaveBeenCalledTimes(0);

    const pendingSecure = createStorageItem({
      key: "secure-batch-pending",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
    });
    pendingSecure.set("queued-secure-value");
    expect(getBatch([pendingSecure], StorageScope.Secure)).toEqual([
      "queued-secure-value",
    ]);

    await Promise.resolve();
  });

  it("falls back to item.get in web getBatch when raw value is missing", () => {
    const item = createStorageItem({
      key: "web-batch-fallback",
      scope: StorageScope.Disk,
      defaultValue: "fallback",
    });

    expect(getBatch([item], StorageScope.Disk)).toEqual(["fallback"]);
  });

  it("uses per-item fallback path for non-raw batch set items", () => {
    const validatedItem = createStorageItem<number>({
      key: "batch-web-fallback-valid",
      scope: StorageScope.Disk,
      defaultValue: 1,
      validate: (value): value is number =>
        typeof value === "number" && value > 0,
    });

    setBatch([{ item: validatedItem, value: 9 }], StorageScope.Disk);
    expect(validatedItem.get()).toBe(9);
  });

  it("handles missing browser storage in web batch operations", () => {
    const originalLocalStorage = globalThis.localStorage;
    try {
      Object.defineProperty(globalThis, "localStorage", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const item = createStorageItem({
        key: "missing-storage-batch",
        scope: StorageScope.Disk,
        defaultValue: "default",
      });

      expect(() =>
        setBatch([{ item, value: "next" }], StorageScope.Disk),
      ).not.toThrow();
      expect(() => removeBatch([item], StorageScope.Disk)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: originalLocalStorage,
        configurable: true,
        writable: true,
      });
    }
  });

  it("flushes pending secure writes for secure batch set/remove", () => {
    const coalesced = createStorageItem({
      key: "secure-batch-coalesced",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
    });
    const secureBatchItem = createStorageItem({
      key: "secure-batch-item",
      scope: StorageScope.Secure,
      defaultValue: "default",
    });

    coalesced.set("queued-before-batch");
    setBatch(
      [{ item: secureBatchItem, value: "batched" }],
      StorageScope.Secure,
    );
    expect(secureBatchItem.get()).toBe("batched");

    coalesced.set("queued-before-remove");
    removeBatch([secureBatchItem], StorageScope.Secure);
    expect(secureBatchItem.get()).toBe("default");
  });

  it("validates migration registration version rules", () => {
    expect(() => registerMigration(0, () => undefined)).toThrow(
      /positive integer/,
    );

    const version = migrationVersionSeed++;
    registerMigration(version, () => undefined);
    expect(() => registerMigration(version, () => undefined)).toThrow(
      /already registered/,
    );
  });

  it("treats invalid stored migration versions as zero", () => {
    const version = migrationVersionSeed++;
    registerMigration(version, () => undefined);
    globalThis.localStorage.setItem(MIGRATION_VERSION_KEY, "not-a-number");

    expect(migrateToLatest(StorageScope.Disk)).toBe(version);
  });

  it("flushes secure queue in transactions and records rollback once per key", () => {
    const queued = createStorageItem({
      key: "secure-tx-queued",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
    });
    const item = createStorageItem({
      key: "secure-tx-key",
      scope: StorageScope.Secure,
      defaultValue: "default",
    });

    queued.set("pending");

    runTransaction(StorageScope.Secure, (tx) => {
      tx.setRaw("secure-tx-key", serializeWithPrimitiveFastPath("first"));
      tx.setRaw("secure-tx-key", serializeWithPrimitiveFastPath("second"));
      tx.setItem(item, "committed");
    });

    expect(item.get()).toBe("committed");
  });

  it("notifies listeners when _triggerListeners is called", () => {
    const item = createStorageItem({
      key: "manual-trigger-web",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });
    const listenerA = jest.fn();
    const listenerB = jest.fn();

    item.subscribe(listenerA);
    item.subscribe(listenerB);
    // _triggerListeners is internal-only, cast to access it
    (item as unknown as { _triggerListeners: () => void })._triggerListeners();

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  // --- Namespace ---

  it("prefixes key with namespace when provided", () => {
    const item = createStorageItem({
      key: "token",
      scope: StorageScope.Disk,
      defaultValue: "none",
      namespace: "auth",
    });

    item.set("abc123");
    expect(item.key).toBe("auth:token");
    expect(globalThis.localStorage.getItem("auth:token")).toBe(
      serializeWithPrimitiveFastPath("abc123"),
    );
    expect(item.get()).toBe("abc123");
  });

  it("works without namespace (no prefix)", () => {
    const item = createStorageItem({
      key: "plain",
      scope: StorageScope.Disk,
      defaultValue: "x",
    });

    item.set("val");
    expect(item.key).toBe("plain");
    expect(globalThis.localStorage.getItem("plain")).toBe(
      serializeWithPrimitiveFastPath("val"),
    );
  });

  it("namespaced items are independent from non-namespaced", () => {
    const namespaced = createStorageItem({
      key: "id",
      scope: StorageScope.Disk,
      defaultValue: "",
      namespace: "user",
    });
    const plain = createStorageItem({
      key: "id",
      scope: StorageScope.Disk,
      defaultValue: "",
    });

    namespaced.set("ns-val");
    plain.set("plain-val");

    expect(namespaced.get()).toBe("ns-val");
    expect(plain.get()).toBe("plain-val");
    expect(namespaced.key).toBe("user:id");
    expect(plain.key).toBe("id");
  });

  // --- has() ---

  it("has() returns false for missing key, true after set", () => {
    const item = createStorageItem({
      key: "has-test",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    expect(item.has()).toBe(false);
    item.set("value");
    expect(item.has()).toBe(true);
    item.delete();
    expect(item.has()).toBe(false);
  });

  it("has() works for memory scope", () => {
    const item = createStorageItem({
      key: "has-mem",
      scope: StorageScope.Memory,
      defaultValue: "default",
    });

    expect(item.has()).toBe(false);
    item.set("val");
    expect(item.has()).toBe(true);
    item.delete();
    expect(item.has()).toBe(false);
  });

  // --- onExpired ---

  it("calls onExpired callback when TTL disk value expires", () => {
    const onExpired = jest.fn();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const item = createStorageItem<string>({
      key: "expire-cb",
      scope: StorageScope.Disk,
      defaultValue: "default",
      expiration: { ttlMs: 50 },
      onExpired,
    });

    item.set("val");
    nowSpy.mockReturnValue(1_060);
    expect(item.get()).toBe("default");
    expect(onExpired).toHaveBeenCalledWith("expire-cb");
    nowSpy.mockRestore();
  });

  it("calls onExpired for namespaced key", () => {
    const onExpired = jest.fn();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const item = createStorageItem<string>({
      key: "tok",
      scope: StorageScope.Disk,
      defaultValue: "",
      namespace: "auth",
      expiration: { ttlMs: 50 },
      onExpired,
    });

    item.set("token123");
    nowSpy.mockReturnValue(1_060);
    item.get();
    expect(onExpired).toHaveBeenCalledWith("auth:tok");
    nowSpy.mockRestore();
  });

  it("calls onExpired for memory TTL expiration", () => {
    const onExpired = jest.fn();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const item = createStorageItem<string>({
      key: "mem-expire-cb",
      scope: StorageScope.Memory,
      defaultValue: "default",
      expiration: { ttlMs: 30 },
      onExpired,
    });

    item.set("live");
    nowSpy.mockReturnValue(1_040);
    expect(item.get()).toBe("default");
    expect(onExpired).toHaveBeenCalledWith("mem-expire-cb");
    nowSpy.mockRestore();
  });

  // --- Biometric fallback ---

  it("biometric items use __bio_ prefix in localStorage on web", () => {
    const item = createStorageItem({
      key: "bio-key",
      scope: StorageScope.Secure,
      defaultValue: "none",
      biometric: true,
    });

    item.set("secret");
    expect(globalThis.localStorage.getItem("__bio_bio-key")).toBe(
      serializeWithPrimitiveFastPath("secret"),
    );
    expect(item.get()).toBe("secret");
  });

  it("biometric has() checks __bio_ prefix", () => {
    const item = createStorageItem({
      key: "bio-has",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    expect(item.has()).toBe(false);
    item.set("val");
    expect(item.has()).toBe(true);
    item.delete();
    expect(item.has()).toBe(false);
  });

  it("biometric items do not coalesce writes", async () => {
    const setSpy = jest.spyOn(globalThis.localStorage, "setItem");
    const item = createStorageItem({
      key: "bio-no-coalesce",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
      coalesceSecureWrites: true, // should be ignored
    });

    item.set("now");
    expect(setSpy).toHaveBeenCalledWith(
      "__bio_bio-no-coalesce",
      serializeWithPrimitiveFastPath("now"),
    );
  });

  it("biometric with namespace combines both prefixes", () => {
    const item = createStorageItem({
      key: "pin",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
      namespace: "vault",
    });

    item.set("1234");
    expect(item.key).toBe("vault:pin");
    expect(globalThis.localStorage.getItem("__bio_vault:pin")).toBe(
      serializeWithPrimitiveFastPath("1234"),
    );
    expect(item.get()).toBe("1234");
  });

  it("biometric updates notify subscribers", () => {
    const item = createStorageItem({
      key: "bio-listener",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });
    const listener = jest.fn();
    item.subscribe(listener);

    item.set("secret");
    item.delete();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  // --- storage utility methods ---

  it("storage.has checks existence per scope", () => {
    const item = createStorageItem({
      key: "exists-key",
      scope: StorageScope.Disk,
      defaultValue: "",
    });
    expect(storage.has("exists-key", StorageScope.Disk)).toBe(false);
    item.set("val");
    expect(storage.has("exists-key", StorageScope.Disk)).toBe(true);
  });

  it("storage.has works for memory scope", () => {
    expect(storage.has("mem-check", StorageScope.Memory)).toBe(false);
    const item = createStorageItem({
      key: "mem-check",
      scope: StorageScope.Memory,
      defaultValue: "",
    });
    item.set("yes");
    expect(storage.has("mem-check", StorageScope.Memory)).toBe(true);
  });

  it("storage.getAllKeys returns all keys for a scope", () => {
    createStorageItem({
      key: "k1",
      scope: StorageScope.Disk,
      defaultValue: "",
    }).set("v1");
    createStorageItem({
      key: "k2",
      scope: StorageScope.Disk,
      defaultValue: "",
    }).set("v2");

    const keys = storage.getAllKeys(StorageScope.Disk);
    expect(keys).toContain("k1");
    expect(keys).toContain("k2");
  });

  it("storage.getAllKeys works for memory scope", () => {
    createStorageItem({
      key: "mk1",
      scope: StorageScope.Memory,
      defaultValue: "",
    }).set("v");
    createStorageItem({
      key: "mk2",
      scope: StorageScope.Memory,
      defaultValue: "",
    }).set("v");

    const keys = storage.getAllKeys(StorageScope.Memory);
    expect(keys).toContain("mk1");
    expect(keys).toContain("mk2");
  });

  it("storage.getAll returns all key-value pairs", () => {
    createStorageItem({
      key: "ga1",
      scope: StorageScope.Disk,
      defaultValue: "",
    }).set("a");
    createStorageItem({
      key: "ga2",
      scope: StorageScope.Disk,
      defaultValue: "",
    }).set("b");

    const all = storage.getAll(StorageScope.Disk);
    expect(all["ga1"]).toBe(serializeWithPrimitiveFastPath("a"));
    expect(all["ga2"]).toBe(serializeWithPrimitiveFastPath("b"));
  });

  it("storage.getAll works for memory scope (returns string values only)", () => {
    const item = createStorageItem({
      key: "ga-mem",
      scope: StorageScope.Memory,
      defaultValue: "",
    });
    item.set("stringval");

    const all = storage.getAll(StorageScope.Memory);
    expect(all["ga-mem"]).toBe("stringval");
  });

  it("storage.size returns count of entries", () => {
    const before = storage.size(StorageScope.Disk);
    createStorageItem({
      key: "sz1",
      scope: StorageScope.Disk,
      defaultValue: "",
    }).set("v");
    createStorageItem({
      key: "sz2",
      scope: StorageScope.Disk,
      defaultValue: "",
    }).set("v");
    expect(storage.size(StorageScope.Disk)).toBe(before + 2);
  });

  it("storage.size works for memory", () => {
    const before = storage.size(StorageScope.Memory);
    createStorageItem({
      key: "msz1",
      scope: StorageScope.Memory,
      defaultValue: "",
    }).set("v");
    expect(storage.size(StorageScope.Memory)).toBe(before + 1);
  });

  // --- clearNamespace ---

  it("storage.clearNamespace removes only namespaced keys", () => {
    const nsItem = createStorageItem({
      key: "t",
      scope: StorageScope.Disk,
      defaultValue: "",
      namespace: "session",
    });
    const plainItem = createStorageItem({
      key: "other",
      scope: StorageScope.Disk,
      defaultValue: "",
    });

    nsItem.set("ns-val");
    plainItem.set("plain-val");

    storage.clearNamespace("session", StorageScope.Disk);

    expect(globalThis.localStorage.getItem("session:t")).toBeNull();
    expect(globalThis.localStorage.getItem("other")).toBe(
      serializeWithPrimitiveFastPath("plain-val"),
    );
  });

  it("storage.clearNamespace removes namespaced biometric keys in secure scope", () => {
    const biometric = createStorageItem({
      key: "token",
      scope: StorageScope.Secure,
      defaultValue: "",
      namespace: "session",
      biometric: true,
    });
    const regular = createStorageItem({
      key: "token",
      scope: StorageScope.Secure,
      defaultValue: "",
      namespace: "session",
    });

    biometric.set("bio");
    regular.set("secure");
    storage.clearNamespace("session", StorageScope.Secure);

    expect(globalThis.localStorage.getItem("__bio_session:token")).toBeNull();
    expect(
      globalThis.localStorage.getItem("__secure_session:token"),
    ).toBeNull();
  });

  it("storage.clearNamespace works for memory scope", () => {
    const ns = createStorageItem({
      key: "x",
      scope: StorageScope.Memory,
      defaultValue: "",
      namespace: "tmp",
    });
    const plain = createStorageItem({
      key: "keep",
      scope: StorageScope.Memory,
      defaultValue: "",
    });

    ns.set("val");
    plain.set("kept");

    storage.clearNamespace("tmp", StorageScope.Memory);
    expect(ns.get()).toBe("");
    expect(plain.get()).toBe("kept");
  });

  // --- clearBiometric ---

  it("storage.clearBiometric removes all __bio_ prefixed entries", () => {
    globalThis.localStorage.setItem("__bio_a", "x");
    globalThis.localStorage.setItem("__bio_b", "y");
    globalThis.localStorage.setItem("normal", "z");

    storage.clearBiometric();

    expect(globalThis.localStorage.getItem("__bio_a")).toBeNull();
    expect(globalThis.localStorage.getItem("__bio_b")).toBeNull();
    expect(globalThis.localStorage.getItem("normal")).toBe("z");
  });

  // --- createSecureAuthStorage ---

  it("creates multiple secure storage items with shared namespace", () => {
    const auth = createSecureAuthStorage({
      accessToken: { ttlMs: 3600_000 },
      refreshToken: {},
    });

    expect(auth.accessToken.key).toBe("auth:accessToken");
    expect(auth.refreshToken.key).toBe("auth:refreshToken");
    expect(auth.accessToken.scope).toBe(StorageScope.Secure);

    auth.accessToken.set("at-123");
    auth.refreshToken.set("rt-456");
    expect(auth.accessToken.get()).toBe("at-123");
    expect(auth.refreshToken.get()).toBe("rt-456");
  });

  it("createSecureAuthStorage respects custom namespace", () => {
    const tokens = createSecureAuthStorage(
      { jwt: {} },
      { namespace: "custom" },
    );

    expect(tokens.jwt.key).toBe("custom:jwt");
    tokens.jwt.set("tok");
    expect(tokens.jwt.get()).toBe("tok");
  });

  it("createSecureAuthStorage items have has() method", () => {
    const auth = createSecureAuthStorage({ session: {} });
    expect(auth.session.has()).toBe(false);
    auth.session.set("active");
    expect(auth.session.has()).toBe(true);
  });

  it("createSecureAuthStorage with biometric flag uses bio fallback", () => {
    const auth = createSecureAuthStorage({
      bioToken: { biometric: true },
    });

    auth.bioToken.set("bio-secured");
    expect(globalThis.localStorage.getItem("__bio_auth:bioToken")).toBe(
      serializeWithPrimitiveFastPath("bio-secured"),
    );
  });

  it("createSecureAuthStorage with TTL expires correctly", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(10_000);
    const auth = createSecureAuthStorage({
      shortLived: { ttlMs: 100 },
    });

    auth.shortLived.set("temp");
    expect(auth.shortLived.get()).toBe("temp");

    nowSpy.mockReturnValue(10_200);
    expect(auth.shortLived.get()).toBe("");
    nowSpy.mockRestore();
  });

  // --- accessControl is a no-op on web ---

  it("accessControl option does not throw on web", () => {
    expect(() =>
      createStorageItem({
        key: "ac-test",
        scope: StorageScope.Secure,
        defaultValue: "",
        accessControl: AccessControl.WhenUnlocked,
      }),
    ).not.toThrow();

    // storage level no-op
    expect(() =>
      storage.setAccessControl(AccessControl.AfterFirstUnlock),
    ).not.toThrow();
    expect(() => storage.setKeychainAccessGroup("group.test")).not.toThrow();
  });

  // --- edge: biometric ignores memory scope ---

  it("biometric flag is ignored for non-secure scopes", () => {
    const item = createStorageItem({
      key: "bio-disk",
      scope: StorageScope.Disk,
      defaultValue: "",
      biometric: true, // only relevant for Secure scope
    });

    item.set("val");
    // Should use regular localStorage, not __bio_ prefix
    expect(globalThis.localStorage.getItem("bio-disk")).toBe(
      serializeWithPrimitiveFastPath("val"),
    );
  });

  // --- batch with namespaced items ---

  it("batch operations work with namespaced items", () => {
    const item1 = createStorageItem({
      key: "a",
      scope: StorageScope.Disk,
      defaultValue: "",
      namespace: "ns",
    });
    const item2 = createStorageItem({
      key: "b",
      scope: StorageScope.Disk,
      defaultValue: "",
      namespace: "ns",
    });

    setBatch(
      [
        { item: item1, value: "v1" },
        { item: item2, value: "v2" },
      ],
      StorageScope.Disk,
    );

    const values = getBatch([item1, item2], StorageScope.Disk);
    expect(values).toEqual(["v1", "v2"]);
    expect(item1.key).toBe("ns:a");
    expect(item2.key).toBe("ns:b");
  });

  // --- transactions with namespaced items ---

  it("transactions work with namespaced items", () => {
    const item = createStorageItem({
      key: "txn-ns",
      scope: StorageScope.Disk,
      defaultValue: "init",
      namespace: "ctx",
    });

    runTransaction(StorageScope.Disk, (tx) => {
      tx.setItem(item, "updated");
    });

    expect(item.get()).toBe("updated");
  });

  it("transaction rollback works with namespaced items", () => {
    const item = createStorageItem({
      key: "txn-ns-rb",
      scope: StorageScope.Disk,
      defaultValue: "init",
      namespace: "ctx",
    });
    item.set("before");

    expect(() =>
      runTransaction(StorageScope.Disk, (tx) => {
        tx.setItem(item, "during");
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(item.get()).toBe("before");
  });
});
