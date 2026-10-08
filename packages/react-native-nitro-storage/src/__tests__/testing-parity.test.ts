jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => ({})),
  },
}));

import * as NativeEntry from "../index";
import * as TestingEntry from "../testing";
import * as WebEntry from "../index.web";
import {
  createStorageItem,
  flushWebStorageBackends,
  resetNitroStorageMock,
  storage,
} from "../testing";
import { StorageScope } from "../Storage.types";

const TESTING_ONLY_EXPORTS = new Set([
  "resetNitroStorageMock",
  "createNitroStorageMock",
  "setMockProtectedDataAvailable",
]);

beforeEach(() => {
  resetNitroStorageMock();
});

describe("testing entry parity", () => {
  it("exports every runtime export of the native entry", () => {
    const missing = Object.keys(NativeEntry).filter(
      (name) => !(name in TestingEntry),
    );
    expect(missing).toEqual([]);
  });

  it("exports the same runtime names as the native and web entries", () => {
    const testingNames = Object.keys(TestingEntry)
      .filter((name) => !TESTING_ONLY_EXPORTS.has(name))
      .sort();
    expect(Object.keys(NativeEntry).sort()).toEqual(testingNames);
    expect(Object.keys(WebEntry).sort()).toEqual(testingNames);
  });

  it("resolves the web backend no-ops", async () => {
    await expect(flushWebStorageBackends()).resolves.toBeUndefined();
    expect(TestingEntry.getWebDiskStorageBackend()).toBeUndefined();
    expect(TestingEntry.getWebSecureStorageBackend()).toBeUndefined();
  });
});

describe("testing entry listeners", () => {
  it.each([StorageScope.Disk, StorageScope.Secure])(
    "notifies item subscribers in scope %s",
    (scope) => {
      const item = createStorageItem({
        key: `listened-${scope}`,
        scope,
        defaultValue: 0,
      });
      const listener = jest.fn();
      const unsubscribe = item.subscribe(listener);

      item.set(1);
      item.delete();
      storage.setString(item.key, "2", scope);
      storage.clear(scope);

      expect(listener).toHaveBeenCalledTimes(4);
      unsubscribe();
    },
  );

  it("notifies biometric item subscribers", () => {
    const item = createStorageItem({
      key: "listened-bio",
      scope: StorageScope.Secure,
      defaultValue: "",
      biometric: true,
    });
    const listener = jest.fn();
    const unsubscribe = item.subscribe(listener);

    item.set("a");
    item.delete();

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
