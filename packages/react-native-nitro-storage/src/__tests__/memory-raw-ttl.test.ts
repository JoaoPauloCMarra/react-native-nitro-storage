import { StorageScope } from "../Storage.types";
import { createTestCore } from "./core-test-backend";

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
});
