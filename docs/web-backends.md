# Web Backends

Nitro Storage runs on web through synchronous backend contracts. Disk and Secure scopes can use different backends.

The default web backend is localStorage-style. Configure custom backends when you need IndexedDB persistence, tests with isolated storage, cross-tab sync, or a platform-specific secret wrapper.

## Backend Contract

```ts
import type { WebStorageBackend } from "react-native-nitro-storage";

const backend: WebStorageBackend = {
  name: "memory-test-backend",
  getItem: (key) => map.get(key) ?? null,
  setItem: (key, value) => {
    map.set(key, value);
  },
  removeItem: (key) => {
    map.delete(key);
  },
  clear: () => {
    map.clear();
  },
  getAllKeys: () => Array.from(map.keys()),
};
```

Optional methods improve performance and observability:

- `getMany(keys)`
- `setMany(entries)`
- `removeMany(keys)`
- `size()`
- `subscribe(listener)`
- `flush()`
- `name`

`subscribe(listener)` should report `{ key, newValue }` changes. Use `key: null` when the whole backend is cleared.

## Disk Backend

```ts
import {
  setWebDiskStorageBackend,
  storage,
  StorageScope,
} from "react-native-nitro-storage";

setWebDiskStorageBackend(backend);
storage.setString("theme", "dark", StorageScope.Disk);
```

## Secure Backend

```ts
import {
  setWebSecureStorageBackend,
  storage,
  StorageScope,
} from "react-native-nitro-storage";

setWebSecureStorageBackend(backend);
storage.setString("auth:refreshToken", "opaque-token", StorageScope.Secure);
```

Web Secure storage is only as strong as the configured backend. Browser storage does not provide iOS Keychain or Android Keystore guarantees.

## Flush Pending Web Writes

Backends may persist asynchronously while serving reads synchronously from memory. Use `flushWebStorageBackends()` before assertions or page lifecycle boundaries.

```ts
import { flushWebStorageBackends } from "react-native-nitro-storage";

await flushWebStorageBackends();
```

## IndexedDB Secure Backend

`createIndexedDBBackend()` returns a `WebSecureStorageBackend` with a synchronous in-memory cache and asynchronous IndexedDB persistence.

```ts
import { setWebSecureStorageBackend } from "react-native-nitro-storage";
import { createIndexedDBBackend } from "react-native-nitro-storage/indexeddb-backend";

const backend = await createIndexedDBBackend("app-secure", "keyvalue", {
  channelName: "app-secure-sync",
  onError: (error) => {
    console.error("IndexedDB secure storage failed", error);
  },
});

setWebSecureStorageBackend(backend);
```

Reads are synchronous because they are served from memory after initial load. Writes update memory first and persist to IndexedDB in the background.

## Cross-tab Updates

The IndexedDB backend uses `BroadcastChannel` when available. Other tabs receive cache invalidation events and update their in-memory copy.

If you provide your own backend, implement `subscribe(listener)` to keep Nitro Storage caches aligned with external writes.

## Testing Backend

```ts
import type { WebStorageBackend } from "react-native-nitro-storage";

export function createMemoryBackend(): WebStorageBackend {
  const values = new Map<string, string>();
  const listeners = new Set<
    (event: { key: string | null; newValue: string | null }) => void
  >();

  function emit(key: string | null, newValue: string | null) {
    listeners.forEach((listener) => listener({ key, newValue }));
  }

  return {
    name: "memory",
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
      emit(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
      emit(key, null);
    },
    clear: () => {
      values.clear();
      emit(null, null);
    },
    getAllKeys: () => Array.from(values.keys()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```
