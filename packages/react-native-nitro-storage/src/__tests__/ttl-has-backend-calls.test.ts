import { StorageScope } from "../Storage.types";
import { createTestBackend, createTestCore } from "./core-test-backend";

describe.each([StorageScope.Disk, StorageScope.Secure] as const)(
  "has() on a TTL item (%s)",
  (scope) => {
    const setup = () => {
      const backend = createTestBackend();
      const { createStorageItem } = createTestCore(backend);
      const item = createStorageItem<string>({
        key: "ttl",
        scope,
        defaultValue: "default",
        expiration: { ttlMs: 60_000 },
      });
      item.set("value");
      const get = jest.spyOn(backend, "get");
      const has = jest.spyOn(backend, "has");
      return { backend, item, get, has };
    };

    it("answers from the single value read without a second bridge call", () => {
      const { item, get, has } = setup();

      expect(item.has()).toBe(true);

      expect(get).toHaveBeenCalledTimes(1);
      expect(has).not.toHaveBeenCalled();
    });

    it("reuses the parsed expiry once the item has been read", () => {
      const { item, get, has } = setup();
      item.get();
      get.mockClear();
      const parse = jest.spyOn(JSON, "parse");

      expect(item.has()).toBe(true);
      expect(item.has()).toBe(true);

      expect(parse).not.toHaveBeenCalled();
      expect(has).not.toHaveBeenCalled();
      parse.mockRestore();
    });

    it("reports a missing key and a lapsed key as absent", () => {
      const { backend, item } = setup();
      jest.useFakeTimers().setSystemTime(Date.now() + 120_000);
      try {
        expect(item.has()).toBe(false);
        expect(backend.stores[scope].has("ttl")).toBe(false);
      } finally {
        jest.useRealTimers();
      }
      expect(item.has()).toBe(false);
    });
  },
);
