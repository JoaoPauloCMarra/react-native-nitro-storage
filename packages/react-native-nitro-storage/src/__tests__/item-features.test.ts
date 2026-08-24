import { createNitroStorageMock } from "../testing";
import { StorageScope } from "../Storage.types";

type Mock = ReturnType<typeof createNitroStorageMock>;

function freshMock(): Mock {
  return createNitroStorageMock();
}

describe("item.merge / reset / setOrDelete", () => {
  it("merges partial values into object items", () => {
    const { memoryItem } = freshMock();
    const item = memoryItem<{ a: number; b: number }>({
      key: "obj",
      defaultValue: { a: 1, b: 2 },
    });

    item.merge({ b: 5 });
    expect(item.get()).toEqual({ a: 1, b: 5 });

    item.merge({ a: 9 });
    expect(item.get()).toEqual({ a: 9, b: 5 });
  });

  it("merge replaces value when previous is not an object", () => {
    const { memoryItem } = freshMock();
    const item = memoryItem<number>({ key: "num", defaultValue: 0 });
    // merge on a primitive falls back to using the partial as the value
    item.merge(7 as never);
    expect(item.get()).toBe(7);
  });

  it("reset returns the item to its default value", () => {
    const { diskItem } = freshMock();
    const item = diskItem<string>({ key: "name", defaultValue: "default" });
    item.set("changed");
    expect(item.get()).toBe("changed");
    item.reset();
    expect(item.get()).toBe("default");
    expect(item.has()).toBe(false);
  });

  it("setOrDelete deletes on null/undefined and sets otherwise", () => {
    const { diskItem } = freshMock();
    const item = diskItem<string | null>({ key: "tok", defaultValue: null });

    item.setOrDelete("value");
    expect(item.get()).toBe("value");
    expect(item.has()).toBe(true);

    item.setOrDelete(null);
    expect(item.has()).toBe(false);

    item.setOrDelete("again");
    expect(item.has()).toBe(true);
    item.setOrDelete(undefined);
    expect(item.has()).toBe(false);
  });
});

describe("scoped factories", () => {
  it("creates items in the correct scope", () => {
    const { memoryItem, diskItem, secureItem } = freshMock();
    expect(memoryItem({ key: "m" }).scope).toBe(StorageScope.Memory);
    expect(diskItem({ key: "d" }).scope).toBe(StorageScope.Disk);
    expect(secureItem({ key: "s" }).scope).toBe(StorageScope.Secure);
  });
});

describe("createSetItem", () => {
  it("supports add / has / delete / toggle / values / size", () => {
    const { createSetItem } = freshMock();
    const seen = createSetItem({ key: "seen", scope: StorageScope.Disk });

    expect(seen.has("a")).toBe(false);
    seen.add("a");
    seen.add("b");
    expect(seen.has("a")).toBe(true);
    expect(seen.get()).toEqual({ a: true, b: true });
    expect(seen.getTyped()).toEqual({ a: true, b: true });
    expect(seen.size()).toBe(2);
    expect(seen.values().sort()).toEqual(["a", "b"]);

    expect(seen.toggle("a")).toBe(false);
    expect(seen.has("a")).toBe(false);
    expect(seen.toggle("c")).toBe(true);
    expect(seen.has("c")).toBe(true);

    seen.delete("b");
    expect(seen.has("b")).toBe(false);
    seen.clear();
    expect(seen.size()).toBe(0);
  });

  it("seeds default members and supports reset", () => {
    const { createSetItem } = freshMock();
    const seen = createSetItem({
      key: "seen2",
      scope: StorageScope.Memory,
      defaultValue: ["x", "y"],
    });
    expect(seen.size()).toBe(2);
    seen.add("z");
    expect(seen.size()).toBe(3);
    seen.reset();
    expect(seen.values().sort()).toEqual(["x", "y"]);
  });

  it("does not write on a no-op add or delete", () => {
    const { createSetItem } = freshMock();
    const seen = createSetItem({ key: "seen3", scope: StorageScope.Memory });
    seen.add("a");
    let notified = 0;
    const unsubscribe = seen.subscribe(() => {
      notified += 1;
    });
    seen.add("a"); // already present -> no write
    seen.delete("missing"); // absent -> no write
    expect(notified).toBe(0);
    seen.add("b"); // real change
    expect(notified).toBe(1);
    unsubscribe();
  });
});

describe("storage.clear with except", () => {
  it("preserves listed memory keys and removes the rest", () => {
    const { memoryItem, storage } = freshMock();
    const keep = memoryItem<string>({ key: "keep", defaultValue: "" });
    const drop = memoryItem<string>({ key: "drop", defaultValue: "" });
    keep.set("KEEP");
    drop.set("DROP");

    storage.clear(StorageScope.Memory, { except: [keep] });
    expect(keep.get()).toBe("KEEP");
    expect(drop.has()).toBe(false);
  });

  it("preserves listed disk keys (string + item refs) and reads previous values for observers", () => {
    const { diskItem, storage } = freshMock();
    const keep = diskItem<string>({ key: "keep", defaultValue: "" });
    const drop = diskItem<string>({ key: "drop", defaultValue: "" });
    keep.set("KEEP");
    drop.set("DROP");

    const events: string[] = [];
    const unsubscribe = storage.subscribe(StorageScope.Disk, (event) => {
      if (event.type === "batch") {
        event.changes.forEach((change) => events.push(change.key));
      }
    });

    storage.clear(StorageScope.Disk, { except: [keep.key] });
    expect(keep.get()).toBe("KEEP");
    expect(drop.has()).toBe(false);
    expect(events).toEqual(["drop"]);
    unsubscribe();
  });

  it("falls back to full clear when except is empty", () => {
    const { memoryItem, storage } = freshMock();
    const a = memoryItem<string>({ key: "a", defaultValue: "" });
    a.set("v");
    storage.clear(StorageScope.Memory, { except: [] });
    expect(a.has()).toBe(false);
  });
});

describe("item groups", () => {
  it("clears all items in a group across scopes and lists group items", () => {
    const { memoryItem, diskItem, storage } = freshMock();
    const m = memoryItem<string>({
      key: "m",
      defaultValue: "",
      group: "session",
    });
    const d = diskItem<string>({
      key: "d",
      defaultValue: "",
      group: "session",
    });
    const other = diskItem<string>({ key: "other", defaultValue: "" });
    m.set("M");
    d.set("D");
    other.set("O");

    expect(
      storage
        .getGroupItems("session")
        .map((item) => item.key)
        .sort(),
    ).toEqual(["d", "m"]);

    storage.clearGroup("session");
    expect(m.has()).toBe(false);
    expect(d.has()).toBe(false);
    expect(other.get()).toBe("O");
  });

  it("clearGroup on an unknown group is a no-op", () => {
    const { storage } = freshMock();
    expect(() => storage.clearGroup("nope")).not.toThrow();
    expect(storage.getGroupItems("nope")).toEqual([]);
  });
});

describe("duplicate key detection", () => {
  it("reports duplicate (scope,key) registrations and lists registered keys", () => {
    const { memoryItem, diskItem, storage } = freshMock();
    memoryItem({ key: "dup", defaultValue: 0 });
    memoryItem({ key: "dup", defaultValue: 0 });
    diskItem({ key: "dup", defaultValue: 0 });

    const duplicates = storage.findDuplicateKeys();
    expect(duplicates).toEqual([
      { scope: StorageScope.Memory, key: "dup", count: 2 },
    ]);

    const registered = storage.getRegisteredKeys();
    expect(registered).toContainEqual({
      scope: StorageScope.Memory,
      key: "dup",
    });
    expect(registered).toContainEqual({ scope: StorageScope.Disk, key: "dup" });
  });
});
