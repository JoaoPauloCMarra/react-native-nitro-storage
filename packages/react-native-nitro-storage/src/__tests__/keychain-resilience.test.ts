const mockHybridObject = {
  set: jest.fn(),
  get: jest.fn(),
  remove: jest.fn(),
  clear: jest.fn(),
  has: jest.fn(),
  getAllKeys: jest.fn(() => []),
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
};

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => mockHybridObject),
  },
}));

import { createStorageItem, StorageScope, storage } from "../index";

const KEYCHAIN_LOCKED = new Error(
  "[nitro-error:keychain_locked] NitroStorage: Keychain is locked",
);

beforeEach(() => {
  jest.clearAllMocks();
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

afterAll(() => {
  storage.clearAll();
});
