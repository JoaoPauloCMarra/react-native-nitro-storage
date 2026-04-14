import { act, renderHook } from "@testing-library/react-hooks";
import {
  createStorageItem,
  createSecureAuthStorage,
  flushWebStorageBackends,
  getBatch,
  getStorageErrorCode,
  getWebDiskStorageBackend,
  getWebSecureStorageBackend,
  migrateFromMMKV,
  migrateToLatest,
  registerMigration,
  removeBatch,
  runTransaction,
  setWebDiskStorageBackend,
  setWebSecureStorageBackend,
  setBatch,
  storage,
  type StorageMetricsEvent,
  StorageScope,
  AccessControl,
  BiometricLevel,
  useSetStorage,
  useStorageSelector,
  useStorage,
} from "../index.web";
import type { StorageItem } from "../index.web";
import type {
  WebStorageBackend,
  WebStorageChangeEvent,
} from "../web-storage-backend";
import {
  MIGRATION_VERSION_KEY,
  serializeWithPrimitiveFastPath,
} from "../internal";

beforeEach(() => {
  storage.setDiskWritesAsync(false);
});

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

function createWebBackendMock(name = "mock-backend") {
  const secureStore = new Map<string, string>();
  const subscribers = new Set<(event: WebStorageChangeEvent) => void>();
  const emit = (event: WebStorageChangeEvent) => {
    if (event.key === null) {
      secureStore.clear();
    } else if (event.newValue === null) {
      secureStore.delete(event.key);
    } else {
      secureStore.set(event.key, event.newValue);
    }
    subscribers.forEach((subscriber) => {
      subscriber(event);
    });
  };
  return {
    name,
    getItem: jest.fn((key: string) => secureStore.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      secureStore.set(key, value);
    }),
    removeItem: jest.fn((key: string) => {
      secureStore.delete(key);
    }),
    clear: jest.fn(() => {
      secureStore.clear();
    }),
    getAllKeys: jest.fn(() => Array.from(secureStore.keys())),
    getMany: jest.fn((keys: string[]) =>
      keys.map((key) => secureStore.get(key) ?? null),
    ),
    setMany: jest.fn((entries: ReadonlyArray<readonly [string, string]>) => {
      entries.forEach(([key, value]) => {
        secureStore.set(key, value);
      });
    }),
    removeMany: jest.fn((keys: string[]) => {
      keys.forEach((key) => {
        secureStore.delete(key);
      });
    }),
    size: jest.fn(() => secureStore.size),
    subscribe: jest.fn((listener: (event: WebStorageChangeEvent) => void) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    }),
    flush: jest.fn(async () => {}),
    emit,
  };
}

function createThrowingBackendMock(
  message = "quota exceeded",
): WebStorageBackend {
  return {
    name: "throwing-backend",
    getItem() {
      throw new Error(message);
    },
    setItem() {
      throw new Error(message);
    },
    removeItem() {
      throw new Error(message);
    },
    clear() {
      throw new Error(message);
    },
    getAllKeys() {
      throw new Error(message);
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

function dispatchStorageEvent(
  key: string | null,
  newValue: string | null,
): void {
  const storageEvent = new Event("storage") as Event & {
    key: string | null;
    newValue: string | null;
  };
  storageEvent.key = key;
  storageEvent.newValue = newValue;
  window.dispatchEvent(storageEvent);
}

describe("Web Storage", () => {
  let migrationVersionSeed = 2_000;

  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});

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

    setWebSecureStorageBackend(undefined);
    storage.clearAll();
    storage.setMetricsObserver(undefined);
    storage.resetMetrics();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it("does not read current value when setting a direct value", () => {
    const item = createStorageItem({
      key: "web-set-no-read",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });
    const getSpy = jest.spyOn(globalThis.localStorage, "getItem");

    item.set("next");

    expect(getSpy).not.toHaveBeenCalled();
    expect(globalThis.localStorage.getItem("web-set-no-read")).toBe(
      serializeWithPrimitiveFastPath("next"),
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

  it("coalesces disk writes until flush when configured per item", () => {
    const diskItem = createStorageItem({
      key: "web-coalesce-disk",
      scope: StorageScope.Disk,
      defaultValue: "",
      coalesceDiskWrites: true,
    });

    diskItem.set("queued-web-disk");

    expect(globalThis.localStorage.getItem("web-coalesce-disk")).toBeNull();
    expect(diskItem.get()).toBe("queued-web-disk");

    storage.flushDiskWrites();

    expect(globalThis.localStorage.getItem("web-coalesce-disk")).toBe(
      serializeWithPrimitiveFastPath("queued-web-disk"),
    );
  });

  it("queues raw disk writes when disk async mode is enabled", () => {
    storage.setDiskWritesAsync(true);

    storage.setString("web-async-disk", "queued", StorageScope.Disk);

    expect(globalThis.localStorage.getItem("web-async-disk")).toBeNull();
    expect(storage.getString("web-async-disk", StorageScope.Disk)).toBe(
      "queued",
    );

    storage.flushDiskWrites();

    expect(globalThis.localStorage.getItem("web-async-disk")).toBe("queued");
  });

  it("exposes web capability metadata", () => {
    const capabilities = storage.getCapabilities();

    expect(capabilities.platform).toBe("web");
    expect(capabilities.writeBuffering.disk).toBe(true);
    expect(capabilities.writeBuffering.secure).toBe(true);
    expect(capabilities.backend.disk).toContain("disk");
    expect(capabilities.backend.secure).toContain("secure");
  });

  it("classifies storage errors into stable codes", () => {
    expect(
      getStorageErrorCode(
        new Error("[nitro-error:keychain_locked] NitroStorage: locked"),
      ),
    ).toBe("keychain_locked");
    expect(
      getStorageErrorCode(
        new Error(
          "[nitro-error:authentication_required] NitroStorage: auth required",
        ),
      ),
    ).toBe("authentication_required");
    expect(getStorageErrorCode(new Error("errSecInteractionNotAllowed"))).toBe(
      "keychain_locked",
    );
    expect(
      getStorageErrorCode(new Error("UserNotAuthenticatedException")),
    ).toBe("authentication_required");
    expect(getStorageErrorCode(new Error("AEADBadTagException"))).toBe(
      "storage_corruption",
    );
    expect(
      getStorageErrorCode(new Error("Biometric storage unavailable")),
    ).toBe("biometric_unavailable");
    expect(getStorageErrorCode(new Error("something else"))).toBe(undefined);
  });

  it("supports a custom web secure backend", () => {
    const backend = createWebBackendMock();
    setWebSecureStorageBackend(backend);

    const secureItem = createStorageItem({
      key: "secure-custom-backend",
      scope: StorageScope.Secure,
      defaultValue: "default",
    });
    secureItem.set("custom");

    expect(backend.setItem).toHaveBeenCalledWith(
      "__secure_secure-custom-backend",
      serializeWithPrimitiveFastPath("custom"),
    );
    expect(
      globalThis.localStorage.getItem("__secure_secure-custom-backend"),
    ).toBe(null);
    expect(getWebSecureStorageBackend()).toBe(backend);
  });

  it("supports biometricLevel with secure writes on web backend", () => {
    const backend = createWebBackendMock();
    setWebSecureStorageBackend(backend);

    const biometricItem = createStorageItem({
      key: "web-bio-level",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometricLevel: BiometricLevel.BiometryOrPasscode,
    });
    biometricItem.set("secret");

    expect(backend.setItem).toHaveBeenCalledWith(
      "__bio_web-bio-level",
      serializeWithPrimitiveFastPath("secret"),
    );
  });

  it("supports getWithVersion and setIfVersion on web items", () => {
    const item = createStorageItem({
      key: "web-versioned",
      scope: StorageScope.Disk,
      defaultValue: 0,
    });

    const snapshot = item.getWithVersion();
    expect(snapshot.value).toBe(0);

    const firstWrite = item.setIfVersion(snapshot.version, 1);
    expect(firstWrite).toBe(true);

    globalThis.localStorage.setItem(
      "web-versioned",
      serializeWithPrimitiveFastPath(2),
    );
    const staleWrite = item.setIfVersion(snapshot.version, 3);
    expect(staleWrite).toBe(false);
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

  it("uses per-item cache behavior in mixed web getBatch reads", () => {
    const getSpy = jest.spyOn(globalThis.localStorage, "getItem");
    globalThis.localStorage.setItem(
      "mixed-web-cached",
      serializeWithPrimitiveFastPath("cached"),
    );
    globalThis.localStorage.setItem(
      "mixed-web-uncached",
      serializeWithPrimitiveFastPath("uncached"),
    );

    const cachedItem = createStorageItem({
      key: "mixed-web-cached",
      scope: StorageScope.Disk,
      defaultValue: "",
      readCache: true,
    });
    const uncachedItem = createStorageItem({
      key: "mixed-web-uncached",
      scope: StorageScope.Disk,
      defaultValue: "",
    });

    cachedItem.get();
    getSpy.mockClear();

    const values = getBatch([cachedItem, uncachedItem], StorageScope.Disk);
    expect(values).toEqual(["cached", "uncached"]);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith("mixed-web-uncached");
  });

  it("propagates cross-tab storage events to disk subscribers", () => {
    const item = createStorageItem({
      key: "cross-tab-disk",
      scope: StorageScope.Disk,
      defaultValue: "default",
      readCache: true,
    });
    const listener = jest.fn();
    item.subscribe(listener);

    globalThis.localStorage.setItem(
      "cross-tab-disk",
      serializeWithPrimitiveFastPath("updated"),
    );
    dispatchStorageEvent(
      "cross-tab-disk",
      serializeWithPrimitiveFastPath("updated"),
    );

    expect(listener).toHaveBeenCalled();
    expect(item.get()).toBe("updated");
  });

  it("propagates cross-tab storage events to secure subscribers", () => {
    const item = createStorageItem({
      key: "cross-tab-secure",
      scope: StorageScope.Secure,
      defaultValue: "default",
      readCache: true,
    });
    const listener = jest.fn();
    item.subscribe(listener);

    globalThis.localStorage.setItem(
      "__secure_cross-tab-secure",
      serializeWithPrimitiveFastPath("updated"),
    );
    dispatchStorageEvent(
      "__secure_cross-tab-secure",
      serializeWithPrimitiveFastPath("updated"),
    );

    expect(listener).toHaveBeenCalled();
    expect(item.get()).toBe("updated");
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

  it("coalesces secure writes with per-item access control on web", async () => {
    const item = createStorageItem({
      key: "web-secure-coalesce-access",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
      accessControl: AccessControl.AfterFirstUnlock,
    });

    item.set("value");
    await Promise.resolve();

    expect(
      globalThis.localStorage.getItem("__secure_web-secure-coalesce-access"),
    ).toBe(serializeWithPrimitiveFastPath("value"));
  });

  it("flushes pending secure writes on demand", () => {
    const item = createStorageItem({
      key: "web-secure-flush",
      scope: StorageScope.Secure,
      defaultValue: "default",
      coalesceSecureWrites: true,
    });

    item.set("queued");
    expect(
      globalThis.localStorage.getItem("__secure_web-secure-flush"),
    ).toBeNull();

    storage.flushSecureWrites();

    expect(globalThis.localStorage.getItem("__secure_web-secure-flush")).toBe(
      serializeWithPrimitiveFastPath("queued"),
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
      StorageScope.Disk,
    );

    const values = getBatch([item1, item2], StorageScope.Disk);
    expect(values).toEqual(["v1", "v2"]);

    removeBatch([item1, item2], StorageScope.Disk);
    expect(removeSpy).toHaveBeenCalledTimes(2);
  });

  it("removeBatch on secure scope removes secure and biometric entries", () => {
    const removeSpy = jest.spyOn(globalThis.localStorage, "removeItem");
    const secureItem = createStorageItem({
      key: "secure-remove-both",
      scope: StorageScope.Secure,
      defaultValue: "",
    });
    const biometricItem = createStorageItem({
      key: "secure-remove-both",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    secureItem.set("plain");
    biometricItem.set("bio");
    removeSpy.mockClear();

    removeBatch([secureItem], StorageScope.Secure);

    expect(removeSpy).toHaveBeenCalledWith("__secure_secure-remove-both");
    expect(removeSpy).toHaveBeenCalledWith("__bio_secure-remove-both");
    expect(secureItem.get()).toBe("");
    expect(biometricItem.get()).toBe("");
  });

  it("groups secure raw batch writes by access control", () => {
    const strictItem = createStorageItem({
      key: "web-secure-ac-1",
      scope: StorageScope.Secure,
      defaultValue: "",
      accessControl: AccessControl.AfterFirstUnlock,
    });
    const passcodeItem = createStorageItem({
      key: "web-secure-ac-2",
      scope: StorageScope.Secure,
      defaultValue: "",
      accessControl: AccessControl.WhenPasscodeSetThisDeviceOnly,
    });

    setBatch(
      [
        { item: strictItem, value: "v1" },
        { item: passcodeItem, value: "v2" },
      ],
      StorageScope.Secure,
    );

    expect(globalThis.localStorage.getItem("__secure_web-secure-ac-1")).toBe(
      serializeWithPrimitiveFastPath("v1"),
    );
    expect(globalThis.localStorage.getItem("__secure_web-secure-ac-2")).toBe(
      serializeWithPrimitiveFastPath("v2"),
    );
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

  it("reuses TTL parse cache while value is still valid", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const parseSpy = jest.spyOn(JSON, "parse");
    const item = createStorageItem<string>({
      key: "ttl-parse-cache-web",
      scope: StorageScope.Disk,
      defaultValue: "default",
      expiration: { ttlMs: 200 },
    });
    const envelope = JSON.stringify({
      __nitroStorageEnvelope: true,
      expiresAt: 1_100,
      payload: serializeWithPrimitiveFastPath("cached"),
    });
    globalThis.localStorage.setItem("ttl-parse-cache-web", envelope);

    expect(item.get()).toBe("cached");
    expect(item.get()).toBe("cached");
    expect(parseSpy).toHaveBeenCalledTimes(1);

    parseSpy.mockRestore();
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

  it("reuses web key index for repeated key and size lookups", () => {
    createStorageItem({
      key: "idx-1",
      scope: StorageScope.Disk,
      defaultValue: "",
    }).set("v1");
    createStorageItem({
      key: "idx-2",
      scope: StorageScope.Disk,
      defaultValue: "",
    }).set("v2");

    const keySpy = jest.spyOn(globalThis.localStorage, "key");
    storage.getAllKeys(StorageScope.Disk);
    keySpy.mockClear();

    const keys = storage.getAllKeys(StorageScope.Disk);
    const size = storage.size(StorageScope.Disk);

    expect(keys).toEqual(expect.arrayContaining(["idx-1", "idx-2"]));
    expect(size).toBeGreaterThanOrEqual(2);
    expect(keySpy).not.toHaveBeenCalled();
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

  it("storage.getKeysByPrefix and storage.getByPrefix return filtered snapshots", () => {
    createStorageItem({
      key: "token",
      scope: StorageScope.Disk,
      defaultValue: "",
      namespace: "session",
    }).set("a");
    createStorageItem({
      key: "user",
      scope: StorageScope.Disk,
      defaultValue: "",
      namespace: "session",
    }).set("b");
    createStorageItem({
      key: "other",
      scope: StorageScope.Disk,
      defaultValue: "",
      namespace: "profile",
    }).set("c");

    const keys = storage.getKeysByPrefix("session:", StorageScope.Disk);
    const entries = storage.getByPrefix("session:", StorageScope.Disk);

    expect(keys).toEqual(
      expect.arrayContaining(["session:token", "session:user"]),
    );
    expect(entries).toEqual({
      "session:token": serializeWithPrimitiveFastPath("a"),
      "session:user": serializeWithPrimitiveFastPath("b"),
    });
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

  it("exposes operation metrics and counter snapshots on web", () => {
    const events: StorageMetricsEvent[] = [];
    storage.setMetricsObserver((event) => events.push(event));
    storage.resetMetrics();

    const item = createStorageItem({
      key: "web-metrics-item",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });
    item.set("value");
    item.get();
    storage.getAllKeys(StorageScope.Disk);

    const snapshot = storage.getMetricsSnapshot();
    expect(events.length).toBeGreaterThan(0);
    expect(snapshot["item:set"]).toBeDefined();
    expect(snapshot["item:get"]).toBeDefined();
    expect(snapshot["storage:getAllKeys"]).toBeDefined();
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

  it("storage.clearNamespace uses indexed keys without localStorage scans", () => {
    createStorageItem({
      key: "a",
      scope: StorageScope.Disk,
      defaultValue: "",
      namespace: "session",
    }).set("v");
    createStorageItem({
      key: "keep",
      scope: StorageScope.Disk,
      defaultValue: "",
    }).set("v");

    storage.getAllKeys(StorageScope.Disk);
    const keySpy = jest.spyOn(globalThis.localStorage, "key");
    keySpy.mockClear();

    storage.clearNamespace("session", StorageScope.Disk);

    expect(keySpy).not.toHaveBeenCalled();
    expect(globalThis.localStorage.getItem("session:a")).toBeNull();
    expect(globalThis.localStorage.getItem("keep")).not.toBeNull();
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
    expect(() => storage.setSecureWritesAsync(true)).not.toThrow();
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

describe("storage.import (web)", () => {
  beforeEach(() => {
    storage.clearAll();
  });

  it("imports key-value pairs into Memory scope", () => {
    storage.import({ x: "1", y: "2" }, StorageScope.Memory);
    expect(storage.has("x", StorageScope.Memory)).toBe(true);
    expect(storage.has("y", StorageScope.Memory)).toBe(true);
  });

  it("emits change listeners for each imported key in Memory scope", () => {
    const item = createStorageItem({
      key: "web-imported",
      scope: StorageScope.Memory,
      defaultValue: "",
    });
    const listener = jest.fn();
    const unsub = item.subscribe(listener);

    storage.import({ "web-imported": "value" }, StorageScope.Memory);
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it("imports key-value pairs into Disk scope", () => {
    storage.import({ "d-key": "d-val" }, StorageScope.Disk);
    expect(globalThis.localStorage.getItem("d-key")).toBe("d-val");
  });

  it("is a no-op for an empty object", () => {
    const before = storage.size(StorageScope.Memory);
    storage.import({}, StorageScope.Memory);
    expect(storage.size(StorageScope.Memory)).toBe(before);
  });

  it("throws on invalid scope", () => {
    expect(() =>
      storage.import({ k: "v" }, 99 as unknown as StorageScope),
    ).toThrow(/Invalid storage scope/);
  });
});

describe("TTL expiry subscriber notification (web)", () => {
  beforeEach(() => {
    storage.clearAll();
  });

  it("notifies subscribers when a disk-scoped envelope expires on first read", () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(20_000);

    const item = createStorageItem<string>({
      key: "web-ttl-notify",
      scope: StorageScope.Disk,
      defaultValue: "fallback",
      expiration: { ttlMs: 500 },
    });

    // Pre-seed an already-expired envelope directly into localStorage
    globalThis.localStorage.setItem(
      "web-ttl-notify",
      JSON.stringify({
        __nitroStorageEnvelope: true,
        expiresAt: 19_000,
        payload: serializeWithPrimitiveFastPath("stale"),
      }),
    );

    const listener = jest.fn();
    const unsub = item.subscribe(listener);

    const value = item.get();
    expect(value).toBe("fallback");
    expect(listener).toHaveBeenCalled();

    unsub();
    nowSpy.mockRestore();
  });
});

describe("web backend switching", () => {
  beforeEach(() => {
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
    setWebDiskStorageBackend(undefined);
    setWebSecureStorageBackend(undefined);
    storage.clearAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("getWebSecureStorageBackend returns default backend when reset to undefined", () => {
    const custom = createWebBackendMock();
    setWebSecureStorageBackend(custom);
    expect(getWebSecureStorageBackend()).toBe(custom);

    // Resetting with undefined falls back to the default localStorage-based backend
    setWebSecureStorageBackend(undefined);
    const backend = getWebSecureStorageBackend();
    expect(backend).toBeDefined();
    expect(backend).not.toBe(custom);
  });

  it("getWebDiskStorageBackend returns default backend when reset to undefined", () => {
    const custom = createWebBackendMock("disk-backend");
    setWebDiskStorageBackend(custom);
    expect(getWebDiskStorageBackend()).toBe(custom);

    setWebDiskStorageBackend(undefined);
    const backend = getWebDiskStorageBackend();
    expect(backend).toBeDefined();
    expect(backend).not.toBe(custom);
  });

  it("setting a new backend allows secure writes to go to it", () => {
    const backend = createWebBackendMock();
    setWebSecureStorageBackend(backend);

    const secureItem = createStorageItem({
      key: "backend-write",
      scope: StorageScope.Secure,
      defaultValue: "",
    });
    secureItem.set("value");

    expect(backend.setItem).toHaveBeenCalledWith(
      "__secure_backend-write",
      serializeWithPrimitiveFastPath("value"),
    );
  });

  it("switching backend mid-session still reads from new backend", () => {
    const backendA = createWebBackendMock();
    setWebSecureStorageBackend(backendA);

    const secureItem = createStorageItem({
      key: "switch-read",
      scope: StorageScope.Secure,
      defaultValue: "default",
    });
    secureItem.set("from-a");

    const backendB = createWebBackendMock();
    // Seed backend B with the same key/value
    backendB.setItem(
      "__secure_switch-read",
      serializeWithPrimitiveFastPath("from-b"),
    );
    setWebSecureStorageBackend(backendB);

    expect(secureItem.get()).toBe("from-b");
    expect(backendB.getItem).toHaveBeenCalledWith("__secure_switch-read");
  });

  it("allows overriding the disk backend", () => {
    const backend = createWebBackendMock("disk-backend");
    setWebDiskStorageBackend(backend);

    const diskItem = createStorageItem({
      key: "disk-backend-write",
      scope: StorageScope.Disk,
      defaultValue: "",
    });
    diskItem.set("value");

    expect(backend.setItem).toHaveBeenCalledWith(
      "disk-backend-write",
      serializeWithPrimitiveFastPath("value"),
    );
    expect(globalThis.localStorage.getItem("disk-backend-write")).toBeNull();
  });

  it("uses batch backend hooks when available", () => {
    const backend = createWebBackendMock("disk-batch-backend");
    setWebDiskStorageBackend(backend);

    const a = createStorageItem({
      key: "disk-batch-a",
      scope: StorageScope.Disk,
      defaultValue: "",
    });
    const b = createStorageItem({
      key: "disk-batch-b",
      scope: StorageScope.Disk,
      defaultValue: "",
    });

    setBatch(
      [
        { item: a, value: "A" },
        { item: b, value: "B" },
      ],
      StorageScope.Disk,
    );
    getBatch([a, b], StorageScope.Disk);
    removeBatch([a, b], StorageScope.Disk);

    expect(backend.setMany).toHaveBeenCalled();
    expect(backend.getMany).toHaveBeenCalled();
    expect(backend.removeMany).toHaveBeenCalled();
  });

  it("flushWebStorageBackends awaits backend flush hooks", async () => {
    const diskBackend = createWebBackendMock("disk-flush");
    const secureBackend = createWebBackendMock("secure-flush");
    setWebDiskStorageBackend(diskBackend);
    setWebSecureStorageBackend(secureBackend);

    await flushWebStorageBackends();

    expect(diskBackend.flush).toHaveBeenCalled();
    expect(secureBackend.flush).toHaveBeenCalled();
  });

  it("wraps backend failures with scope-aware errors", () => {
    setWebDiskStorageBackend(createThrowingBackendMock("QuotaExceededError"));

    expect(() =>
      storage.setString("disk-failure", "value", StorageScope.Disk),
    ).toThrow(/NitroStorage\(web\): set failed for throwing-backend/);
  });

  it("applies backend subscribe events to disk item caches", () => {
    const backend = createWebBackendMock("disk-subscribe");
    setWebDiskStorageBackend(backend);

    const item = createStorageItem({
      key: "disk-sync",
      scope: StorageScope.Disk,
      defaultValue: "default",
      readCache: true,
    });
    const listener = jest.fn();

    item.subscribe(listener);
    backend.emit({
      key: "disk-sync",
      newValue: serializeWithPrimitiveFastPath("external"),
    });

    expect(item.get()).toBe("external");
    expect(listener).toHaveBeenCalled();
  });

  it("applies backend subscribe clear events to secure caches", () => {
    const backend = createWebBackendMock("secure-subscribe");
    setWebSecureStorageBackend(backend);

    const item = createStorageItem({
      key: "secure-sync",
      scope: StorageScope.Secure,
      defaultValue: "default",
      readCache: true,
    });

    item.set("cached");
    expect(item.get()).toBe("cached");

    backend.emit({
      key: null,
      newValue: null,
    });

    expect(item.get()).toBe("default");
  });
});

describe("cross-tab StorageEvent handling", () => {
  beforeEach(() => {
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
    setWebSecureStorageBackend(undefined);
    storage.clearAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("StorageEvent with null newValue removes key from cache", () => {
    const item = createStorageItem({
      key: "cross-tab-remove",
      scope: StorageScope.Disk,
      defaultValue: "default",
      readCache: true,
    });
    item.set("cached");
    expect(item.get()).toBe("cached");

    // Simulate external tab removing the key
    globalThis.localStorage.removeItem("cross-tab-remove");
    dispatchStorageEvent("cross-tab-remove", null);

    expect(item.get()).toBe("default");
  });

  it("StorageEvent with key=null (clear event) resets all cached values", () => {
    const item1 = createStorageItem({
      key: "clear-evt-1",
      scope: StorageScope.Disk,
      defaultValue: "d1",
      readCache: true,
    });
    const item2 = createStorageItem({
      key: "clear-evt-2",
      scope: StorageScope.Disk,
      defaultValue: "d2",
      readCache: true,
    });
    item1.set("v1");
    item2.set("v2");
    expect(item1.get()).toBe("v1");
    expect(item2.get()).toBe("v2");

    // Simulate external clear
    globalThis.localStorage.clear();
    dispatchStorageEvent(null, null);

    expect(item1.get()).toBe("d1");
    expect(item2.get()).toBe("d2");
  });

  it("listener fires on external StorageEvent update", () => {
    const item = createStorageItem({
      key: "cross-tab-listener",
      scope: StorageScope.Disk,
      defaultValue: "default",
      readCache: true,
    });
    const listener = jest.fn();
    item.subscribe(listener);

    globalThis.localStorage.setItem(
      "cross-tab-listener",
      serializeWithPrimitiveFastPath("external"),
    );
    dispatchStorageEvent(
      "cross-tab-listener",
      serializeWithPrimitiveFastPath("external"),
    );

    expect(listener).toHaveBeenCalled();
  });

  it("unsubscribed listener does not fire", () => {
    const item = createStorageItem({
      key: "cross-tab-unsub",
      scope: StorageScope.Disk,
      defaultValue: "default",
      readCache: true,
    });
    const listener = jest.fn();
    const unsub = item.subscribe(listener);
    unsub();

    globalThis.localStorage.setItem(
      "cross-tab-unsub",
      serializeWithPrimitiveFastPath("external"),
    );
    dispatchStorageEvent(
      "cross-tab-unsub",
      serializeWithPrimitiveFastPath("external"),
    );

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("biometric web storage", () => {
  beforeEach(() => {
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
    setWebSecureStorageBackend(undefined);
    storage.clearAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("setSecureBiometric stores value with biometric prefix", () => {
    const item = createStorageItem({
      key: "bio",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    item.set("biometric-secret");

    expect(globalThis.localStorage.getItem("__bio_bio")).toBe(
      serializeWithPrimitiveFastPath("biometric-secret"),
    );
    // Should NOT be stored under the regular secure prefix
    expect(globalThis.localStorage.getItem("__secure_bio")).toBeNull();
  });

  it("getSecureBiometric reads from biometric-prefixed key", () => {
    const item = createStorageItem({
      key: "bio",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    globalThis.localStorage.setItem(
      "__bio_bio",
      serializeWithPrimitiveFastPath("stored-bio"),
    );

    expect(item.get()).toBe("stored-bio");
  });

  it("deleteSecureBiometric removes biometric-prefixed key", () => {
    const item = createStorageItem({
      key: "bio",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    item.set("to-delete");
    expect(globalThis.localStorage.getItem("__bio_bio")).not.toBeNull();

    item.delete();
    expect(globalThis.localStorage.getItem("__bio_bio")).toBeNull();
    expect(item.get()).toBe("");
  });

  it("clearBiometric removes all biometric keys", () => {
    const item1 = createStorageItem({
      key: "bio-a",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });
    const item2 = createStorageItem({
      key: "bio-b",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });

    item1.set("secret-a");
    item2.set("secret-b");

    storage.clearBiometric();

    expect(globalThis.localStorage.getItem("__bio_bio-a")).toBeNull();
    expect(globalThis.localStorage.getItem("__bio_bio-b")).toBeNull();
    expect(item1.get()).toBe("");
    expect(item2.get()).toBe("");
  });
});

describe("web transaction edge cases", () => {
  beforeEach(() => {
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
    setWebSecureStorageBackend(undefined);
    storage.clearAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("transaction rollback in Disk scope restores values", () => {
    const item = createStorageItem({
      key: "txn-rb-disk",
      scope: StorageScope.Disk,
      defaultValue: "init",
    });
    item.set("original");

    expect(() =>
      runTransaction(StorageScope.Disk, (tx) => {
        tx.setItem(item, "modified");
        throw new Error("abort");
      }),
    ).toThrow("abort");

    expect(item.get()).toBe("original");
  });

  it("transaction rollback for new key removes it", () => {
    const item = createStorageItem({
      key: "txn-rb-new",
      scope: StorageScope.Disk,
      defaultValue: "default",
    });

    expect(() =>
      runTransaction(StorageScope.Disk, (tx) => {
        tx.setItem(item, "created");
        throw new Error("abort");
      }),
    ).toThrow("abort");

    expect(item.get()).toBe("default");
    expect(globalThis.localStorage.getItem("txn-rb-new")).toBeNull();
  });

  it("transaction in Memory scope rolls back correctly", () => {
    const item = createStorageItem({
      key: "txn-rb-mem",
      scope: StorageScope.Memory,
      defaultValue: "init",
    });
    item.set("before");

    expect(() =>
      runTransaction(StorageScope.Memory, (tx) => {
        tx.setItem(item, "during");
        throw new Error("abort");
      }),
    ).toThrow("abort");

    expect(item.get()).toBe("before");
  });
});
