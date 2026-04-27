/**
 * Tests for the IndexedDB-backed WebSecureStorageBackend.
 *
 * Jest runs in jsdom (which does not have a real IndexedDB implementation),
 * so we use the `fake-indexeddb` package (bundled with jest-environment-jsdom's
 * default polyfills) — or fall back to a manual in-memory IDB mock below.
 *
 * The fake-indexeddb approach: we install a minimal indexedDB polyfill on
 * globalThis before importing the module under test, then reset it between tests.
 */

import { createIndexedDBBackend } from "../indexeddb-backend";

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB polyfill for the test environment.
// We cannot use the real jsdom IDBFactory because it is not available in all
// jest environments.  Instead we shim just enough of the IDB API to exercise
// our implementation's behaviour.
// ---------------------------------------------------------------------------

type IDBEntry = {
  key: IDBValidKey;
  value: unknown;
};

function makeFakeIDB(): {
  indexedDB: Pick<IDBFactory, "open">;
  reset: () => void;
} {
  const databases = new Map<string, IDBEntry[]>();

  function reset(): void {
    databases.clear();
  }

  function makeObjectStore(
    storeName: string,
    entries: IDBEntry[],
    mode: IDBTransactionMode,
  ) {
    return {
      put(value: unknown, key: IDBValidKey) {
        if (mode === "readwrite") {
          const existing = entries.findIndex((e) => e.key === key);
          if (existing >= 0) {
            entries[existing]!.value = value;
          } else {
            entries.push({ key, value });
          }
        }
        const req = { result: null, onsuccess: null, onerror: null };
        return req;
      },
      delete(key: IDBValidKey) {
        if (mode === "readwrite") {
          const idx = entries.findIndex((e) => e.key === key);
          if (idx >= 0) entries.splice(idx, 1);
        }
        const req = { result: null, onsuccess: null, onerror: null };
        return req;
      },
      clear() {
        if (mode === "readwrite") entries.length = 0;
        const req = { result: null, onsuccess: null, onerror: null };
        return req;
      },
      openCursor() {
        let pos = 0;
        const req: {
          result: IDBCursorWithValue | null;
          onsuccess: ((e: Event) => void) | null;
          onerror: ((e: Event) => void) | null;
        } = { result: null, onsuccess: null, onerror: null };

        queueMicrotask(() => {
          function advance() {
            if (pos < entries.length) {
              const entry = entries[pos++]!;
              const cursor: IDBCursorWithValue = {
                key: entry.key,
                value: entry.value,
                continue() {
                  queueMicrotask(() => {
                    advance();
                  });
                },
              } as unknown as IDBCursorWithValue;
              req.result = cursor;
            } else {
              req.result = null;
            }
            req.onsuccess?.({} as Event);
          }
          advance();
        });

        return req;
      },
    };
  }

  function makeTransaction(
    entries: IDBEntry[],
    storeName: string,
    mode: IDBTransactionMode,
  ) {
    let onCompleteCallback: (() => void) | null = null;
    let onErrorCallback: ((e: Event) => void) | null = null;
    const tx = {
      objectStore(_name: string) {
        return makeObjectStore(storeName, entries, mode);
      },
      set oncomplete(cb: (() => void) | null) {
        onCompleteCallback = cb;
        // Fire async so callers can set onsuccess/onerror first
        queueMicrotask(() => onCompleteCallback?.());
      },
      set onerror(cb: ((e: Event) => void) | null) {
        onErrorCallback = cb;
        void onErrorCallback; // suppress unused warning
      },
    };
    return tx;
  }

  function open(dbName: string, _version: number) {
    if (!databases.has(dbName)) {
      databases.set(dbName, []);
    }
    const entries = databases.get(dbName)!;

    const db = {
      objectStoreNames: {
        contains: (_name: string) => true,
      },
      createObjectStore(_name: string) {
        return {};
      },
      transaction(storeName: string, mode: IDBTransactionMode = "readonly") {
        return makeTransaction(entries, storeName, mode);
      },
    };

    const req: {
      result: typeof db | null;
      error: DOMException | null;
      onupgradeneeded: ((e: IDBVersionChangeEvent) => void) | null;
      onsuccess: ((e: Event) => void) | null;
      onerror: ((e: Event) => void) | null;
    } = {
      result: null,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    };

    queueMicrotask(() => {
      req.result = db;
      req.onsuccess?.({} as Event);
    });

    return req;
  }

  return {
    indexedDB: { open } as unknown as Pick<IDBFactory, "open">,
    reset,
  };
}

let fakeIDB: ReturnType<typeof makeFakeIDB>;
let cleanupBroadcastChannels: (() => void) | undefined;

function installBroadcastChannelMock(): () => void {
  const listeners = new Map<string, Set<(event: { data: unknown }) => void>>();

  class BroadcastChannelMock {
    readonly name: string;

    constructor(name: string) {
      this.name = name;
      listeners.set(name, listeners.get(name) ?? new Set());
    }

    addEventListener(
      _type: "message",
      listener: (event: { data: unknown }) => void,
    ): void {
      listeners.get(this.name)?.add(listener);
    }

    removeEventListener(
      _type: "message",
      listener: (event: { data: unknown }) => void,
    ): void {
      listeners.get(this.name)?.delete(listener);
    }

    postMessage(data: unknown): void {
      const channelListeners = Array.from(listeners.get(this.name) ?? []);
      channelListeners.forEach((listener) => {
        queueMicrotask(() => listener({ data }));
      });
    }

    close(): void {}
  }

  Object.defineProperty(globalThis, "BroadcastChannel", {
    value: BroadcastChannelMock,
    writable: true,
    configurable: true,
  });

  return () => {
    listeners.clear();
    // @ts-expect-error intentional cleanup
    delete globalThis.BroadcastChannel;
  };
}

beforeEach(() => {
  fakeIDB = makeFakeIDB();
  Object.defineProperty(globalThis, "indexedDB", {
    value: fakeIDB.indexedDB,
    writable: true,
    configurable: true,
  });
  cleanupBroadcastChannels = installBroadcastChannelMock();
});

afterEach(() => {
  fakeIDB.reset();
  cleanupBroadcastChannels?.();
  // @ts-expect-error — intentional cleanup
  delete globalThis.indexedDB;
});

describe("createIndexedDBBackend", () => {
  it("returns a backend that satisfies the WebSecureStorageBackend interface", async () => {
    const backend = await createIndexedDBBackend();
    expect(typeof backend.getItem).toBe("function");
    expect(typeof backend.setItem).toBe("function");
    expect(typeof backend.removeItem).toBe("function");
    expect(typeof backend.clear).toBe("function");
    expect(typeof backend.getAllKeys).toBe("function");
    expect(typeof backend.flush).toBe("function");
    expect(typeof backend.subscribe).toBe("function");
  });

  it("getItem returns null for a key that was never set", async () => {
    const backend = await createIndexedDBBackend();
    expect(backend.getItem("missing")).toBeNull();
  });

  it("setItem / getItem round-trips a value synchronously after init", async () => {
    const backend = await createIndexedDBBackend();
    backend.setItem("foo", "bar");
    expect(backend.getItem("foo")).toBe("bar");
  });

  it("removeItem deletes a key from the in-memory cache", async () => {
    const backend = await createIndexedDBBackend();
    backend.setItem("to-remove", "v");
    backend.removeItem("to-remove");
    expect(backend.getItem("to-remove")).toBeNull();
  });

  it("clear removes all keys", async () => {
    const backend = await createIndexedDBBackend();
    backend.setItem("a", "1");
    backend.setItem("b", "2");
    backend.clear();
    expect(backend.getAllKeys()).toEqual([]);
    expect(backend.getItem("a")).toBeNull();
  });

  it("getAllKeys returns all stored keys", async () => {
    const backend = await createIndexedDBBackend();
    backend.setItem("k1", "v1");
    backend.setItem("k2", "v2");
    expect(backend.getAllKeys().sort()).toEqual(["k1", "k2"]);
  });

  it("hydrates the cache from pre-existing IndexedDB entries on init", async () => {
    // Pre-seed the fake IDB by first creating a backend and writing data
    const seeder = await createIndexedDBBackend("hydrate-test", "kv");
    seeder.setItem("persisted", "value");

    // Give the fire-and-forget write a chance to land (microtask drain)
    await new Promise<void>((r) => queueMicrotask(r));

    // Create a fresh backend on the same DB name — it should read "persisted"
    const fresh = await createIndexedDBBackend("hydrate-test", "kv");
    expect(fresh.getItem("persisted")).toBe("value");
  });

  it("rejects when IndexedDB is unavailable", async () => {
    // @ts-expect-error — intentional: simulate missing IndexedDB
    delete globalThis.indexedDB;
    await expect(createIndexedDBBackend()).rejects.toThrow(
      /IndexedDB is not available/,
    );
  });

  it("overwriting a key updates the value", async () => {
    const backend = await createIndexedDBBackend();
    backend.setItem("key", "first");
    backend.setItem("key", "second");
    expect(backend.getItem("key")).toBe("second");
  });

  it("getAllKeys returns empty array after clear", async () => {
    const backend = await createIndexedDBBackend();
    backend.setItem("a", "1");
    backend.setItem("b", "2");
    backend.setItem("c", "3");
    backend.clear();
    expect(backend.getAllKeys()).toEqual([]);
  });

  it("removeItem for non-existent key does not throw", async () => {
    const backend = await createIndexedDBBackend();
    expect(() => backend.removeItem("ghost")).not.toThrow();
  });

  it("setItem after clear works correctly", async () => {
    const backend = await createIndexedDBBackend();
    backend.setItem("a", "1");
    backend.setItem("b", "2");
    backend.clear();
    backend.setItem("c", "3");
    expect(backend.getItem("c")).toBe("3");
    expect(backend.getItem("a")).toBeNull();
    expect(backend.getItem("b")).toBeNull();
    expect(backend.getAllKeys()).toEqual(["c"]);
  });

  it("multiple backends on same DB share persistence", async () => {
    const backendA = await createIndexedDBBackend("shared-db", "kv");
    backendA.setItem("shared-key", "shared-value");

    await new Promise<void>((r) => queueMicrotask(r));

    const backendB = await createIndexedDBBackend("shared-db", "kv");
    expect(backendB.getItem("shared-key")).toBe("shared-value");
  });

  it("getItem returns null after removeItem even if IndexedDB still has stale data", async () => {
    const backend = await createIndexedDBBackend();
    backend.setItem("stale", "data");
    backend.removeItem("stale");
    expect(backend.getItem("stale")).toBeNull();
  });

  it("handles large number of keys", async () => {
    const backend = await createIndexedDBBackend();
    for (let i = 0; i < 100; i++) {
      backend.setItem(`key-${i}`, `value-${i}`);
    }
    expect(backend.getAllKeys()).toHaveLength(100);
  });

  it("custom dbName and storeName work correctly", async () => {
    const backend = await createIndexedDBBackend("my-custom-db", "my-store");
    backend.setItem("custom", "works");
    expect(backend.getItem("custom")).toBe("works");
  });

  it("supports getMany, setMany, removeMany, and size", async () => {
    const backend = await createIndexedDBBackend();

    backend.setMany?.([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(backend.size?.()).toBe(2);
    expect(backend.getMany?.(["a", "b", "c"])).toEqual(["1", "2", null]);

    backend.removeMany?.(["a", "b"]);
    expect(backend.size?.()).toBe(0);
  });

  it("flush waits for queued writes to settle", async () => {
    const backend = await createIndexedDBBackend("flush-db", "kv");
    backend.setItem("flush-key", "value");
    await backend.flush?.();

    const fresh = await createIndexedDBBackend("flush-db", "kv");
    expect(fresh.getItem("flush-key")).toBe("value");
  });

  it("broadcasts external updates across backend instances", async () => {
    const backendA = await createIndexedDBBackend("sync-db", "kv");
    const backendB = await createIndexedDBBackend("sync-db", "kv");
    const listener = jest.fn();
    backendB.subscribe?.(listener);

    backendA.setItem("shared", "value");
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(backendB.getItem("shared")).toBe("value");
    expect(listener).toHaveBeenCalledWith({
      key: "shared",
      newValue: "value",
    });
  });

  it("surfaces async queue failures through onError", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      value: {
        open() {
          const db = {
            objectStoreNames: {
              contains: () => true,
            },
            createObjectStore() {
              return {};
            },
            transaction(_storeName: string, mode: IDBTransactionMode) {
              if (mode === "readwrite") {
                throw new Error("write failed");
              }
              return {
                objectStore() {
                  return {
                    openCursor() {
                      const request = {
                        result: null,
                        onsuccess: null as ((event: Event) => void) | null,
                      };
                      queueMicrotask(() => request.onsuccess?.({} as Event));
                      return request;
                    },
                  };
                },
                set oncomplete(callback: (() => void) | null) {
                  queueMicrotask(() => callback?.());
                },
                set onerror(_callback: ((event: Event) => void) | null) {},
              };
            },
          };

          const request = {
            result: db,
            error: null,
            onupgradeneeded: null as
              | ((event: IDBVersionChangeEvent) => void)
              | null,
            onsuccess: null as ((event: Event) => void) | null,
            onerror: null as ((event: Event) => void) | null,
          };
          queueMicrotask(() => request.onsuccess?.({} as Event));
          return request;
        },
      },
      writable: true,
      configurable: true,
    });

    const onError = jest.fn();
    const backend = await createIndexedDBBackend("err-db", "kv", { onError });

    backend.setItem("key", "value");

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    await expect(backend.flush?.()).rejects.toThrow(
      'Failed to queue IndexedDB write for "key".',
    );
    await expect(backend.flush?.()).resolves.toBeUndefined();
  });
});
