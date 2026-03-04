import type { WebSecureStorageBackend } from "./index.web";

const DEFAULT_DB_NAME = "nitro-storage-secure";
const DEFAULT_STORE_NAME = "keyvalue";
const DB_VERSION = 1;

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
): Promise<WebSecureStorageBackend> {
  const db = await openDB(dbName, storeName);
  const cache = new Map<string, string>();

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

  /** Fire-and-forget IndexedDB write. Errors are silently ignored to avoid
   *  breaking the synchronous caller — the in-memory cache is always authoritative. */
  function persistSet(key: string, value: string): void {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value, key);
    } catch {
      // Best-effort; cache is the source of truth.
    }
  }

  function persistDelete(key: string): void {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
    } catch {
      // Best-effort.
    }
  }

  function persistClear(): void {
    try {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
    } catch {
      // Best-effort.
    }
  }

  const backend: WebSecureStorageBackend = {
    getItem(key: string): string | null {
      return cache.get(key) ?? null;
    },

    setItem(key: string, value: string): void {
      cache.set(key, value);
      persistSet(key, value);
    },

    removeItem(key: string): void {
      cache.delete(key);
      persistDelete(key);
    },

    clear(): void {
      cache.clear();
      persistClear();
    },

    getAllKeys(): string[] {
      return Array.from(cache.keys());
    },
  };

  return backend;
}
