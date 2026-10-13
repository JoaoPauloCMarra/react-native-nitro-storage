import { StorageScope } from "../Storage.types";
import { createTestBackend, createTestCore } from "./core-test-backend";

describe.each([StorageScope.Disk, StorageScope.Secure] as const)(
  "readCache item after a failed synchronous backend call (%s)",
  (scope) => {
    it("keeps cached reads on the stored value when set throws", () => {
      const backend = createTestBackend();
      const { createStorageItem } = createTestCore(backend);
      const item = createStorageItem({
        key: "rc",
        scope,
        defaultValue: "default",
        readCache: true,
      });
      const sibling = createStorageItem({
        key: "rc",
        scope,
        defaultValue: "default",
        readCache: true,
      });
      item.set("old");
      const stored = backend.stores[scope].get("rc");

      backend.failNext("set", scope);
      expect(() => item.set("new")).toThrow();

      expect(backend.stores[scope].get("rc")).toBe(stored);
      expect(item.get()).toBe("old");
      expect(item.has()).toBe(true);
      expect(sibling.get()).toBe("old");
    });

    it("keeps cached reads on the stored value when delete throws", () => {
      const backend = createTestBackend();
      const { createStorageItem } = createTestCore(backend);
      const item = createStorageItem({
        key: "rc",
        scope,
        defaultValue: "default",
        readCache: true,
      });
      const sibling = createStorageItem({
        key: "rc",
        scope,
        defaultValue: "default",
        readCache: true,
      });
      item.set("old");
      const stored = backend.stores[scope].get("rc");

      backend.failNext("remove", scope);
      expect(() => item.delete()).toThrow();

      expect(backend.stores[scope].get("rc")).toBe(stored);
      expect(item.get()).toBe("old");
      expect(item.has()).toBe(true);
      expect(sibling.get()).toBe("old");
    });

    it("keeps raw setString and remove on the stored value when the backend throws", () => {
      const backend = createTestBackend();
      const { createStorageItem, storage } = createTestCore(backend);
      const item = createStorageItem({
        key: "rc",
        scope,
        defaultValue: "default",
        readCache: true,
      });
      item.set("old");
      const stored = backend.stores[scope].get("rc");

      backend.failNext("set", scope);
      expect(() => storage.setString("rc", "new", scope)).toThrow();
      expect(item.get()).toBe("old");

      backend.failNext("remove", scope);
      expect(() => storage.deleteString("rc", scope)).toThrow();
      expect(item.get()).toBe("old");
      expect(backend.stores[scope].get("rc")).toBe(stored);
    });
  },
);

describe("Secure plaintext cache follows readCache", () => {
  it("does not cache getBatch results for Secure items without readCache", () => {
    const backend = createTestBackend();
    const { createStorageItem, getBatch, storage } = createTestCore(backend);
    const plain = createStorageItem({
      key: "plain",
      scope: StorageScope.Secure,
      defaultValue: "",
    });
    const cached = createStorageItem({
      key: "cached",
      scope: StorageScope.Secure,
      defaultValue: "",
      readCache: true,
    });
    backend.stores[StorageScope.Secure].set(
      "plain",
      "__nitro_storage_primitive__:s:a",
    );
    backend.stores[StorageScope.Secure].set(
      "cached",
      "__nitro_storage_primitive__:s:b",
    );

    expect(getBatch([plain, cached], StorageScope.Secure)).toEqual(["a", "b"]);

    expect(storage.getCacheMetrics().cacheEntries).toBe(1);
  });

  it("does not cache Secure writes of items without readCache", () => {
    const { createStorageItem, storage } = createTestCore();
    const plain = createStorageItem({
      key: "plain",
      scope: StorageScope.Secure,
      defaultValue: "",
    });
    const cached = createStorageItem({
      key: "cached",
      scope: StorageScope.Secure,
      defaultValue: "",
      readCache: true,
    });

    plain.set("a");
    cached.set("b");
    plain.delete();

    expect(storage.getCacheMetrics().cacheEntries).toBe(1);
  });

  it("does not cache setBatch writes of Secure items without readCache", () => {
    const { createStorageItem, setBatch, storage } = createTestCore();
    const plain = createStorageItem({
      key: "plain",
      scope: StorageScope.Secure,
      defaultValue: "",
    });
    const cached = createStorageItem({
      key: "cached",
      scope: StorageScope.Secure,
      defaultValue: "",
      readCache: true,
    });

    setBatch(
      [
        { item: plain, value: "a" },
        { item: cached, value: "b" },
      ],
      StorageScope.Secure,
    );

    expect(storage.getCacheMetrics().cacheEntries).toBe(1);
  });
});

describe("fallbackToCacheOnReadError with batch writes and reads", () => {
  function setup() {
    const backend = createTestBackend();
    const core = createTestCore(backend);
    const item = core.createStorageItem({
      key: "fallback",
      scope: StorageScope.Secure,
      defaultValue: "default",
      fallbackToCacheOnReadError: true,
    });
    return { backend, item, ...core };
  }

  it("serves the batch-written value while the keychain is locked", () => {
    const { backend, item, setBatch } = setup();
    item.set("v1");
    expect(item.get()).toBe("v1");

    setBatch([{ item, value: "v2" }], StorageScope.Secure);
    backend.lockReads = true;

    expect(item.get()).toBe("v2");
  });

  it("serves the batch-read value while the keychain is locked", () => {
    const { backend, item, getBatch } = setup();
    item.set("v1");
    expect(item.get()).toBe("v1");
    backend.stores[StorageScope.Secure].set(
      "fallback",
      "__nitro_storage_primitive__:s:v2",
    );

    expect(getBatch([item], StorageScope.Secure)).toEqual(["v2"]);
    backend.lockReads = true;

    expect(item.get()).toBe("v2");
  });

  it("does not serve batch reads from the fallback cache", () => {
    const { backend, item, getBatch } = setup();
    item.set("v1");
    expect(item.get()).toBe("v1");
    backend.stores[StorageScope.Secure].set(
      "fallback",
      "__nitro_storage_primitive__:s:v2",
    );

    expect(getBatch([item], StorageScope.Secure)).toEqual(["v2"]);
  });
});

describe("Secure raw writes do not keep plaintext in the cache", () => {
  it("leaves the cache empty after setString, import and deleteString", () => {
    const { storage } = createTestCore();

    storage.setString("raw", "a", StorageScope.Secure);
    storage.import({ imported: "b" }, StorageScope.Secure);
    storage.deleteString("raw", StorageScope.Secure);

    expect(storage.getCacheMetrics().cacheEntries).toBe(0);
  });

  it("invalidates a readCache item's entry so the next read hits the backend", () => {
    const backend = createTestBackend();
    const { createStorageItem, storage } = createTestCore(backend);
    const item = createStorageItem({
      key: "owned",
      scope: StorageScope.Secure,
      defaultValue: "default",
      readCache: true,
    });
    item.set("first");
    expect(item.get()).toBe("first");

    storage.setString("owned", "second", StorageScope.Secure);

    expect(item.get()).toBe("second");
  });
});
