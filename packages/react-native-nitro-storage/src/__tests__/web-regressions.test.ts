import {
  createStorageItem,
  setWebDiskStorageBackend,
  setWebSecureStorageBackend,
  storage,
  StorageScope,
} from "../index.web";
import type { WebStorageBackend } from "../web-storage-backend";

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
  const backend: WebStorageBackend & { store: Map<string, string> } = {
    name,
    store,
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
