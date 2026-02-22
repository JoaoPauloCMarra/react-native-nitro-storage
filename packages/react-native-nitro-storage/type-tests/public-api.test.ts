import {
  AccessControl,
  BiometricLevel,
  StorageScope,
  createSecureAuthStorage,
  createStorageItem,
  getBatch,
  removeBatch,
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

storage.setAccessControl(AccessControl.WhenUnlockedThisDeviceOnly);
storage.setSecureWritesAsync(true);
storage.flushSecureWrites();
storage.setKeychainAccessGroup("group.test");
storage.clearNamespace("auth", StorageScope.Secure);

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
