import {
  AccessControl,
  BiometricLevel,
  StorageScope,
  type SecureStorageMetadata,
  type SecurityCapabilities,
  type StorageMetricsEvent,
  type StorageMetricsObserver,
  type StorageEventObserverOptions,
  type StorageExportOptions,
  type WebDiskStorageBackend,
  type WebSecureStorageBackend,
  createSecureAuthStorage,
  createStorageItem,
  getWebSecureStorageBackend,
  getBatch,
  removeBatch,
  setWebSecureStorageBackend,
  setBatch,
  storage,
  useSetStorage,
  useStorage,
  useStorageSelector,
} from "../src";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

const countItem = createStorageItem({
  key: "count",
  scope: StorageScope.Memory,
  defaultValue: 0,
});
countItem.set((prev) => prev + 1);
type CountValue = ReturnType<typeof countItem.get>;
type CountValueAssert = Assert<Equals<CountValue, number>>;

const [countValue, setCountValue] = useStorage(countItem);
const countValueNumber: number = countValue;
setCountValue((prev) => prev + 1);

const [isPositive, setPositiveSource] = useStorageSelector(
  countItem,
  (value) => value > 0,
);
const positiveBoolean: boolean = isPositive;
setPositiveSource(3);

const setCountOnly = useSetStorage(countItem);
setCountOnly(4);

const auth = createSecureAuthStorage(
  {
    accessToken: {
      ttlMs: 60_000,
      biometric: true,
      accessControl: AccessControl.AfterFirstUnlock,
    },
    refreshToken: {},
  },
  { namespace: "auth" },
);
auth.accessToken.set("token");
const accessTokenValue: string = auth.accessToken.get();
type AccessTokenAssert = Assert<Equals<typeof accessTokenValue, string>>;

setBatch([{ item: countItem, value: 5 }], StorageScope.Memory);
const values = getBatch([countItem], StorageScope.Memory);
const valuesUnknownArray: unknown[] = values;
removeBatch([countItem], StorageScope.Memory);

const versionedSnapshot = countItem.getWithVersion();
const versionToken: string = versionedSnapshot.version;
const casResult: boolean = countItem.setIfVersion(versionToken, 6);
void casResult;

const prefixedKeys = storage.getKeysByPrefix("auth:", StorageScope.Secure);
const prefixedEntries = storage.getByPrefix("auth:", StorageScope.Secure);
const prefixedKeysArray: string[] = prefixedKeys;
const prefixedEntriesRecord: Record<string, string> = prefixedEntries;
void prefixedKeysArray;
void prefixedEntriesRecord;

const metricsObserver: StorageMetricsObserver = (
  event: StorageMetricsEvent,
) => {
  const operationName: string = event.operation;
  void operationName;
};
storage.setMetricsObserver(metricsObserver);
storage.getMetricsSnapshot();
storage.resetMetrics();
storage.setMetricsObserver(undefined);
const observerOptions: StorageEventObserverOptions = {
  redactSecureValues: true,
};
storage.setEventObserver(() => {}, observerOptions);
storage.setEventObserver(undefined);

storage.setAccessControl(AccessControl.WhenUnlockedThisDeviceOnly);
storage.setSecureWritesAsync(true);
storage.flushSecureWrites();
storage.setKeychainAccessGroup("group.test");
storage.clearNamespace("auth", StorageScope.Secure);
const securityCapabilities: SecurityCapabilities =
  storage.getSecurityCapabilities();
const secureMetadata: SecureStorageMetadata =
  storage.getSecureMetadata("auth:accessToken");
const secureMetadataList: SecureStorageMetadata[] =
  storage.getAllSecureMetadata();
const exportOptions: StorageExportOptions = { includeSecureValues: true };
const secureExport: Record<string, string> = storage.export(
  StorageScope.Secure,
  exportOptions,
);
const secureUnsafeExport: Record<string, string> = storage.exportSecureUnsafe();
void securityCapabilities;
void secureMetadata;
void secureMetadataList;
void secureExport;
void secureUnsafeExport;

const typedWebDiskBackend: WebDiskStorageBackend = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  getAllKeys: () => [],
};
const typedWebSecureBackend: WebSecureStorageBackend = typedWebDiskBackend;
void typedWebSecureBackend;

setWebSecureStorageBackend(undefined);
getWebSecureStorageBackend();

const level: BiometricLevel = BiometricLevel.BiometryOnly;
const levelNumber: number = level;

// Ensure compile-time only references are used.
void countValueNumber;
void positiveBoolean;
void valuesUnknownArray;
void levelNumber;

createStorageItem({
  key: "bad-expiration",
  scope: StorageScope.Disk,
  defaultValue: "",
  // @ts-expect-error invalid expiration config shape
  expiration: {},
});
