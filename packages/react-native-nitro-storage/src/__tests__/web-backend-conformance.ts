import type { WebStorageBackend } from "../web-storage-backend";
import {
  describeWebBackendCapabilities,
  isIndexedDBWebBackend,
} from "../web-backend-contract";

export type WebBackendConformanceHooks = {
  name: string;
  create: () => WebStorageBackend | Promise<WebStorageBackend>;
  reset?: () => void | Promise<void>;
};

export function runWebBackendConformanceSuite(
  hooks: WebBackendConformanceHooks,
): void {
  describe(`web backend conformance: ${hooks.name}`, () => {
    let backend: WebStorageBackend;

    beforeEach(async () => {
      await hooks.reset?.();
      backend = await hooks.create();
    });

    it("reports a stable name", () => {
      expect(typeof backend.name).toBe("string");
      expect(backend.name?.length ?? 0).toBeGreaterThan(0);
    });

    it("returns null for a key that was never set", () => {
      expect(backend.getItem("missing-key")).toBeNull();
    });

    it("round-trips setItem / getItem synchronously", () => {
      backend.setItem("k1", "v1");
      expect(backend.getItem("k1")).toBe("v1");
    });

    it("overwrites an existing key", () => {
      backend.setItem("k1", "v1");
      backend.setItem("k1", "v2");
      expect(backend.getItem("k1")).toBe("v2");
    });

    it("removeItem deletes a key", () => {
      backend.setItem("k1", "v1");
      backend.removeItem("k1");
      expect(backend.getItem("k1")).toBeNull();
    });

    it("removeItem for a missing key does not throw", () => {
      expect(() => backend.removeItem("missing")).not.toThrow();
    });

    it("clear removes every key", () => {
      backend.setItem("k1", "v1");
      backend.setItem("k2", "v2");
      backend.clear();
      expect(backend.getItem("k1")).toBeNull();
      expect(backend.getItem("k2")).toBeNull();
      expect(backend.getAllKeys()).toEqual([]);
    });

    it("getAllKeys lists stored keys", () => {
      backend.setItem("a", "1");
      backend.setItem("b", "2");
      const keys = backend.getAllKeys();
      expect(keys).toContain("a");
      expect(keys).toContain("b");
    });

    it("batch helpers match the single-key contract", () => {
      if (backend.getMany && backend.setMany && backend.removeMany) {
        backend.setMany([
          ["x", "1"],
          ["y", "2"],
        ]);
        expect(backend.getMany(["x", "y", "z"])).toEqual(["1", "2", null]);
        backend.removeMany(["x", "y"]);
        expect(backend.getMany(["x", "y"])).toEqual([null, null]);
      }
    });

    it("reports buffering only for IndexedDB backends", () => {
      expect(describeWebBackendCapabilities(backend).buffered).toBe(
        isIndexedDBWebBackend(backend),
      );
    });

    it("flush resolves when available", async () => {
      if (!backend.flush) {
        return;
      }
      backend.setItem("persist", "value");
      await expect(backend.flush()).resolves.toBeUndefined();
    });
  });
}
