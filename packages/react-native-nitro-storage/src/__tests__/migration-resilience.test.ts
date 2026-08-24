import {
  createNitroStorageMock,
  resetNitroStorageMock,
  storage as defaultStorage,
  diskItem as defaultDiskItem,
} from "../testing";
import { StorageScope } from "../Storage.types";
import { serializeWithPrimitiveFastPath } from "../internal";

describe("renameFrom migration", () => {
  it("migrates a legacy key to the new key on first read and deletes the legacy entry", () => {
    const { diskItem, storage } = createNitroStorageMock();
    const legacy = diskItem<string>({ key: "authToken", defaultValue: "" });
    legacy.set("legacy-token");

    const current = diskItem<string>({
      key: "accessToken",
      namespace: "auth",
      defaultValue: "",
      renameFrom: "authToken",
    });

    expect(current.get()).toBe("legacy-token");
    expect(storage.has("authToken", StorageScope.Disk)).toBe(false);
    expect(current.has()).toBe(true);
  });

  it("drops the legacy key when the current key already has a value", () => {
    const { diskItem, storage } = createNitroStorageMock();
    const current = diskItem<string>({
      key: "accessToken",
      defaultValue: "",
      renameFrom: "authToken",
    });
    current.set("current-token");
    storage.setString("authToken", "stale", StorageScope.Disk);

    expect(current.get()).toBe("current-token");
    expect(storage.has("authToken", StorageScope.Disk)).toBe(false);
  });

  it("uses the first present legacy key from an array", () => {
    const { diskItem } = createNitroStorageMock();
    const legacy = diskItem<string>({ key: "v2-token", defaultValue: "" });
    legacy.set("from-v2");

    const current = diskItem<string>({
      key: "token",
      defaultValue: "",
      renameFrom: ["v1-token", "v2-token"],
    });
    expect(current.get()).toBe("from-v2");
  });

  it.each([StorageScope.Disk, StorageScope.Secure])(
    "cleans every present legacy key after choosing the first value in scope %s",
    (scope) => {
      const { storage, diskItem, secureItem } = createNitroStorageMock();
      const createItem = scope === StorageScope.Disk ? diskItem : secureItem;
      const first = createItem<string>({
        key: `multi-first-${scope}`,
        defaultValue: "",
      });
      const second = createItem<string>({
        key: `multi-second-${scope}`,
        defaultValue: "",
      });
      first.set("first-value");
      second.set("second-value");

      const current = createItem<string>({
        key: `multi-current-${scope}`,
        defaultValue: "",
        renameFrom: [first.key, second.key],
      });

      expect(current.get()).toBe("first-value");
      expect(storage.has(first.key, scope)).toBe(false);
      expect(storage.has(second.key, scope)).toBe(false);
      expect(storage.getString(current.key, scope)).toBe(
        serializeWithPrimitiveFastPath("first-value"),
      );
    },
  );

  it.each([StorageScope.Disk, StorageScope.Secure])(
    "preserves the exact migrated envelope and expiry in scope %s",
    (scope) => {
      const { storage, diskItem, secureItem } = createNitroStorageMock();
      const createItem = scope === StorageScope.Disk ? diskItem : secureItem;
      const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
      const legacyKey = `ttl-legacy-${scope}`;
      const currentKey = `ttl-current-${scope}`;
      const rawEnvelope = JSON.stringify({
        __nitroStorageEnvelope: true,
        expiresAt: 1_100,
        payload: serializeWithPrimitiveFastPath("legacy-ttl"),
      });
      storage.setString(legacyKey, rawEnvelope, scope);
      const current = createItem<string>({
        key: currentKey,
        defaultValue: "default",
        expiration: { ttlMs: 1_000 },
        renameFrom: legacyKey,
      });

      expect(current.get()).toBe("legacy-ttl");
      expect(storage.getString(currentKey, scope)).toBe(rawEnvelope);

      nowSpy.mockReturnValue(1_101);
      expect(current.get()).toBe("default");
      expect(storage.has(currentKey, scope)).toBe(false);
      expect(storage.has(legacyKey, scope)).toBe(false);
      nowSpy.mockRestore();
    },
  );

  it("rolls back lazy rename migration when a transaction read throws", () => {
    const {
      diskItem,
      runTransaction: runTestTransaction,
      storage,
    } = createNitroStorageMock();
    const legacy = diskItem<string>({ key: "tx-authToken", defaultValue: "" });
    legacy.set("legacy-token");
    const current = diskItem<string>({
      key: "tx-accessToken",
      defaultValue: "",
      renameFrom: legacy.key,
    });

    expect(() =>
      runTestTransaction(StorageScope.Disk, (tx) => {
        expect(tx.getItem(current)).toBe("legacy-token");
        throw new Error("transaction failure");
      }),
    ).toThrow("transaction failure");

    expect(storage.has(current.key, StorageScope.Disk)).toBe(false);
    expect(legacy.get()).toBe("legacy-token");
    expect(current.get()).toBe("legacy-token");
    expect(storage.has(current.key, StorageScope.Disk)).toBe(true);
  });

  it("restores plain and biometric aliases when a secure transaction read throws", () => {
    const {
      runTransaction: runTestTransaction,
      secureItem,
      storage,
    } = createNitroStorageMock();
    const legacyPlain = secureItem<string>({
      key: "tx-secure-legacy",
      defaultValue: "",
    });
    const legacyBiometric = secureItem<string>({
      key: legacyPlain.key,
      defaultValue: "",
      biometric: true,
    });
    legacyBiometric.set("legacy-biometric");
    legacyPlain.set("legacy-plain");
    const current = secureItem<string>({
      key: "tx-secure-current",
      defaultValue: "",
      renameFrom: legacyPlain.key,
    });

    expect(() =>
      runTestTransaction(StorageScope.Secure, (tx) => {
        expect(tx.getItem(current)).toBe("legacy-plain");
        throw new Error("secure transaction failure");
      }),
    ).toThrow("secure transaction failure");

    expect(legacyPlain.get()).toBe("legacy-plain");
    expect(legacyBiometric.get()).toBe("legacy-biometric");
    expect(storage.has(current.key, StorageScope.Secure)).toBe(false);
  });

  it("restores aliases when a transaction setItem throws", () => {
    const { diskItem, runTransaction: runTestTransaction } =
      createNitroStorageMock();
    const legacy = diskItem<string>({ key: "tx-set-legacy", defaultValue: "" });
    legacy.set("legacy");
    const current = diskItem<string>({
      key: "tx-set-current",
      defaultValue: "",
      renameFrom: legacy.key,
    });

    expect(() =>
      runTestTransaction(StorageScope.Disk, (tx) => {
        tx.setItem(current, "new");
        throw new Error("set transaction failure");
      }),
    ).toThrow("set transaction failure");

    expect(current.has()).toBe(false);
    expect(legacy.get()).toBe("legacy");
    expect(current.get()).toBe("legacy");
    expect(current.has()).toBe(true);
  });

  it("restores current and aliases when a transaction removeItem throws", () => {
    const {
      diskItem,
      runTransaction: runTestTransaction,
      storage,
    } = createNitroStorageMock();
    const legacy = diskItem<string>({
      key: "tx-remove-legacy",
      defaultValue: "",
    });
    const current = diskItem<string>({
      key: "tx-remove-current",
      defaultValue: "",
      renameFrom: legacy.key,
    });
    current.set("current");
    legacy.set("legacy");

    expect(() =>
      runTestTransaction(StorageScope.Disk, (tx) => {
        tx.removeItem(current);
        throw new Error("remove transaction failure");
      }),
    ).toThrow("remove transaction failure");

    expect(storage.getString(current.key, StorageScope.Disk)).toBe(
      serializeWithPrimitiveFastPath("current"),
    );
    expect(legacy.get()).toBe("legacy");
  });
});

describe("createSecureAuthStorage extensions", () => {
  it("supports renameFrom per key and a shared group", () => {
    const { secureItem, createSecureAuthStorage, storage } =
      createNitroStorageMock();
    const legacy = secureItem<string>({ key: "authToken", defaultValue: "" });
    legacy.set("old-access");

    const auth = createSecureAuthStorage(
      {
        accessToken: { renameFrom: "authToken" },
        refreshToken: {},
      },
      { namespace: "app-auth", group: "auth" },
    );

    expect(auth.accessToken.get()).toBe("old-access");
    auth.refreshToken.set("rt");

    storage.clearGroup("auth");
    expect(auth.accessToken.has()).toBe(false);
    expect(auth.refreshToken.has()).toBe(false);
  });
});

describe("expiration events", () => {
  it("emits an expire event for memory items via subscribeExpired", () => {
    const { memoryItem, storage } = createNitroStorageMock();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1000);
    const item = memoryItem<string>({
      key: "ttl",
      defaultValue: "",
      expiration: { ttlMs: 100 },
    });

    const expired: string[] = [];
    const unsubscribe = storage.subscribeExpired(
      StorageScope.Memory,
      (event) => {
        expired.push(event.key);
      },
    );

    item.set("session");
    expect(item.get()).toBe("session");

    nowSpy.mockReturnValue(1200);
    expect(item.get()).toBe("");
    expect(expired).toEqual(["ttl"]);

    unsubscribe();
    nowSpy.mockRestore();
  });

  it("emits an expire event for disk items via subscribeExpired", () => {
    const { diskItem, storage } = createNitroStorageMock();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(5000);
    const item = diskItem<string>({
      key: "ttl-disk",
      defaultValue: "",
      expiration: { ttlMs: 50 },
    });

    const expired: string[] = [];
    const unsubscribe = storage.subscribeExpired(StorageScope.Disk, (event) => {
      expired.push(event.key);
    });

    item.set("disk-session");
    nowSpy.mockReturnValue(9000);
    expect(item.get()).toBe("");
    expect(expired).toEqual(["ttl-disk"]);

    unsubscribe();
    nowSpy.mockRestore();
  });
});

describe("testing entrypoint", () => {
  it("exposes a default singleton that resets cleanly", () => {
    defaultDiskItem<string>({ key: "x", defaultValue: "" }).set("v");
    expect(defaultStorage.size(StorageScope.Disk)).toBeGreaterThan(0);
    resetNitroStorageMock();
    expect(defaultStorage.size(StorageScope.Disk)).toBe(0);
  });

  it("reports in-memory capabilities", () => {
    const { storage } = createNitroStorageMock();
    expect(storage.getCapabilities().platform).toBe("native");
    expect(storage.getSecurityCapabilities().secureStorage.encrypted).toBe(
      "unavailable",
    );
  });

  it("supports access-control configuration without native", () => {
    const { storage, secureItem } = createNitroStorageMock();
    expect(() => storage.setAccessControl(1)).not.toThrow();
    expect(() => storage.setSecureWritesAsync(true)).not.toThrow();
    expect(() => storage.setKeychainAccessGroup("group")).not.toThrow();
    const item = secureItem<string>({ key: "s", defaultValue: "" });
    item.set("secret");
    expect(item.get()).toBe("secret");
  });
});
