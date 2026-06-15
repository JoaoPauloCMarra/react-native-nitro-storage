import {
  createNitroStorageMock,
  resetNitroStorageMock,
  storage as defaultStorage,
  diskItem as defaultDiskItem,
} from "../testing";
import { StorageScope } from "../Storage.types";

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
