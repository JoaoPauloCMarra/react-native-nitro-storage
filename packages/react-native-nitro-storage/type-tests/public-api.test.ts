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
  type StorageItemConfig,
  type StorageSetter,
  type WebDiskStorageBackend,
  type WebSecureStorageBackend,
  createSecureAuthStorage,
  createSetItem,
  createStorageItem,
  diskItem,
  getWebSecureStorageBackend,
  getBatch,
  memoryItem,
  removeBatch,
  secureItem,
  setWebSecureStorageBackend,
  setBatch,
  storage,
  useSetStorage,
  useStorage,
  useStorageActions,
  useStorageValue,
  useStorageSelector,
  type SetStorageItem,
  type StorageActions,
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
const setCountOnlyTyped: StorageSetter<number> = setCountOnly;
setCountOnly(4);
void setCountOnlyTyped;

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
const firstValue: number = values[0];
removeBatch([countItem], StorageScope.Memory);

const themeItem = createStorageItem({
  key: "theme",
  scope: StorageScope.Memory,
  defaultValue: "system" as "system" | "light" | "dark",
});
const batchTuple = getBatch(
  [countItem, themeItem] as const,
  StorageScope.Memory,
);
const typedCountFromBatch: number = batchTuple[0];
const typedThemeFromBatch: "system" | "light" | "dark" = batchTuple[1];
void typedCountFromBatch;
void typedThemeFromBatch;

setBatch(
  [
    { item: countItem, value: 7 },
    { item: themeItem, value: "dark" },
  ],
  StorageScope.Memory,
);
setBatch(
  [
    {
      item: countItem,
      // @ts-expect-error batch values must match their item value type
      value: "seven",
    },
  ],
  StorageScope.Memory,
);

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
void firstValue;
void levelNumber;

const preferencesConfig = {
  key: "preferences",
  scope: StorageScope.Disk,
  defaultValue: { theme: "system", compactMode: false },
} satisfies StorageItemConfig<{
  theme: "system" | "light" | "dark";
  compactMode: boolean;
}>;
void preferencesConfig;

createStorageItem({
  key: "bad-expiration",
  scope: StorageScope.Disk,
  defaultValue: "",
  // @ts-expect-error invalid expiration config shape
  expiration: {},
});

// --- New ergonomics surface ---

type Config = { theme: "light" | "dark"; compact: boolean };
const configItem = memoryItem<Config>({
  key: "config",
  defaultValue: { theme: "light", compact: false },
  group: "ui",
});
configItem.merge({ compact: true });
configItem.reset();
configItem.setOrDelete(null);

const diskFlag = diskItem<boolean>({ key: "flag", defaultValue: false });
const secureSecret = secureItem<string>({
  key: "secret",
  defaultValue: "",
  renameFrom: ["legacy-secret"],
  fallbackToCacheOnReadError: true,
  onReadError: (error: unknown) => {
    void error;
  },
});
void diskFlag;
void secureSecret;

const seenIds: SetStorageItem = createSetItem({
  key: "seen",
  scope: StorageScope.Disk,
  defaultValue: ["a"],
});
seenIds.add("b");
const seenToggleResult: boolean = seenIds.toggle("c");
const seenValues: string[] = seenIds.values();
void seenToggleResult;
void seenValues;

// createSetItem is generic over its member type for typed-id sets.
const colorSet = createSetItem<"red" | "blue">({
  key: "colors",
  scope: StorageScope.Disk,
  defaultValue: ["red"],
});
colorSet.add("blue");
const colorIsSet: boolean = colorSet.has("red");
const colorValues: ("red" | "blue")[] = colorSet.values();
const colorMembership: Partial<Record<"red" | "blue", true>> = colorSet.get();
// @ts-expect-error a set member may be absent from the returned map
const definitelyRed: true = colorMembership.red;
// @ts-expect-error "green" is not a valid member of this set
colorSet.add("green");
void colorIsSet;
void colorValues;
void colorMembership;
void definitelyRed;

storage.clear(StorageScope.Disk, { except: [diskFlag, "literal-key"] });
storage.clearGroup("ui");
const groupItems = storage.getGroupItems("ui");
const duplicateKeys = storage.findDuplicateKeys();
const registeredKeys = storage.getRegisteredKeys();
const unsubscribeExpired = storage.subscribeExpired(
  StorageScope.Memory,
  (event) => {
    const expiredKey: string = event.key;
    void expiredKey;
  },
);
unsubscribeExpired();
void groupItems;
void duplicateKeys;
void registeredKeys;

const [, , configActions] = useStorage(configItem);
const typedActions: StorageActions<Config> = configActions;
typedActions.merge({ compact: false });
typedActions.reset();
typedActions.remove();
typedActions.setOrDelete({ theme: "dark", compact: true });

const valueOnly: Config = useStorageValue(configItem);
const actionsOnly = useStorageActions(configItem);
actionsOnly.set({ theme: "dark", compact: false });
void typedActions;
void valueOnly;
void actionsOnly;
