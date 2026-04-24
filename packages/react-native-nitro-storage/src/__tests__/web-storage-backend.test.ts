import { createLocalStorageWebBackend } from "../web-storage-backend";

function createStorageMock(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));

  return {
    get length() {
      return data.size;
    },
    clear: jest.fn(() => {
      data.clear();
    }),
    getItem: jest.fn((key: string) => data.get(key) ?? null),
    key: jest.fn((index: number) => Array.from(data.keys())[index] ?? null),
    removeItem: jest.fn((key: string) => {
      data.delete(key);
    }),
    setItem: jest.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  };
}

describe("createLocalStorageWebBackend", () => {
  it("defaults to localStorage when no resolver is provided", () => {
    const original = globalThis.localStorage;
    const storage = createStorageMock({ a: "1" });

    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
    });

    try {
      const backend = createLocalStorageWebBackend();
      expect(backend.name).toBe("localStorage");
      expect(backend.getItem("a")).toBe("1");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: original,
        configurable: true,
      });
    }
  });

  it("returns inert values when storage is unavailable", () => {
    const backend = createLocalStorageWebBackend({
      resolveStorage: () => undefined,
    });

    expect(backend.getItem("missing")).toBeNull();
    expect(backend.getAllKeys()).toEqual([]);
    expect(backend.getMany?.(["a", "b"])).toEqual([null, null]);
    expect(backend.size?.()).toBe(0);
    expect(() => backend.setItem("a", "1")).not.toThrow();
    expect(() => backend.setMany?.([["a", "1"]])).not.toThrow();
    expect(() => backend.removeItem("a")).not.toThrow();
    expect(() => backend.removeMany?.(["a"])).not.toThrow();
    expect(() => backend.clear()).not.toThrow();
  });

  it("filters list, clear, and size through includeKey", () => {
    const storage = createStorageMock({
      "app:a": "1",
      "app:b": "2",
      "other:c": "3",
    });
    const backend = createLocalStorageWebBackend({
      name: "filtered",
      includeKey: (key) => key.startsWith("app:"),
      resolveStorage: () => storage,
    });

    expect(backend.name).toBe("filtered");
    expect(backend.getAllKeys().sort()).toEqual(["app:a", "app:b"]);
    expect(backend.size?.()).toBe(2);

    backend.clear();

    expect(storage.getItem("app:a")).toBeNull();
    expect(storage.getItem("app:b")).toBeNull();
    expect(storage.getItem("other:c")).toBe("3");
  });

  it("supports batch reads, writes, and removals", () => {
    const storage = createStorageMock();
    const backend = createLocalStorageWebBackend({
      resolveStorage: () => storage,
    });

    backend.setMany?.([
      ["a", "1"],
      ["b", "2"],
    ]);

    expect(backend.getMany?.(["a", "b", "c"])).toEqual(["1", "2", null]);

    backend.removeMany?.(["a", "b"]);

    expect(backend.getMany?.(["a", "b"])).toEqual([null, null]);
  });
});
