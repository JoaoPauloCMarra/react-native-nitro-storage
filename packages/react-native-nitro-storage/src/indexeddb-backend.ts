import type {
  WebSecureStorageBackend,
  WebStorageChangeEvent,
} from "./web-storage-backend";

const DEFAULT_DB_NAME = "nitro-storage-secure";
const DEFAULT_STORE_NAME = "keyvalue";
const DB_VERSION = 1;

export type IndexedDBBackendOptions = {
  channelName?: string;
  onError?: (error: Error) => void;
};

/**
 * Opens (or creates) an IndexedDB database and returns the underlying IDBDatabase.
 * Rejects if IndexedDB is unavailable in the current environment.
 */
function openDB(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }

    const request = indexedDB.open(dbName, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB database."));
  });
}

/**
 * Creates a `WebSecureStorageBackend` backed by IndexedDB.
 *
 * IndexedDB is async, but `WebSecureStorageBackend` requires a synchronous
 * interface. This implementation bridges the gap with a write-through in-memory
 * cache:
 *
 * - **Reads** are always served from the in-memory cache (synchronous, O(1)).
 * - **Writes** update the cache synchronously, then persist to IndexedDB
 *   asynchronously in the background.
 * - **Initialisation**: the returned backend pre-loads all persisted entries
 *   from IndexedDB into memory before resolving, so the first synchronous read
 *   after `await createIndexedDBBackend()` already returns the correct value.
 *
 * @param dbName    Name of the IndexedDB database. Defaults to `"nitro-storage-secure"`.
 * @param storeName Name of the object store inside the database. Defaults to `"keyvalue"`.
 *
 * @example
 * ```ts
 * import { setWebSecureStorageBackend } from "react-native-nitro-storage";
 * import { createIndexedDBBackend } from "react-native-nitro-storage/indexeddb-backend";
 *
 * const backend = await createIndexedDBBackend();
 * setWebSecureStorageBackend(backend);
 * ```
 */
export async function createIndexedDBBackend(
  dbName = DEFAULT_DB_NAME,
  storeName = DEFAULT_STORE_NAME,
  options: IndexedDBBackendOptions = {},
): Promise<WebSecureStorageBackend> {
  const db = await openDB(dbName, storeName);
  const cache = new Map<string, string>();
  const pendingWrites = new Set<Promise<void>>();
  const pendingErrors: Error[] = [];
  const subscribers = new Set<(event: WebStorageChangeEvent) => void>();
  const sourceId = `nitro-storage-${Math.random().toString(36).slice(2)}`;
  const channelName =
    options.channelName ?? `nitro-storage:${dbName}:${storeName}`;
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(channelName)
      : null;

  function emitExternal(event: WebStorageChangeEvent): void {
    subscribers.forEach((subscriber) => {
      subscriber(event);
    });
  }

  function handleAsyncError(error: unknown): void {
    const normalized =
      error instanceof Error
        ? error
        : new Error(String(error ?? "Unknown IndexedDB error"));
    pendingErrors.push(normalized);
    options.onError?.(normalized);
  }

  channel?.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as
      | (WebStorageChangeEvent & { sourceId?: string })
      | undefined;
    if (!data || data.sourceId === sourceId) {
      return;
    }

    if (data.key === null) {
      cache.clear();
    } else if (data.newValue === null) {
      cache.delete(data.key);
    } else {
      cache.set(data.key, data.newValue);
    }

    emitExternal({
      key: data.key,
      newValue: data.newValue,
    });
  });

  function publish(event: WebStorageChangeEvent): void {
    channel?.postMessage({
      ...event,
      sourceId,
    });
  }

  // Hydrate the in-memory cache from IndexedDB.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const value = cursor.value as unknown;
        if (typeof value === "string") {
          cache.set(String(cursor.key), value);
        }
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("Failed to load IndexedDB entries."));
  });

  function trackWrite(tx: IDBTransaction): void {
    const pending = new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        handleAsyncError(
          tx.error ?? new Error("Failed to persist IndexedDB transaction."),
        );
        resolve();
      };
      tx.onabort = () => {
        handleAsyncError(
          tx.error ?? new Error("IndexedDB transaction was aborted."),
        );
        resolve();
      };
    });
    pendingWrites.add(pending);
    void pending.finally(() => {
      pendingWrites.delete(pending);
    });
  }

  /** Fire-and-forget IndexedDB write. The in-memory cache remains authoritative,
   *  but async persistence failures are surfaced through `onError` and `flush()`. */
  function persistSet(key: string, value: string): void {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value, key);
      trackWrite(tx);
    } catch {
      handleAsyncError(
        new Error(`Failed to queue IndexedDB write for "${key}".`),
      );
    }
  }

  function persistDelete(key: string): void {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      trackWrite(tx);
    } catch {
      handleAsyncError(
        new Error(`Failed to queue IndexedDB delete for "${key}".`),
      );
    }
  }

  function persistClear(): void {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      trackWrite(tx);
    } catch {
      handleAsyncError(new Error("Failed to queue IndexedDB clear."));
    }
  }

  const backend: WebSecureStorageBackend = {
    name: `indexeddb:${dbName}/${storeName}`,
    getItem(key: string): string | null {
      return cache.get(key) ?? null;
    },

    setItem(key: string, value: string): void {
      cache.set(key, value);
      persistSet(key, value);
      publish({ key, newValue: value });
    },

    removeItem(key: string): void {
      cache.delete(key);
      persistDelete(key);
      publish({ key, newValue: null });
    },

    clear(): void {
      cache.clear();
      persistClear();
      publish({ key: null, newValue: null });
    },

    getAllKeys(): string[] {
      return Array.from(cache.keys());
    },
    getMany(keys: string[]): (string | null)[] {
      return keys.map((key) => cache.get(key) ?? null);
    },
    setMany(entries): void {
      entries.forEach(([key, value]) => {
        cache.set(key, value);
      });
      try {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        entries.forEach(([key, value]) => {
          store.put(value, key);
          publish({ key, newValue: value });
        });
        trackWrite(tx);
      } catch {
        handleAsyncError(new Error("Failed to queue IndexedDB batch write."));
      }
    },
    removeMany(keys: string[]): void {
      keys.forEach((key) => {
        cache.delete(key);
      });
      try {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        keys.forEach((key) => {
          store.delete(key);
          publish({ key, newValue: null });
        });
        trackWrite(tx);
      } catch {
        handleAsyncError(new Error("Failed to queue IndexedDB batch delete."));
      }
    },
    size(): number {
      return cache.size;
    },
    subscribe(listener): () => void {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    async flush(): Promise<void> {
      await Promise.all(Array.from(pendingWrites));
      if (pendingErrors.length === 0) {
        return;
      }

      const [error] = pendingErrors.splice(0);
      throw error;
    },
  };

  return backend;
}
