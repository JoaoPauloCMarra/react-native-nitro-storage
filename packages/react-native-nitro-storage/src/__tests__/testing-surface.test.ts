import {
  createSecureAuthStorage,
  createSetItem,
  createStorageItem,
  getBatch,
  memoryItem,
  migrateToLatest,
  registerMigration,
  removeBatch,
  resetNitroStorageMock,
  runTransaction,
  secureItem,
  setBatch,
  storage,
} from "../testing";
import { StorageScope } from "../Storage.types";

beforeEach(() => {
  resetNitroStorageMock();
});

describe("testing module default singleton surface", () => {
  it("supports batch operations and prefix/size queries on disk", () => {
    const a = createStorageItem<string>({
      key: "b:a",
      scope: StorageScope.Disk,
      defaultValue: "-",
    });
    const b = createStorageItem<string>({
      key: "b:b",
      scope: StorageScope.Disk,
      defaultValue: "-",
    });

    setBatch(
      [
        { item: a, value: "A" },
        { item: b, value: "B" },
      ],
      StorageScope.Disk,
    );
    expect(getBatch([a, b], StorageScope.Disk)).toEqual(["A", "B"]);
    expect(storage.size(StorageScope.Disk)).toBe(2);
    expect(storage.getKeysByPrefix("b:", StorageScope.Disk).sort()).toEqual([
      "b:a",
      "b:b",
    ]);
    expect(storage.getAllKeys(StorageScope.Disk).length).toBe(2);

    storage.clearNamespace("b", StorageScope.Disk);
    expect(storage.size(StorageScope.Disk)).toBe(0);

    removeBatch([a, b], StorageScope.Disk);
  });

  it("runs transactions and migrations", () => {
    const balance = memoryItem<number>({ key: "bal", defaultValue: 0 });
    runTransaction(StorageScope.Memory, (tx) => {
      tx.setItem(balance, 100);
    });
    expect(balance.get()).toBe(100);

    const migrated = createStorageItem<string>({
      key: "mig",
      scope: StorageScope.Disk,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    migrated.set("lower");
    registerMigration(1, ({ getRaw, setRaw }) => {
      const raw = getRaw("mig");
      if (raw !== undefined) {
        setRaw("mig", raw.toUpperCase());
      }
    });
    migrateToLatest(StorageScope.Disk);
    expect(migrated.get()).toBe("LOWER");
  });

  it("supports secure items, secure auth storage, and set items", () => {
    const token = secureItem<string>({ key: "tok", defaultValue: "" });
    token.set("secret");
    expect(token.get()).toBe("secret");

    const auth = createSecureAuthStorage({ accessToken: {}, refreshToken: {} });
    auth.accessToken.set("at");
    expect(auth.accessToken.get()).toBe("at");

    const flags = createSetItem({ key: "flags", scope: StorageScope.Disk });
    flags.add("one");
    flags.add("two");
    expect(flags.size()).toBe(2);
    flags.delete("one");
    expect(flags.has("one")).toBe(false);
    flags.clear();
    expect(flags.size()).toBe(0);
  });

  it("removes keys by prefix via clearNamespace on disk", () => {
    storage.setString("ns:1", "a", StorageScope.Disk);
    storage.setString("ns:2", "b", StorageScope.Disk);
    storage.setString("other", "c", StorageScope.Disk);
    storage.clearNamespace("ns", StorageScope.Disk);
    expect(storage.getAllKeys(StorageScope.Disk)).toEqual(["other"]);
  });
});
