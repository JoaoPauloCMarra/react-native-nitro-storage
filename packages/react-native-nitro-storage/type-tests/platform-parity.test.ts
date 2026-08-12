import type { PlatformScope, PlatformStorage } from "../src";
import type { PlatformStorage as PlatformStorageWeb } from "../src/index.web";
import type { PlatformStorage as PlatformStorageTesting } from "../src/testing";
import { StorageScope } from "../src";
import type { StorageCapabilities } from "../src";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

// The shared consumer surface must compile identically against every entry.
declare const nativeStorage: PlatformStorage;
declare const webStorage: PlatformStorageWeb;
declare const testingStorage: PlatformStorageTesting;

type NativeAssignableToShared = Assert<
  Equals<PlatformStorage, PlatformStorageWeb>
>;
type TestingAssignableToShared = Assert<
  Equals<PlatformStorage, PlatformStorageTesting>
>;

function consumePlatformStorage(store: PlatformStorage): void {
  store.setString("key", "value", StorageScope.Disk);
  const raw: string | undefined = store.getString("key", StorageScope.Disk);
  const allKeys: string[] = store.getAllKeys(StorageScope.Disk);
  const all: Record<string, string> = store.getAll(StorageScope.Disk);
  const size: number = store.size(StorageScope.Disk);
  const has: boolean = store.has("key", StorageScope.Disk);
  const prefix: string[] = store.getKeysByPrefix("p:", StorageScope.Disk);
  const byPrefix: Record<string, string> = store.getByPrefix(
    "p:",
    StorageScope.Disk,
  );
  store.deleteString("key", StorageScope.Disk);
  store.clear(StorageScope.Disk);
  store.clearAll();
  store.clearNamespace("ns", StorageScope.Disk);
  store.import({ a: "b" }, StorageScope.Disk);
  const exported: Record<string, string> = store.export(StorageScope.Disk);
  const unsubscribe = store.subscribe(StorageScope.Disk, () => {});
  const unsubscribeKey = store.subscribeKey(
    StorageScope.Disk,
    "key",
    () => {},
  );
  const unsubscribePrefix = store.subscribePrefix(
    StorageScope.Disk,
    "p",
    () => {},
  );
  store.setEventObserver(() => {});
  store.setEventObserver(undefined);
  store.setMetricsObserver(() => {});
  store.setMetricsObserver(undefined);
  store.getMetricsSnapshot();
  store.resetMetrics();
  store.setDiskWritesAsync(true);
  store.flushDiskWrites();
  store.flushSecureWrites();
  store.setAccessControl(0);
  store.setSecureWritesAsync(false);
  store.setKeychainAccessGroup("group");
  const capabilities: StorageCapabilities = store.getCapabilities();
  const scope: PlatformScope = StorageScope.Memory;
  const secureMetadata = store.getSecureMetadata("key");
  const secureMetadataList = store.getSecureMetadata.length;
  store.clearBiometric();
  unsubscribe();
  unsubscribeKey();
  unsubscribePrefix();
  void raw;
  void allKeys;
  void all;
  void size;
  void has;
  void prefix;
  void byPrefix;
  void exported;
  void capabilities;
  void scope;
  void secureMetadata;
  void secureMetadataList;
}

consumePlatformStorage(nativeStorage);
consumePlatformStorage(webStorage);
consumePlatformStorage(testingStorage);
