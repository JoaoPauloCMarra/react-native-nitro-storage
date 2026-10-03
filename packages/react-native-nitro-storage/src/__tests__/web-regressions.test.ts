import {
  createStorageItem,
  setWebDiskStorageBackend,
  setWebSecureStorageBackend,
  storage,
  StorageScope,
} from "../index.web";
import type {
  WebStorageBackend,
  WebStorageChangeEvent,
} from "../web-storage-backend";
import type { StorageChangeEvent } from "../storage-events";

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

function createMapBackend(name: string) {
  const store = new Map<string, string>();
  const subscribers = new Set<(event: WebStorageChangeEvent) => void>();
  const backend: WebStorageBackend & {
    store: Map<string, string>;
    emitExternal: (event: WebStorageChangeEvent) => void;
    notifyOnly: (event: WebStorageChangeEvent) => void;
  } = {
    name,
    store,
    notifyOnly: (event) => {
      subscribers.forEach((listener) => listener(event));
    },
    emitExternal: (event) => {
      if (event.key === null) {
        store.clear();
      } else if (event.newValue === null) {
        store.delete(event.key);
      } else {
        store.set(event.key, event.newValue);
      }
      subscribers.forEach((listener) => listener(event));
    },
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    getAllKeys: () => Array.from(store.keys()),
    removeMany: (keys) => {
      keys.forEach((key) => store.delete(key));
    },
  };
  return backend;
}

const windowListeners = new Map<string, Set<(event: Event) => void>>();
const windowMock = {
  addEventListener(type: string, listener: (event: Event) => void) {
    const set = windowListeners.get(type) ?? new Set();
    set.add(listener);
    windowListeners.set(type, set);
  },
  removeEventListener(type: string, listener: (event: Event) => void) {
    windowListeners.get(type)?.delete(listener);
  },
  dispatchEvent(event: Event) {
    windowListeners.get(event.type)?.forEach((listener) => listener(event));
    return true;
  },
};

function dispatchStorageEvent(
  key: string | null,
  newValue: string | null,
  storageArea: unknown = globalThis.localStorage,
): void {
  const event = new Event("storage") as Event & {
    key: string | null;
    newValue: string | null;
    storageArea: unknown;
  };
  event.key = key;
  event.newValue = newValue;
  event.storageArea = storageArea;
  windowMock.dispatchEvent(event);
}

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    value: windowMock,
    configurable: true,
    writable: true,
  });
});

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: createStorageMock(),
    configurable: true,
    writable: true,
  });
  setWebDiskStorageBackend(undefined);
  setWebSecureStorageBackend(undefined);
  storage.clearAll();
});

afterAll(() => {
  setWebDiskStorageBackend(undefined);
  setWebSecureStorageBackend(undefined);
});

describe("public scheduled flush error observer", () => {
  it.each([StorageScope.Disk, StorageScope.Secure])(
    "reports a buffered %s failure through the public API and retries",
    async (scope) => {
      const backend = createMapBackend("indexeddb:observer-fixture");
      const persist = backend.setItem;
      const write = jest.spyOn(backend, "setItem");
      const failure = new Error("[nitro-error:storage_full] fixture full");
      write.mockImplementationOnce(() => {
        throw failure;
      });
      if (scope === StorageScope.Disk) setWebDiskStorageBackend(backend);
      else setWebSecureStorageBackend(backend);
      const item = createStorageItem({
        key: "scheduled-observer",
        scope,
        defaultValue: "",
        coalesceDiskWrites: true,
        coalesceSecureWrites: true,
      });
      const observer = jest.fn();
      storage.setScheduledFlushErrorObserver(observer);
      try {
        item.set("retained");
        await Promise.resolve();
        expect(observer).toHaveBeenCalledTimes(1);
        expect(observer.mock.calls[0]?.[0]).toMatchObject({ scope });
        expect(String(observer.mock.calls[0]?.[0].error)).toContain(
          "fixture full",
        );
        expect(backend.store.size).toBe(0);
        expect(item.get()).toBe("retained");

        write.mockImplementation(persist);
        if (scope === StorageScope.Disk) storage.flushDiskWrites();
        else storage.flushSecureWrites();
        expect(backend.store.size).toBe(1);
        expect(observer).toHaveBeenCalledTimes(1);
      } finally {
        write.mockImplementation(persist);
        storage.setScheduledFlushErrorObserver(undefined);
        if (scope === StorageScope.Disk) storage.flushDiskWrites();
        else storage.flushSecureWrites();
        item.delete();
      }
    },
  );
});

describe("one backend shared by Disk and Secure", () => {
  function setupShared() {
    const backend = createMapBackend("shared");
    setWebDiskStorageBackend(backend);
    setWebSecureStorageBackend(backend);
    const token = createStorageItem({
      key: "token",
      scope: StorageScope.Secure,
      defaultValue: "",
    });
    const theme = createStorageItem({
      key: "theme",
      scope: StorageScope.Disk,
      defaultValue: "",
    });
    token.set("s3cret");
    theme.set("dark");
    return { backend, token, theme };
  }

  it("keeps secure keys out of Disk enumeration and export", () => {
    setupShared();

    expect(storage.getAllKeys(StorageScope.Disk)).toEqual(["theme"]);
    expect(storage.size(StorageScope.Disk)).toBe(1);
    expect(storage.export(StorageScope.Disk)).toEqual({
      theme: expect.any(String),
    });
    expect(storage.has("__secure_token", StorageScope.Disk)).toBe(false);
  });

  it("clear(Disk) keeps Secure values", () => {
    const { token, theme } = setupShared();

    storage.clear(StorageScope.Disk);

    expect(theme.get()).toBe("");
    expect(token.get()).toBe("s3cret");
  });

  it("clear(Secure) keeps Disk values", () => {
    const { token, theme } = setupShared();

    storage.clear(StorageScope.Secure);

    expect(token.get()).toBe("");
    expect(theme.get()).toBe("dark");
  });
});

describe("subscribe events from one shared backend", () => {
  it("keeps other-tab secure writes out of Disk", () => {
    const backend = createMapBackend("shared-sub");
    setWebDiskStorageBackend(backend);
    setWebSecureStorageBackend(backend);
    storage.setString("theme", "dark", StorageScope.Disk);
    storage.getAllKeys(StorageScope.Secure);
    const diskEvents: StorageChangeEvent[] = [];
    const secureEvents: StorageChangeEvent[] = [];
    const unsubscribeDisk = storage.subscribe(StorageScope.Disk, (event) =>
      diskEvents.push(event),
    );
    const unsubscribeSecure = storage.subscribe(StorageScope.Secure, (event) =>
      secureEvents.push(event),
    );

    backend.emitExternal({ key: "__secure_token", newValue: "s3cret" });

    expect(storage.getAllKeys(StorageScope.Disk)).toEqual(["theme"]);
    expect(Object.keys(storage.export(StorageScope.Disk))).toEqual(["theme"]);
    expect(diskEvents).toEqual([]);
    expect(storage.getAllKeys(StorageScope.Secure)).toEqual(["token"]);
    expect(secureEvents).toHaveLength(1);

    backend.emitExternal({ key: "other-tab-disk", newValue: "v" });
    expect(storage.getAllKeys(StorageScope.Secure)).toEqual(["token"]);
    expect(secureEvents).toHaveLength(1);
    expect(storage.getAllKeys(StorageScope.Disk).sort()).toEqual([
      "other-tab-disk",
      "theme",
    ]);
    unsubscribeDisk();
    unsubscribeSecure();
  });

  it("re-reads each scope's keys when the shared backend reports a clear", () => {
    const backend = createMapBackend("shared-clear");
    setWebDiskStorageBackend(backend);
    setWebSecureStorageBackend(backend);
    storage.setString("theme", "dark", StorageScope.Disk);
    storage.setString("token", "t", StorageScope.Secure);
    backend.store.delete("theme");

    backend.notifyOnly({ key: null, newValue: null });

    expect(storage.getAllKeys(StorageScope.Disk)).toEqual([]);
    expect(storage.getAllKeys(StorageScope.Secure)).toEqual(["token"]);
  });
});

describe("window storage events", () => {
  it("ignores localStorage events when Disk uses a custom backend", () => {
    const backend = createMapBackend("indexeddb:custom");
    setWebDiskStorageBackend(backend);
    const item = createStorageItem({
      key: "foreign",
      scope: StorageScope.Disk,
      defaultValue: "none",
      readCache: true,
    });
    expect(storage.has("foreign", StorageScope.Disk)).toBe(false);

    dispatchStorageEvent("foreign", "zzz");

    expect(storage.has("foreign", StorageScope.Disk)).toBe(false);
    expect(item.get()).toBe("none");
  });

  it("ignores a foreign localStorage.clear() when Disk uses a custom backend", () => {
    const backend = createMapBackend("indexeddb:custom");
    setWebDiskStorageBackend(backend);
    storage.setString("theme", "dark", StorageScope.Disk);

    dispatchStorageEvent(null, null);

    expect(storage.getAllKeys(StorageScope.Disk)).toEqual(["theme"]);
  });

  it("ignores events from a storage area other than localStorage", () => {
    storage.getAllKeys(StorageScope.Disk);

    dispatchStorageEvent("session-key", "v", { other: true });

    expect(storage.has("session-key", StorageScope.Disk)).toBe(false);
  });

  it("applies localStorage events to the default backend", () => {
    storage.getAllKeys(StorageScope.Disk);
    globalThis.localStorage.setItem("tab-key", "v");

    dispatchStorageEvent("tab-key", "v");

    expect(storage.has("tab-key", StorageScope.Disk)).toBe(true);
  });
});
