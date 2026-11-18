import { StorageScope } from "../Storage.types";
import { createTestBackend, createTestCore } from "./core-test-backend";

const identity = (value: string): string => value;

describe.each([StorageScope.Disk, StorageScope.Secure] as const)(
  "readCache items after a batch write that throws midway (%s)",
  (scope) => {
    const setup = () => {
      const backend = createTestBackend();
      const { createStorageItem, setBatch, removeBatch, storage } =
        createTestCore(backend);
      const create = (key: string) =>
        createStorageItem<string>({
          key,
          scope,
          defaultValue: "default",
          readCache: true,
          serialize: identity,
          deserialize: identity,
        });
      const a = create("a");
      const b = create("b");
      a.set("old-a");
      b.set("old-b");
      expect(a.get()).toBe("old-a");
      expect(b.get()).toBe("old-b");
      return { backend, a, b, setBatch, removeBatch, storage };
    };

    it("reads the stored values after setBatch throws midway", () => {
      const { backend, a, b, setBatch } = setup();
      backend.setBatch = (keys, values) => {
        backend.stores[scope].set(keys[0] ?? "", values[0] ?? "");
        throw new Error("[nitro-error:storage_full] NitroStorage: injected");
      };

      expect(() =>
        setBatch(
          [
            { item: a, value: "new-a" },
            { item: b, value: "new-b" },
          ],
          scope,
        ),
      ).toThrow("storage_full");

      expect(backend.stores[scope].get("a")).toBe("new-a");
      expect(a.get()).toBe("new-a");
      expect(b.get()).toBe("old-b");
    });

    it("reads the stored values after removeBatch throws midway", () => {
      const { backend, a, b, removeBatch } = setup();
      backend.removeBatch = (keys) => {
        backend.stores[scope].delete(keys[0] ?? "");
        throw new Error("[nitro-error:storage_full] NitroStorage: injected");
      };

      expect(() => removeBatch([a, b], scope)).toThrow("storage_full");

      expect(backend.stores[scope].has("a")).toBe(false);
      expect(a.get()).toBe("default");
      expect(b.get()).toBe("old-b");
    });

    it("reads the stored values after storage.import throws midway", () => {
      const { backend, a, b, storage } = setup();
      backend.setBatch = (keys, values) => {
        backend.stores[scope].set(keys[0] ?? "", values[0] ?? "");
        throw new Error("[nitro-error:storage_full] NitroStorage: injected");
      };

      expect(() => storage.import({ a: "new-a", b: "new-b" }, scope)).toThrow(
        "storage_full",
      );

      expect(backend.stores[scope].get("a")).toBe("new-a");
      expect(a.get()).toBe("new-a");
      expect(b.get()).toBe("old-b");
    });
  },
);
