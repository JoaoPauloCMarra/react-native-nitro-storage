import { BiometricLevel, StorageScope } from "../Storage.types";
import { createTestBackend, createTestCore } from "./core-test-backend";

describe("Memory raw writes on a TTL key", () => {
  let now = 1_000;

  beforeEach(() => {
    now = 1_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [
      "import",
      (storage: ReturnType<typeof createTestCore>["storage"]) =>
        storage.import({ ttl: "imported" }, StorageScope.Memory),
    ],
    [
      "setString",
      (storage: ReturnType<typeof createTestCore>["storage"]) =>
        storage.setString("ttl", "imported", StorageScope.Memory),
    ],
  ])("drops the old deadline on %s", (_name, write) => {
    const { createStorageItem, storage } = createTestCore();
    const onExpired = jest.fn();
    const item = createStorageItem({
      key: "ttl",
      scope: StorageScope.Memory,
      defaultValue: "def",
      expiration: { ttlMs: 100 },
      onExpired,
    });
    item.set("first");

    write(storage);
    now += 500;

    expect(storage.getString("ttl", StorageScope.Memory)).toBe("imported");
    item.get();
    expect(onExpired).not.toHaveBeenCalled();
    expect(storage.getString("ttl", StorageScope.Memory)).toBe("imported");
  });

  it("clears the old deadline when setBatch rewrites the key through a plain item", () => {
    const { createStorageItem, setBatch, storage } = createTestCore();
    const onExpired = jest.fn();
    const ttlItem = createStorageItem({
      key: "ttl",
      scope: StorageScope.Memory,
      defaultValue: "def",
      expiration: { ttlMs: 100 },
      onExpired,
    });
    const plainItem = createStorageItem({
      key: "ttl",
      scope: StorageScope.Memory,
      defaultValue: "def",
    });
    ttlItem.set("first");

    setBatch([{ item: plainItem, value: "batched" }], StorageScope.Memory);
    now += 500;

    expect(ttlItem.get()).toBe("batched");
    expect(onExpired).not.toHaveBeenCalled();
    expect(storage.getString("ttl", StorageScope.Memory)).toBe("batched");
  });
});

describe("item.has() on a TTL key", () => {
  let now = 1_000;

  beforeEach(() => {
    now = 1_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([StorageScope.Memory, StorageScope.Disk])(
    "has() is false once the TTL lapses, before any get() (scope %s)",
    (scope) => {
      const { createStorageItem, storage } = createTestCore();
      const onExpired = jest.fn();
      const item = createStorageItem({
        key: "ttl",
        scope,
        defaultValue: "def",
        expiration: { ttlMs: 1_000 },
        onExpired,
      });
      item.set("value");
      expect(item.has()).toBe(true);
      expect(storage.has("ttl", scope)).toBe(true);

      now += 5_000;

      expect(item.has()).toBe(false);
      expect(onExpired).toHaveBeenCalledTimes(1);
      expect(storage.has("ttl", scope)).toBe(false);
      expect(item.get()).toBe("def");
    },
  );

  it("has() on a biometric Secure item with a TTL never reads the value", () => {
    const backend = createTestBackend();
    const getSecureBiometric = jest.spyOn(backend, "getSecureBiometric");
    const hasSecureBiometric = jest.spyOn(backend, "hasSecureBiometric");
    const { createStorageItem } = createTestCore(backend);
    const item = createStorageItem({
      key: "bio-ttl",
      scope: StorageScope.Secure,
      defaultValue: "def",
      biometricLevel: BiometricLevel.BiometryOnly,
      expiration: { ttlMs: 1_000 },
    });
    item.set("value");
    getSecureBiometric.mockClear();
    hasSecureBiometric.mockClear();

    expect(item.has()).toBe(true);
    expect(hasSecureBiometric).toHaveBeenCalledTimes(1);
    expect(getSecureBiometric).not.toHaveBeenCalled();
  });
});
