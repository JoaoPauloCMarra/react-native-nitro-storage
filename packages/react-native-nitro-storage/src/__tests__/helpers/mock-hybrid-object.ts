import type { HybridObject } from "react-native-nitro-modules";
import type { Storage } from "../../Storage.nitro";

type StorageSpecMethod = Exclude<
  keyof Storage,
  keyof HybridObject<{ ios: "c++" }>
>;

export type MockHybridObject = Record<StorageSpecMethod, jest.Mock>;

export function createMockHybridObject(
  overrides: Partial<MockHybridObject> = {},
): MockHybridObject {
  return {
    set: jest.fn(),
    get: jest.fn(),
    remove: jest.fn(),
    clear: jest.fn(),
    has: jest.fn(),
    getAllKeys: jest.fn(),
    getKeysByPrefix: jest.fn(),
    size: jest.fn(),
    setBatch: jest.fn(),
    getBatch: jest.fn(),
    removeBatch: jest.fn(),
    removeByPrefix: jest.fn(),
    addOnChange: jest.fn(),
    setSecureAccessControl: jest.fn(),
    setSecureWritesAsync: jest.fn(),
    setKeychainAccessGroup: jest.fn(),
    setSecureBiometric: jest.fn(),
    setSecureBiometricWithLevel: jest.fn(),
    getSecureBiometric: jest.fn(),
    deleteSecureBiometric: jest.fn(),
    hasSecureBiometric: jest.fn(),
    clearSecureBiometric: jest.fn(),
    isProtectedDataAvailable: jest.fn(() => true),
    onProtectedDataAvailable: jest.fn(() => () => {}),
    ...overrides,
  };
}
