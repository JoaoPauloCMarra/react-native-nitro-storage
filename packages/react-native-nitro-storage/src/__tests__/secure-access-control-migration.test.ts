const mockHybridObject = {
  set: jest.fn(),
  get: jest.fn(),
  remove: jest.fn(),
  clear: jest.fn(),
  has: jest.fn(),
  getAllKeys: jest.fn(() => [] as string[]),
  size: jest.fn(() => 0),
  setBatch: jest.fn(),
  getBatch: jest.fn(() => []),
  removeBatch: jest.fn(),
  removeByPrefix: jest.fn(),
  addOnChange: jest.fn(() => () => {}),
  setSecureAccessControl: jest.fn(),
  setSecureWritesAsync: jest.fn(),
  setKeychainAccessGroup: jest.fn(),
  setSecureBiometric: jest.fn(),
  setSecureBiometricWithLevel: jest.fn(),
  getSecureBiometric: jest.fn(),
  deleteSecureBiometric: jest.fn(),
  hasSecureBiometric: jest.fn(() => false),
  clearSecureBiometric: jest.fn(),
  getKeysByPrefix: jest.fn(() => []),
  isProtectedDataAvailable: jest.fn(() => true),
  onProtectedDataAvailable: jest.fn(() => () => {}),
};

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => mockHybridObject),
  },
}));

import {
  AccessControl,
  StorageScope,
  createStorageItem,
  migrateSecureAccessControl,
  storage,
} from "../index";
import * as WebEntry from "../index.web";
import * as TestingEntry from "../testing";

const LOCKED = new Error("[nitro-error:keychain_locked] NitroStorage: locked");
const CORRUPT = new Error(
  "[nitro-error:storage_corruption] NitroStorage: undecodable",
);

function seedSecureKeys(values: Record<string, string>): void {
  mockHybridObject.getAllKeys.mockReturnValue(Object.keys(values));
  mockHybridObject.get.mockImplementation((key: string) => values[key]);
}

function setPlatform(os: "ios" | "android"): () => void {
  const { Platform } =
    jest.requireActual<typeof import("react-native")>("react-native");
  const original = Platform.OS;
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
  return () => {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: original,
    });
  };
}

beforeEach(() => {
  Object.values(mockHybridObject).forEach((fn) => fn.mockReset());
  mockHybridObject.getAllKeys.mockReturnValue([]);
  mockHybridObject.hasSecureBiometric.mockReturnValue(false);
  mockHybridObject.addOnChange.mockReturnValue(() => {});
  mockHybridObject.isProtectedDataAvailable.mockReturnValue(true);
  mockHybridObject.onProtectedDataAvailable.mockReturnValue(() => {});
  storage.setAccessControl(AccessControl.WhenUnlocked);
  jest.clearAllMocks();
});

describe("migrateSecureAccessControl", () => {
  it("rejects an invalid level before touching native storage", () => {
    for (const level of [-1, 5, 1.5, Number.NaN]) {
      expect(() => migrateSecureAccessControl(level as AccessControl)).toThrow(
        "Invalid access control level",
      );
    }
    expect(mockHybridObject.setSecureAccessControl).not.toHaveBeenCalled();
    expect(mockHybridObject.getAllKeys).not.toHaveBeenCalled();
    expect(mockHybridObject.set).not.toHaveBeenCalled();
  });

  it("rejects an invalid key before changing the default level", () => {
    expect(() =>
      migrateSecureAccessControl(AccessControl.AfterFirstUnlock, {
        keys: [""],
      }),
    ).toThrow();
    expect(mockHybridObject.setSecureAccessControl).not.toHaveBeenCalled();
  });

  it("rewrites every secure key with the new level and the exact stored bytes", () => {
    seedSecureKeys({ a: "1", b: "[2]" });

    const result = migrateSecureAccessControl(AccessControl.AfterFirstUnlock);

    expect(result).toEqual({
      migrated: ["a", "b"],
      locked: [],
      missing: [],
      skipped: [],
      failed: [],
    });
    expect(mockHybridObject.getAllKeys).toHaveBeenCalledWith(
      StorageScope.Secure,
    );
    expect(mockHybridObject.setSecureAccessControl).toHaveBeenCalledWith(
      AccessControl.AfterFirstUnlock,
    );
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "a",
      "1",
      StorageScope.Secure,
    );
    expect(mockHybridObject.set).toHaveBeenCalledWith(
      "b",
      "[2]",
      StorageScope.Secure,
    );
    const levelOrder =
      mockHybridObject.setSecureAccessControl.mock.invocationCallOrder[0];
    const firstWriteOrder = mockHybridObject.set.mock.invocationCallOrder[0];
    expect(levelOrder).toBeLessThan(firstWriteOrder);
    expect(mockHybridObject.remove).not.toHaveBeenCalled();
    expect(mockHybridObject.removeBatch).not.toHaveBeenCalled();
    expect(mockHybridObject.clear).not.toHaveBeenCalled();
  });

  it("makes the level the default for later raw secure writes", () => {
    migrateSecureAccessControl(AccessControl.AfterFirstUnlockThisDeviceOnly);
    mockHybridObject.setSecureAccessControl.mockClear();

    storage.setString("later", "v", StorageScope.Secure);

    expect(mockHybridObject.setSecureAccessControl).toHaveBeenCalledWith(
      AccessControl.AfterFirstUnlockThisDeviceOnly,
    );
  });

  it("leaves a key untouched and reports it when the read is locked", () => {
    mockHybridObject.getAllKeys.mockReturnValue(["a", "b"]);
    mockHybridObject.get.mockImplementation((key: string) => {
      if (key === "b") {
        throw LOCKED;
      }
      return "1";
    });

    const result = migrateSecureAccessControl(AccessControl.AfterFirstUnlock);

    expect(result.migrated).toEqual(["a"]);
    expect(result.locked).toEqual(["b"]);
    expect(mockHybridObject.set).toHaveBeenCalledTimes(1);
    expect(mockHybridObject.remove).not.toHaveBeenCalled();
  });

  it("reports a locked write without deleting the original value", () => {
    seedSecureKeys({ a: "1" });
    mockHybridObject.set.mockImplementation(() => {
      throw LOCKED;
    });

    const result = migrateSecureAccessControl(AccessControl.AfterFirstUnlock);

    expect(result.locked).toEqual(["a"]);
    expect(result.migrated).toEqual([]);
    expect(mockHybridObject.remove).not.toHaveBeenCalled();
    expect(mockHybridObject.removeBatch).not.toHaveBeenCalled();
  });

  it("skips biometric-protected items without reading them", () => {
    seedSecureKeys({ plain: "1", bio: "2" });
    mockHybridObject.hasSecureBiometric.mockImplementation(
      (key: string) => key === "bio",
    );

    const result = migrateSecureAccessControl(AccessControl.AfterFirstUnlock);

    expect(result.migrated).toEqual(["plain"]);
    expect(result.skipped).toEqual(["bio"]);
    expect(mockHybridObject.get).not.toHaveBeenCalledWith(
      "bio",
      StorageScope.Secure,
    );
    expect(mockHybridObject.getSecureBiometric).not.toHaveBeenCalled();
    expect(mockHybridObject.setSecureBiometricWithLevel).not.toHaveBeenCalled();
  });

  it("reports keys that vanished before the read as missing", () => {
    mockHybridObject.getAllKeys.mockReturnValue(["gone"]);
    mockHybridObject.get.mockReturnValue(undefined);

    const result = migrateSecureAccessControl(AccessControl.AfterFirstUnlock);

    expect(result.missing).toEqual(["gone"]);
    expect(mockHybridObject.set).not.toHaveBeenCalled();
  });

  it("reports other errors with their code and keeps going", () => {
    seedSecureKeys({ bad: "1", good: "2", odd: "3" });
    mockHybridObject.get.mockImplementation((key: string) => {
      if (key === "bad") {
        throw CORRUPT;
      }
      if (key === "odd") {
        throw new Error("plain failure");
      }
      return "2";
    });

    const result = migrateSecureAccessControl(AccessControl.AfterFirstUnlock);

    expect(result.migrated).toEqual(["good"]);
    expect(result.failed).toEqual([
      { key: "bad", code: "storage_corruption" },
      { key: "odd" },
    ]);
  });

  it("limits the work to the requested keys and ignores duplicates", () => {
    mockHybridObject.get.mockReturnValue("1");

    const result = migrateSecureAccessControl(AccessControl.AfterFirstUnlock, {
      keys: ["x", "x", "y"],
    });

    expect(result.migrated).toEqual(["x", "y"]);
    expect(mockHybridObject.getAllKeys).not.toHaveBeenCalled();
    expect(mockHybridObject.set).toHaveBeenCalledTimes(2);
  });

  it("applies the migration level to every rewrite after flushing queued writes", () => {
    const queued = createStorageItem<string>({
      key: "queued",
      scope: StorageScope.Secure,
      defaultValue: "",
      accessControl: AccessControl.WhenPasscodeSetThisDeviceOnly,
      coalesceSecureWrites: true,
    });
    queued.set("pending");
    seedSecureKeys({ a: "1", b: "2" });
    mockHybridObject.setSecureAccessControl.mockClear();
    mockHybridObject.set.mockClear();
    mockHybridObject.setBatch.mockClear();

    migrateSecureAccessControl(AccessControl.AfterFirstUnlock);

    const levelCalls = mockHybridObject.setSecureAccessControl.mock.calls.map(
      (call) => call[0],
    );
    const levelOrders =
      mockHybridObject.setSecureAccessControl.mock.invocationCallOrder;
    const rewriteOrders = mockHybridObject.set.mock.invocationCallOrder;
    expect(rewriteOrders.length).toBeGreaterThan(0);
    rewriteOrders.forEach((writeOrder) => {
      const lastLevelIndex = levelOrders.reduce(
        (found, order, index) => (order < writeOrder ? index : found),
        -1,
      );
      expect(levelCalls[lastLevelIndex]).toBe(AccessControl.AfterFirstUnlock);
    });
    queued.delete();
  });

  it("only records the default level on Android", () => {
    const restore = setPlatform("android");
    try {
      seedSecureKeys({ a: "1" });

      const result = migrateSecureAccessControl(AccessControl.AfterFirstUnlock);

      expect(result).toEqual({
        migrated: [],
        locked: [],
        missing: [],
        skipped: ["a"],
        failed: [],
      });
      expect(mockHybridObject.get).not.toHaveBeenCalled();
      expect(mockHybridObject.set).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("migrateSecureAccessControl on other entries", () => {
  it("validates, records the default, and skips keys on web", () => {
    WebEntry.storage.clearAll();
    WebEntry.storage.setString("w", "1", StorageScope.Secure);

    expect(() =>
      WebEntry.migrateSecureAccessControl(9 as AccessControl),
    ).toThrow("Invalid access control level");
    const result = WebEntry.migrateSecureAccessControl(
      AccessControl.AfterFirstUnlock,
    );

    expect(result.migrated).toEqual([]);
    expect(result.skipped).toEqual(["w"]);
    expect(WebEntry.storage.getAllKeys(StorageScope.Secure)).toEqual(["w"]);
    WebEntry.storage.clearAll();
  });

  it("rewrites in-memory secure values in the testing entry", () => {
    TestingEntry.resetNitroStorageMock();
    TestingEntry.storage.setString("t", "1", StorageScope.Secure);

    const result = TestingEntry.migrateSecureAccessControl(
      AccessControl.AfterFirstUnlock,
    );

    expect(result.migrated).toEqual(["t"]);
    expect(TestingEntry.storage.getString("t", StorageScope.Secure)).toBe("1");
    TestingEntry.resetNitroStorageMock();
  });
});

describe("protected data availability", () => {
  it("reads availability from the native module", () => {
    mockHybridObject.isProtectedDataAvailable.mockReturnValueOnce(false);

    expect(storage.isProtectedDataAvailable()).toBe(false);
    expect(storage.isProtectedDataAvailable()).toBe(true);
  });

  it("subscribes through the native module and unsubscribes", () => {
    const nativeUnsubscribe = jest.fn();
    mockHybridObject.onProtectedDataAvailable.mockReturnValue(
      nativeUnsubscribe,
    );
    const listener = jest.fn();

    const unsubscribe = storage.onProtectedDataAvailable(listener);
    expect(mockHybridObject.onProtectedDataAvailable).toHaveBeenCalledTimes(1);
    const registered = mockHybridObject.onProtectedDataAvailable.mock
      .calls[0] as unknown as [() => void];
    registered[0]();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(nativeUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("rejects a listener that is not a function", () => {
    expect(() =>
      storage.onProtectedDataAvailable(undefined as unknown as () => void),
    ).toThrow(TypeError);
    expect(mockHybridObject.onProtectedDataAvailable).not.toHaveBeenCalled();
  });

  it("reports available and never fires on web and testing entries", () => {
    for (const entry of [WebEntry, TestingEntry]) {
      const listener = jest.fn();
      expect(entry.storage.isProtectedDataAvailable()).toBe(true);
      const unsubscribe = entry.storage.onProtectedDataAvailable(listener);
      unsubscribe();
      unsubscribe();
      expect(listener).not.toHaveBeenCalled();
      expect(() =>
        entry.storage.onProtectedDataAvailable(null as unknown as () => void),
      ).toThrow(TypeError);
    }
  });
});
