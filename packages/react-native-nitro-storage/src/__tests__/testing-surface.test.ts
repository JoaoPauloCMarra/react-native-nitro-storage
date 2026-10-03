import {
  createSecureAuthStorage,
  createSetItem,
  createStorageItem,
  diskItem,
  getBatch,
  isStorageError,
  memoryItem,
  migrateToLatest,
  registerMigration,
  removeBatch,
  resetNitroStorageMock,
  runTransaction,
  secureItem,
  setBatch,
  storage,
  type MigrationContext,
  type TransactionContext,
} from "../testing";
import { StorageScope } from "../Storage.types";

beforeEach(() => {
  resetNitroStorageMock();
});

describe("testing module default singleton surface", () => {
  it("matches exact storage error codes through the testing entrypoint", () => {
    const locked = new Error(
      "[nitro-error:keychain_locked] NitroStorage: locked",
    );
    expect(isStorageError(locked, "keychain_locked")).toBe(true);
    expect(isStorageError(locked, "key_invalidated")).toBe(false);
  });

  it("supports batch operations and prefix/size queries on disk", () => {
    const a = createStorageItem<string>({
      key: "b:a",
      scope: StorageScope.Disk,
      defaultValue: "-",
    });
    const b = createStorageItem<string>({
      key: "b:b",
      scope: StorageScope.Disk,
      defaultValue: "-",
    });

    setBatch(
      [
        { item: a, value: "A" },
        { item: b, value: "B" },
      ],
      StorageScope.Disk,
    );
    expect(getBatch([a, b], StorageScope.Disk)).toEqual(["A", "B"]);
    expect(storage.size(StorageScope.Disk)).toBe(2);
    expect(storage.getKeysByPrefix("b:", StorageScope.Disk).sort()).toEqual([
      "b:a",
      "b:b",
    ]);
    expect(storage.getAllKeys(StorageScope.Disk).length).toBe(2);

    storage.clearNamespace("b", StorageScope.Disk);
    expect(storage.size(StorageScope.Disk)).toBe(0);

    removeBatch([a, b], StorageScope.Disk);
  });

  it("runs transactions and migrations", () => {
    const balance = memoryItem<number>({ key: "bal", defaultValue: 0 });
    runTransaction(StorageScope.Memory, (tx) => {
      tx.setItem(balance, 100);
    });
    expect(balance.get()).toBe(100);

    const migrated = createStorageItem<string>({
      key: "mig",
      scope: StorageScope.Disk,
      defaultValue: "",
      serialize: (v) => v,
      deserialize: (v) => v,
    });
    migrated.set("lower");
    registerMigration(1, ({ getRaw, setRaw }) => {
      const raw = getRaw("mig");
      if (raw !== undefined) {
        setRaw("mig", raw.toUpperCase());
      }
    });
    migrateToLatest(StorageScope.Disk);
    expect(migrated.get()).toBe("LOWER");
  });

  it("supports secure items, secure auth storage, and set items", () => {
    const token = secureItem<string>({ key: "tok", defaultValue: "" });
    token.set("secret");
    expect(token.get()).toBe("secret");

    const auth = createSecureAuthStorage({ accessToken: {}, refreshToken: {} });
    auth.accessToken.set("at");
    expect(auth.accessToken.get()).toBe("at");

    const flags = createSetItem({ key: "flags", scope: StorageScope.Disk });
    flags.add("one");
    flags.add("two");
    expect(flags.size()).toBe(2);
    flags.delete("one");
    expect(flags.has("one")).toBe(false);
    flags.clear();
    expect(flags.size()).toBe(0);
  });

  it("matches native secure batch removal across plain and biometric storage", () => {
    const plain = secureItem<string>({
      key: "parallel-secure",
      defaultValue: "",
    });
    const biometric = secureItem<string>({
      key: "parallel-secure",
      defaultValue: "",
      biometric: true,
    });
    biometric.set("biometric");
    plain.set("plain");

    removeBatch([plain], StorageScope.Secure);

    expect(plain.has()).toBe(false);
    expect(biometric.has()).toBe(false);
  });

  it.each([StorageScope.Disk, StorageScope.Secure])(
    "cleans rename aliases when removing a recreated item in scope %s",
    (scope) => {
      const createItem = scope === StorageScope.Disk ? diskItem : secureItem;
      const legacyKey = `batch-remove-legacy-${scope}`;
      const currentKey = `batch-remove-current-${scope}`;
      const current = createItem<string>({
        key: currentKey,
        defaultValue: "",
        renameFrom: legacyKey,
      });
      current.set("current");
      storage.setString(legacyKey, "stale", scope);

      removeBatch([current], scope);

      const recreated = createItem<string>({
        key: currentKey,
        defaultValue: "default",
        renameFrom: legacyKey,
      });
      expect(recreated.get()).toBe("default");
      expect(storage.has(legacyKey, scope)).toBe(false);
    },
  );

  it("removes keys by prefix via clearNamespace on disk", () => {
    storage.setString("ns:1", "a", StorageScope.Disk);
    storage.setString("ns:2", "b", StorageScope.Disk);
    storage.setString("other", "c", StorageScope.Disk);
    storage.clearNamespace("ns", StorageScope.Disk);
    expect(storage.getAllKeys(StorageScope.Disk)).toEqual(["other"]);
  });
});

describe("synchronous transaction callbacks", () => {
  it.each([StorageScope.Memory, StorageScope.Disk, StorageScope.Secure])(
    "rejects async callbacks and rolls back synchronous writes in scope %s",
    async (scope) => {
      const existingKey = `async-transaction-existing-${scope}`;
      const createdKey = `async-transaction-created-${scope}`;
      storage.setString(existingKey, "before", scope);
      let retainedContext: TransactionContext | undefined;
      const asyncCallback: (context: TransactionContext) => unknown = async (
        context,
      ) => {
        retainedContext = context;
        context.setRaw(existingKey, "during");
        context.setRaw(createdKey, "created");
        await Promise.resolve();
        context.setRaw(existingKey, "after");
      };

      expect(() => runTransaction(scope, asyncCallback)).toThrow(TypeError);
      expect(storage.getString(existingKey, scope)).toBe("before");
      expect(storage.getString(createdKey, scope)).toBeUndefined();

      await Promise.resolve();

      expect(storage.getString(existingKey, scope)).toBe("before");
      expect(storage.getString(createdKey, scope)).toBeUndefined();
      expect(retainedContext).toBeDefined();
      expect(() => retainedContext!.setRaw(existingKey, "late")).toThrow(
        TypeError,
      );
    },
  );

  it("rejects Promise and thenable results and consumes their rejections", async () => {
    const promiseKey = "rejected-transaction-promise";
    const rejectedPromiseCallback: (context: TransactionContext) => unknown = (
      context,
    ) => {
      context.setRaw(promiseKey, "temporary");
      return Promise.reject(new Error("rejected transaction"));
    };

    expect(() =>
      runTransaction(StorageScope.Memory, rejectedPromiseCallback),
    ).toThrow(TypeError);

    const thenableKey = "rejected-transaction-thenable";
    const rejectedThenable = {
      then: (
        _resolve: (value: unknown) => void,
        reject: (reason: unknown) => void,
      ) => {
        reject(new Error("rejected thenable"));
      },
    };
    const thenableCallback: (context: TransactionContext) => unknown = (
      context,
    ) => {
      context.setRaw(thenableKey, "temporary");
      return rejectedThenable;
    };

    expect(() => runTransaction(StorageScope.Memory, thenableCallback)).toThrow(
      TypeError,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(storage.getString(promiseKey, StorageScope.Memory)).toBeUndefined();
    expect(storage.getString(thenableKey, StorageScope.Memory)).toBeUndefined();
  });

  it("closes every context method after callback success and failure", () => {
    const item = memoryItem({ key: "closed-context-item", defaultValue: "" });
    const operations = (context: TransactionContext) => [
      () => context.getRaw("closed-context-raw"),
      () => context.setRaw("closed-context-raw", "value"),
      () => context.removeRaw("closed-context-raw"),
      () => context.getItem(item),
      () => context.setItem(item, "value"),
      () => context.removeItem(item),
    ];
    let successfulContext: TransactionContext | undefined;

    const result = runTransaction(StorageScope.Memory, (context) => {
      successfulContext = context;
      return "completed";
    });

    expect(result).toBe("completed");
    expect(successfulContext).toBeDefined();
    operations(successfulContext!).forEach((operation) => {
      expect(operation).toThrow(TypeError);
    });

    let failedContext: TransactionContext | undefined;
    expect(() =>
      runTransaction(StorageScope.Memory, (context) => {
        failedContext = context;
        context.setRaw("closed-context-rollback", "temporary");
        throw new Error("transaction failed");
      }),
    ).toThrow("transaction failed");

    expect(failedContext).toBeDefined();
    operations(failedContext!).forEach((operation) => {
      expect(operation).toThrow(TypeError);
    });
    expect(
      storage.getString("closed-context-rollback", StorageScope.Memory),
    ).toBeUndefined();
  });

  it("rejects an async migration without applying writes or its version", async () => {
    const migrationVersion = 2_000_000;
    const migrationVersionKey = "__nitro_storage_migration_version__";
    storage.setString(
      migrationVersionKey,
      String(migrationVersion - 1),
      StorageScope.Memory,
    );
    const asyncMigration: (context: MigrationContext) => unknown = async ({
      setRaw,
    }) => {
      setRaw("async-migration-value", "during");
      await Promise.resolve();
      setRaw("async-migration-value", "after");
    };
    registerMigration(migrationVersion, asyncMigration);

    expect(() => migrateToLatest(StorageScope.Memory)).toThrow(TypeError);
    expect(
      storage.getString("async-migration-value", StorageScope.Memory),
    ).toBeUndefined();
    expect(storage.getString(migrationVersionKey, StorageScope.Memory)).toBe(
      String(migrationVersion - 1),
    );

    await Promise.resolve();

    expect(
      storage.getString("async-migration-value", StorageScope.Memory),
    ).toBeUndefined();
    expect(storage.getString(migrationVersionKey, StorageScope.Memory)).toBe(
      String(migrationVersion - 1),
    );
  });
});
