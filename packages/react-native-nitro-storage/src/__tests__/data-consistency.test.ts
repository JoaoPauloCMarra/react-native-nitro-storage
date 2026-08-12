import {
  createStorageItem,
  diskItem,
  flushWebStorageBackends,
  getStorageErrorCode,
  removeBatch,
  runTransaction,
  secureItem,
  storage,
  type StorageChangeEvent,
  type StorageKeyChangeEvent,
  StorageScope,
} from "../index.web";
import {
  NATIVE_BATCH_MISSING_SENTINEL,
  decodeNativeBatchValue,
  deserializeWithPrimitiveFastPath,
  escapeCollidingRawValue,
  serializeWithPrimitiveFastPath,
  unescapeCollidingRawValue,
} from "../internal";
import { createNitroStorageMock, resetNitroStorageMock } from "../testing";

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

function createWindowMock() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    addEventListener(type: string, listener: (event: Event) => void) {
      const typeListeners =
        listeners.get(type) ?? new Set<(event: Event) => void>();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event) {
      listeners.get(event.type)?.forEach((listener) => {
        listener(event);
      });
      return true;
    },
  };
}

beforeEach(() => {
  resetNitroStorageMock();
  storage.setDiskWritesAsync(false);
  storage.setEventObserver(undefined);
  Object.defineProperty(globalThis, "localStorage", {
    value: createStorageMock(),
    configurable: true,
    writable: true,
  });
  if (
    typeof globalThis.window === "undefined" ||
    typeof globalThis.window.addEventListener !== "function" ||
    typeof (globalThis.window as unknown as { dispatchEvent?: unknown })
      .dispatchEvent !== "function"
  ) {
    Object.defineProperty(globalThis, "window", {
      value: createWindowMock() as unknown as Window & typeof globalThis,
      configurable: true,
      writable: true,
    });
  }
});

describe("item 1: import cannot be overwritten by pending writes", () => {
  it("flushes coalesced disk writes before import and retains the imported value", () => {
    storage.setDiskWritesAsync(true);
    storage.setString("coalesced", "stale", StorageScope.Disk);
    storage.import({ coalesced: "imported" }, StorageScope.Disk);
    storage.flushDiskWrites();
    expect(storage.getString("coalesced", StorageScope.Disk)).toBe("imported");
  });

  it("keeps the imported value after a later scheduled microtask flush", async () => {
    storage.setDiskWritesAsync(true);
    storage.setString("raced", "stale", StorageScope.Disk);
    storage.import({ raced: "imported" }, StorageScope.Disk);
    await Promise.resolve();
    expect(storage.getString("raced", StorageScope.Disk)).toBe("imported");
    storage.flushDiskWrites();
    expect(storage.getString("raced", StorageScope.Disk)).toBe("imported");
  });

  it("flushes pending secure writes before import", () => {
    const mock = createNitroStorageMock();
    mock.storage.setSecureWritesAsync(true);
    mock.storage.setString("secret", "stale", StorageScope.Secure);
    mock.storage.import({ secret: "imported" }, StorageScope.Secure);
    mock.storage.flushSecureWrites();
    expect(mock.storage.getString("secret", StorageScope.Secure)).toBe(
      "imported",
    );
  });

  it("emits one import batch event with flushed old values", () => {
    const events: StorageChangeEvent[] = [];
    storage.setEventObserver((event) => events.push(event));
    storage.setDiskWritesAsync(true);
    storage.setString("k", "stale", StorageScope.Disk);
    storage.import({ k: "imported" }, StorageScope.Disk);
    storage.setEventObserver(undefined);
    storage.setDiskWritesAsync(false);
    const importEvents = events.filter(
      (event) => event.type === "batch" && event.operation === "import",
    );
    expect(importEvents).toHaveLength(1);
    expect(importEvents[0].type).toBe("batch");
    if (importEvents[0].type === "batch") {
      expect(importEvents[0].changes[0].oldValue).toBe("stale");
      expect(importEvents[0].changes[0].newValue).toBe("imported");
    }
  });
});

describe("item 4: rollback events", () => {
  it("emits one typed rollback batch event on memory transaction failure", () => {
    const events: StorageChangeEvent[] = [];
    storage.setEventObserver((event) => events.push(event));
    const item = createStorageItem({
      key: "rb-memory",
      scope: StorageScope.Memory,
      defaultValue: "default",
    });
    item.set("before");
    expect(() =>
      runTransaction(StorageScope.Memory, (tx) => {
        tx.setItem(item, "failed");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    storage.setEventObserver(undefined);

    expect(item.get()).toBe("before");
    const rollbacks = events.filter(
      (event) => event.type === "batch" && event.operation === "rollback",
    );
    expect(rollbacks).toHaveLength(1);
    if (rollbacks[0].type !== "batch") return;
    expect(rollbacks[0].changes).toHaveLength(1);
    const change = rollbacks[0].changes[0] as StorageKeyChangeEvent;
    expect(change.key).toBe("rb-memory");
    expect(change.oldValue).toBe("failed");
    expect(change.newValue).toBe("before");
    expect(change.source).toBe("memory");
  });

  it("emits one typed rollback batch event on disk transaction failure", () => {
    const events: StorageChangeEvent[] = [];
    storage.setEventObserver((event) => events.push(event));
    const item = diskItem<string>({
      key: "rb-disk",
      defaultValue: "default",
    });
    item.set("before");
    expect(() =>
      runTransaction(StorageScope.Disk, (tx) => {
        tx.setItem(item, "failed");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    storage.setEventObserver(undefined);

    expect(item.get()).toBe("before");
    const rollbacks = events.filter(
      (event) => event.type === "batch" && event.operation === "rollback",
    );
    expect(rollbacks).toHaveLength(1);
    if (rollbacks[0].type !== "batch") return;
    const change = rollbacks[0].changes[0] as StorageKeyChangeEvent;
    expect(change.oldValue).toBe(serializeWithPrimitiveFastPath("failed"));
    expect(change.newValue).toBe(serializeWithPrimitiveFastPath("before"));
  });

  it("emits rollback events for raw context writes with observer parity", () => {
    const observed: string[] = [];
    const keyEvents: string[] = [];
    storage.setEventObserver((event) => {
      if (event.type === "batch") observed.push(event.operation);
    });
    const unsubscribe = storage.subscribeKey(
      StorageScope.Memory,
      "rb-raw",
      (event) => {
        if (event.type === "key") keyEvents.push(event.operation);
      },
    );
    expect(() =>
      runTransaction(StorageScope.Memory, (tx) => {
        tx.setRaw("rb-raw", "failed");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    unsubscribe();
    storage.setEventObserver(undefined);
    expect(observed).toEqual(["rollback"]);
    expect(keyEvents.at(-1)).toBe("rollback");
    expect(storage.getString("rb-raw", StorageScope.Memory)).toBeUndefined();
  });

  it("does not emit a rollback event when the transaction changed nothing", () => {
    const observed: string[] = [];
    storage.setEventObserver((event) => {
      if (event.type === "batch") observed.push(event.operation);
    });
    expect(() =>
      runTransaction(StorageScope.Memory, () => {
        throw new Error("early-boom");
      }),
    ).toThrow("early-boom");
    storage.setEventObserver(undefined);
    expect(observed).toEqual([]);
  });
});

describe("item 5: memory removeBatch is atomic and emits once", () => {
  it("mutates all keys and emits exactly one batch event", () => {
    const scopeEvents: StorageChangeEvent[] = [];
    const keyEvents: string[] = [];
    const itemA = createStorageItem({
      key: "batch-a",
      scope: StorageScope.Memory,
      defaultValue: 1,
    });
    const itemB = createStorageItem({
      key: "batch-b",
      scope: StorageScope.Memory,
      defaultValue: 2,
    });
    itemA.set(10);
    itemB.set(20);
    const unsubscribeScope = storage.subscribe(StorageScope.Memory, (event) =>
      scopeEvents.push(event),
    );
    const unsubscribeA = storage.subscribeKey(
      StorageScope.Memory,
      "batch-a",
      (event) => {
        if (event.type === "key") keyEvents.push(event.operation);
      },
    );

    removeBatch([itemA, itemB], StorageScope.Memory);
    unsubscribeScope();
    unsubscribeA();

    expect(itemA.get()).toBe(1);
    expect(itemB.get()).toBe(2);
    expect(keyEvents).toEqual(["removeBatch"]);
    const batches = scopeEvents.filter(
      (event) => event.type === "batch" && event.operation === "removeBatch",
    );
    expect(batches).toHaveLength(1);
    expect(scopeEvents.filter((event) => event.type === "key")).toHaveLength(0);
  });

  it("removes memory expiration state without spurious expire events", () => {
    const expired: string[] = [];
    const unsubscribe = storage.subscribeExpired(StorageScope.Memory, (event) =>
      expired.push(event.key),
    );
    const item = createStorageItem({
      key: "batch-ttl",
      scope: StorageScope.Memory,
      defaultValue: "",
      expiration: { ttlMs: 50 },
    });
    item.set("temp");
    removeBatch([item], StorageScope.Memory);
    expect(item.get()).toBe("");
    unsubscribe();
    expect(expired).toEqual([]);
  });
});

describe("item 9: migrations are failure-atomic", () => {
  it("rolls back all data and the version key when a migration step throws", () => {
    const mock = createNitroStorageMock();
    mock.registerMigration(1, ({ setRaw }) => {
      setRaw("migrated-key", "moved");
    });
    mock.registerMigration(2, ({ setRaw, removeRaw }) => {
      setRaw("step-2", "value");
      throw new Error("step-2-failed");
    });
    expect(() => mock.migrateToLatest(StorageScope.Disk)).toThrow(
      "step-2-failed",
    );
    expect(mock.storage.getString("migrated-key", StorageScope.Disk)).toBe(
      "moved",
    );
    expect(mock.storage.getString("step-2", StorageScope.Disk)).toBe(undefined);
    const version = mock.storage.getString(
      "__nitro_storage_migration_version__",
      StorageScope.Disk,
    );
    expect(version).toBe("1");
  });

  it("reruns the failed migration after rollback and reaches the latest version", () => {
    const mock = createNitroStorageMock();
    let shouldFail = true;
    mock.registerMigration(1, ({ setRaw }) => {
      setRaw("retry-key", "v1");
    });
    mock.registerMigration(2, ({ setRaw }) => {
      if (shouldFail) {
        throw new Error("transient-failure");
      }
      setRaw("retry-key", "v2");
    });
    expect(() => mock.migrateToLatest(StorageScope.Disk)).toThrow(
      "transient-failure",
    );
    expect(mock.storage.getString("retry-key", StorageScope.Disk)).toBe("v1");
    shouldFail = false;
    const applied = mock.migrateToLatest(StorageScope.Disk);
    expect(applied).toBe(2);
    expect(mock.storage.getString("retry-key", StorageScope.Disk)).toBe("v2");
    expect(
      mock.storage.getString(
        "__nitro_storage_migration_version__",
        StorageScope.Disk,
      ),
    ).toBe("2");
    expect(mock.migrateToLatest(StorageScope.Disk)).toBe(2);
  });

  it("keeps completed steps persisted when a later step fails on the retry", () => {
    const mock = createNitroStorageMock();
    let failStep2 = true;
    mock.registerMigration(1, ({ setRaw }) => {
      setRaw("durable-step", "done");
    });
    mock.registerMigration(2, ({ setRaw }) => {
      if (failStep2) {
        throw new Error("fail-once");
      }
      setRaw("second", "done");
    });
    expect(() => mock.migrateToLatest(StorageScope.Disk)).toThrow("fail-once");
    expect(mock.storage.getString("durable-step", StorageScope.Disk)).toBe(
      "done",
    );
    failStep2 = false;
    expect(mock.migrateToLatest(StorageScope.Disk)).toBe(2);
    expect(mock.storage.getString("second", StorageScope.Disk)).toBe("done");
  });
});

describe("item 11: encoding collisions", () => {
  it("round-trips strings equal to the batch missing sentinel", () => {
    const serialized = serializeWithPrimitiveFastPath(
      NATIVE_BATCH_MISSING_SENTINEL,
    );
    expect(serialized).not.toBe(NATIVE_BATCH_MISSING_SENTINEL);
    expect(deserializeWithPrimitiveFastPath<string>(serialized)).toBe(
      NATIVE_BATCH_MISSING_SENTINEL,
    );
  });

  it("round-trips strings equal to primitive fast-path tokens", () => {
    for (const token of [
      "__nitro_storage_primitive__:u",
      "__nitro_storage_primitive__:l",
      "__nitro_storage_primitive__:b:1",
      "__nitro_storage_primitive__:b:0",
      "__nitro_storage_primitive__:n:Infinity",
      "__nitro_storage_primitive__:n:-Infinity",
      "__nitro_storage_primitive__:n:NaN",
    ]) {
      const serialized = serializeWithPrimitiveFastPath(token);
      expect(serialized).not.toBe(token);
      expect(deserializeWithPrimitiveFastPath<string>(serialized)).toBe(token);
    }
  });

  it("round-trips strings that start with reserved prefixes", () => {
    for (const value of [
      "__nitro_storage_primitive__:s:anything",
      "__nitro_storage_escaped__:data",
    ]) {
      expect(
        deserializeWithPrimitiveFastPath<string>(
          serializeWithPrimitiveFastPath(value),
        ),
      ).toBe(value);
    }
  });

  it("preserves legacy fast-path reads", () => {
    expect(
      deserializeWithPrimitiveFastPath<string>(
        "__nitro_storage_primitive__:s:plain",
      ),
    ).toBe("plain");
    expect(
      deserializeWithPrimitiveFastPath<number>(
        "__nitro_storage_primitive__:n:42",
      ),
    ).toBe(42);
    expect(deserializeWithPrimitiveFastPath<string>("legacy-raw")).toBe(
      "legacy-raw",
    );
  });

  it("maps the native batch sentinel to missing without decoding payloads", () => {
    expect(decodeNativeBatchValue(NATIVE_BATCH_MISSING_SENTINEL)).toBe(
      undefined,
    );
    const encodedSentinel = escapeCollidingRawValue(
      NATIVE_BATCH_MISSING_SENTINEL,
    );
    expect(decodeNativeBatchValue(encodedSentinel)).toBe(encodedSentinel);
    expect(decodeNativeBatchValue("plain")).toBe("plain");
    expect(decodeNativeBatchValue(undefined)).toBe(undefined);
  });

  it("keeps raw API writes of colliding strings readable through items", () => {
    const colliding = "__nitro_storage_primitive__:u";
    storage.setString("collision-key", colliding, StorageScope.Disk);
    const item = diskItem<string>({ key: "collision-key", defaultValue: "" });
    expect(item.get()).toBe(colliding);
    expect(storage.getString("collision-key", StorageScope.Disk)).toBe(
      colliding,
    );
    expect(unescapeCollidingRawValue(escapeCollidingRawValue(colliding))).toBe(
      colliding,
    );
  });

  it("keeps raw API writes of the sentinel readable through raw reads", () => {
    const sentinel = NATIVE_BATCH_MISSING_SENTINEL;
    storage.setString("sentinel-key", sentinel, StorageScope.Disk);
    expect(storage.getString("sentinel-key", StorageScope.Disk)).toBe(sentinel);
    expect(storage.getAll(StorageScope.Disk)["sentinel-key"]).toBe(sentinel);
  });
});

describe("item 12: metrics split by scope", () => {
  it("keeps separate counters per operation and scope with compatible summaries", () => {
    const mock = createNitroStorageMock();
    mock.storage.setMetricsObserver(() => {});
    mock.storage.resetMetrics();
    const disk = mock.diskItem<string>({ key: "m-disk", defaultValue: "" });
    const secure = mock.secureItem<string>({
      key: "m-secure",
      defaultValue: "",
    });
    disk.set("d");
    disk.get();
    secure.set("s");
    secure.get();
    mock.storage.setMetricsObserver(undefined);

    const snapshot = mock.storage.getMetricsSnapshot();
    expect(snapshot["item:set"]?.count).toBe(2);
    expect(snapshot["item:get"]?.count).toBe(2);

    const scopedSnapshot = mock.storage.getScopedMetricsSnapshot();
    expect(scopedSnapshot["item:set:1"]).toBeDefined();
    expect(scopedSnapshot["item:get:1"]).toBeDefined();
    expect(scopedSnapshot["item:set:2"]).toBeDefined();
    expect(scopedSnapshot["item:get:2"]).toBeDefined();
    for (const summary of Object.values(scopedSnapshot)) {
      expect(summary.count).toBeGreaterThan(0);
      expect(typeof summary.totalDurationMs).toBe("number");
      expect(typeof summary.avgDurationMs).toBe("number");
      expect(typeof summary.maxDurationMs).toBe("number");
    }
  });
});

describe("item 2: biometric promotion parity (web)", () => {
  it("removes the plain secure copy when a value is promoted to biometric", () => {
    const plain = secureItem<string>({ key: "promote", defaultValue: "" });
    const biometric = secureItem<string>({
      key: "promote",
      defaultValue: "",
      biometric: true,
    });
    plain.set("plain-value");
    expect(plain.get()).toBe("plain-value");
    biometric.set("bio-value");
    expect(biometric.get()).toBe("bio-value");
    expect(plain.get()).toBe("");
  });

  it("keeps the biometric copy intact when a plain value is written (platform parity)", () => {
    const plain = secureItem<string>({ key: "demote", defaultValue: "" });
    const biometric = secureItem<string>({
      key: "demote",
      defaultValue: "",
      biometric: true,
    });
    biometric.set("bio-value");
    expect(biometric.get()).toBe("bio-value");
    plain.set("plain-value");
    expect(plain.get()).toBe("plain-value");
    expect(biometric.get()).toBe("bio-value");
  });

  it("removes the plain copy when a raw plain value is promoted through an item", () => {
    storage.setString("raw-bio", "plain", StorageScope.Secure);
    const biometric = secureItem<string>({
      key: "raw-bio",
      defaultValue: "",
      biometric: true,
    });
    biometric.set("bio-value");
    expect(biometric.get()).toBe("bio-value");
    expect(storage.getString("raw-bio", StorageScope.Secure)).toBeUndefined();
  });
});

describe("item 15: optimistic CAS semantics", () => {
  it("fails setIfVersion when the version changed between read and write", () => {
    const item = createStorageItem({
      key: "cas-key",
      scope: StorageScope.Memory,
      defaultValue: "v1",
    });
    item.set("v1");
    const snapshot = item.getWithVersion();
    storage.setString("cas-key", "external", StorageScope.Memory);
    expect(item.setIfVersion(snapshot.version, "v2")).toBe(false);
    expect(item.get()).toBe("external");
  });

  it("only one writer wins with the same version token", () => {
    const item = createStorageItem({
      key: "cas-key-2",
      scope: StorageScope.Memory,
      defaultValue: 0,
    });
    item.set(0);
    const snapshot = item.getWithVersion();
    expect(item.setIfVersion(snapshot.version, 1)).toBe(true);
    expect(item.setIfVersion(snapshot.version, 2)).toBe(false);
    expect(item.get()).toBe(1);
  });
});

describe("item 10: tagged error classification", () => {
  it("classifies every public error code from its tag", () => {
    for (const code of [
      "keychain_locked",
      "authentication_required",
      "key_invalidated",
      "storage_corruption",
      "biometric_unavailable",
      "unsupported",
    ]) {
      expect(
        getStorageErrorCode(new Error(`[nitro-error:${code}] detail`)),
      ).toBe(code);
    }
  });

  it("does not classify errors from message text alone", () => {
    expect(getStorageErrorCode(new Error("errSecInteractionNotAllowed"))).toBe(
      undefined,
    );
    expect(
      getStorageErrorCode(new Error("UserNotAuthenticatedException")),
    ).toBeUndefined();
    expect(getStorageErrorCode(new Error("random text"))).toBeUndefined();
  });

  it("produces the unsupported code when IndexedDB is unavailable", async () => {
    const { createIndexedDBBackend } = await import("../indexeddb-backend");
    await expect(createIndexedDBBackend()).rejects.toMatchObject({
      message: expect.stringContaining("[nitro-error:unsupported]"),
    });
  });
});

describe("web backend lifecycle", () => {
  it("flushes web backends without losing imported values", async () => {
    storage.setDiskWritesAsync(true);
    storage.setString("lifecycle", "stale", StorageScope.Disk);
    storage.import({ lifecycle: "imported" }, StorageScope.Disk);
    await flushWebStorageBackends();
    expect(storage.getString("lifecycle", StorageScope.Disk)).toBe("imported");
  });
});
