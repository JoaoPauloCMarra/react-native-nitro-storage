import { createMockHybridObject } from "./helpers/mock-hybrid-object";

const mockHybridObject = createMockHybridObject({
  getAllKeys: jest.fn(() => []),
  getKeysByPrefix: jest.fn(() => []),
  size: jest.fn(() => 0),
  getBatch: jest.fn(() => []),
  addOnChange: jest.fn(() => () => {}),
  hasSecureBiometric: jest.fn(() => false),
});

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => mockHybridObject),
  },
}));

import { createStorageItem, getBatch, StorageScope, storage } from "../index";

const KEYCHAIN_LOCKED = new Error(
  "[nitro-error:keychain_locked] NitroStorage: Keychain is locked",
);

beforeEach(() => {
  jest.clearAllMocks();
  mockHybridObject.get.mockReset();
  mockHybridObject.getBatch.mockReset();
  mockHybridObject.getBatch.mockReturnValue([]);
  mockHybridObject.getAllKeys.mockReturnValue([]);
  mockHybridObject.hasSecureBiometric.mockReturnValue(false);
});

describe("fallbackToCacheOnReadError", () => {
  it("returns the last cached value when a secure read throws keychain_locked", () => {
    const onReadError = jest.fn();
    mockHybridObject.get.mockReturnValue("cached-secret");
    const item = createStorageItem<string>({
      key: "tok",
      scope: StorageScope.Secure,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
      fallbackToCacheOnReadError: true,
      onReadError,
    });

    // First read populates the raw-value cache from the backend.
    expect(item.get()).toBe("cached-secret");

    // Now the keychain becomes locked.
    mockHybridObject.get.mockImplementation(() => {
      throw KEYCHAIN_LOCKED;
    });
    // Invalidate the parsed cache so getInternal re-reads from the backend.
    (item as unknown as { _triggerListeners: () => void })._triggerListeners();

    expect(item.get()).toBe("cached-secret");
    expect(onReadError).toHaveBeenCalledWith(KEYCHAIN_LOCKED);
  });

  it("rethrows when fallback is not enabled", () => {
    const item = createStorageItem<string>({
      key: "tok2",
      scope: StorageScope.Secure,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
    });

    mockHybridObject.get.mockImplementation(() => {
      throw KEYCHAIN_LOCKED;
    });

    expect(() => item.get()).toThrow(/keychain_locked/);
  });
});

describe("getBatch read error options", () => {
  function lockKeychain(): void {
    mockHybridObject.get.mockImplementation(() => {
      throw KEYCHAIN_LOCKED;
    });
    mockHybridObject.getBatch.mockImplementation(() => {
      throw KEYCHAIN_LOCKED;
    });
  }

  it("honours fallbackToCacheOnReadError and onReadError like get()", () => {
    const onReadError = jest.fn();
    mockHybridObject.get.mockReturnValue("cached-secret");
    const item = createStorageItem<string>({
      key: "batch-tok",
      scope: StorageScope.Secure,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
      fallbackToCacheOnReadError: true,
      onReadError,
    });
    expect(item.get()).toBe("cached-secret");
    lockKeychain();
    (item as unknown as { _triggerListeners: () => void })._triggerListeners();

    expect(getBatch([item], StorageScope.Secure)).toEqual(["cached-secret"]);
    expect(onReadError).toHaveBeenCalledTimes(1);
    expect(onReadError).toHaveBeenCalledWith(KEYCHAIN_LOCKED);
  });

  it("calls onReadError and rethrows for an item with only onReadError", () => {
    const onReadError = jest.fn();
    const item = createStorageItem<string>({
      key: "batch-observed",
      scope: StorageScope.Secure,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
      onReadError,
    });
    lockKeychain();

    expect(() => getBatch([item], StorageScope.Secure)).toThrow(
      /keychain_locked/,
    );
    expect(onReadError).toHaveBeenCalledTimes(1);
  });

  it("still throws for an item without the options in one bridge call", () => {
    const item = createStorageItem<string>({
      key: "batch-plain",
      scope: StorageScope.Secure,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    lockKeychain();

    expect(() => getBatch([item], StorageScope.Secure)).toThrow(
      /keychain_locked/,
    );
    expect(mockHybridObject.getBatch).toHaveBeenCalledTimes(1);
    expect(mockHybridObject.get).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  storage.clearAll();
});
