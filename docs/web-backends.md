# Web Backends

Nitro Storage runs on web through synchronous backend contracts. Disk and Secure scopes can use different backends.

The default web backend is localStorage-style. Configure custom backends when you need IndexedDB persistence, tests with isolated storage, cross-tab sync, or a platform-specific secret wrapper.

Register a separate backend instance for each scope. If one instance is registered for both scopes, Disk enumeration skips the `__secure_` and `__bio_` keys that Secure scope writes, and each scope's `clear()` removes only its own keys, but separate stores keep the scopes fully isolated.

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
- `close()`
- `name`

`subscribe(listener)` should report `{ key, newValue }` changes. Use `key: null` when the whole backend is cleared.

`close()` should release backend-owned resources such as database handles or broadcast channels. A replaced backend is retired instead of closed on the spot: `flushWebStorageBackends()` flushes it and then closes it, so queued async writes can commit before the connection goes away. Backends without `flush()` are closed immediately on replacement, and a retired backend whose flush fails stays retired for a later explicit retry.

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

The IndexedDB backend exposes `close()` and rejects later synchronous operations after it is closed.

### Persistence Lifecycle

IndexedDB transactions cannot block a page unload, so in-flight writes may be aborted when the page closes. The backend does not install `pagehide` or `visibilitychange` handlers, because there is no synchronous way to finish a pending transaction there. `flush()` awaits every pending transaction. When persistence fails, `flush()` throws an error that names the affected keys, and `onError` receives each individual failure.

```ts
const backend = await createIndexedDBBackend("app-secure", "keyvalue", {
  onError: (error) => {
    console.error("IndexedDB secure storage failed", error);
  },
});

// Before assertions, navigation, or lifecycle boundaries:
await flushWebStorageBackends();
```

Treat IndexedDB persistence as best-effort under abrupt termination: keep a durable copy of critical values elsewhere if they must survive an immediate page close.

## Cross-tab Updates

The IndexedDB backend uses `BroadcastChannel` when available. Other tabs receive cache invalidation events and update their in-memory copy. Messages that arrive while a new backend is still loading its snapshot are applied after the snapshot, so they are not overwritten.

The window `storage` event updates a scope only while that scope uses the default `localStorage` backend, and only for events from `localStorage`. Custom backends must sync through `subscribe(listener)`.

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
