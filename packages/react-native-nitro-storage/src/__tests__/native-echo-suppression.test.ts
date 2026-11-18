import { createMockHybridObject } from "./helpers/mock-hybrid-object";

type NativeListener = (key: string, value: string | undefined) => void;

const nativeListeners = new Map<number, NativeListener>();

const mockHybridObject = createMockHybridObject({
  getAllKeys: jest.fn(() => []),
  getKeysByPrefix: jest.fn(() => []),
  size: jest.fn(() => 0),
  getBatch: jest.fn(() => []),
  addOnChange: jest.fn((scope: number, listener: NativeListener) => {
    nativeListeners.set(scope, listener);
    return () => {
      nativeListeners.delete(scope);
    };
  }),
});

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn(() => mockHybridObject),
  },
}));

import {
  createStorageItem,
  removeBatch,
  storage,
  StorageScope,
  type StorageChangeEvent,
} from "../index";
import { serializeWithPrimitiveFastPath } from "../internal";

function emitNative(
  scope: StorageScope,
  key: string,
  value: string | undefined,
): void {
  const listener = nativeListeners.get(scope);
  if (listener === undefined) {
    throw new Error("no native listener");
  }
  listener(key, value);
}

function flushedKeys(setBatchMock: jest.Mock): string[] {
  return setBatchMock.mock.calls.flatMap((call) => call[0] as string[]);
}

afterEach(() => {
  storage.setDiskWritesAsync(false);
  storage.setSecureWritesAsync(false);
  jest.clearAllMocks();
});

describe("native echo suppression with coalesced writes", () => {
  it("does not swallow an external Disk change after N coalesced sets of one key", () => {
    const key = "echo-disk";
    const item = createStorageItem({
      key,
      scope: StorageScope.Disk,
      defaultValue: "",
    });
    const events: StorageChangeEvent[] = [];
    const unsubscribe = storage.subscribe(StorageScope.Disk, (event) => {
      events.push(event);
    });
    storage.setDiskWritesAsync(true);

    item.set("a");
    item.set("b");
    item.set("c");
    storage.flushDiskWrites();

    expect(flushedKeys(mockHybridObject.setBatch)).toContain(key);
    events.length = 0;

    const stored = serializeWithPrimitiveFastPath("c");
    emitNative(StorageScope.Disk, key, stored);

    const external = serializeWithPrimitiveFastPath("from-outside");
    emitNative(StorageScope.Disk, key, external);
    unsubscribe();

    expect(
      events.filter(
        (event) => event.type === "key" && event.operation === "external",
      ),
    ).toHaveLength(1);
    const externalEvent = events.find(
      (event) => event.type === "key" && event.operation === "external",
    );
    expect(externalEvent).toMatchObject({ newValue: external });
  });

  it("does not swallow an external Secure change after N coalesced sets of one key", () => {
    const key = "echo-secure";
    const item = createStorageItem({
      key,
      scope: StorageScope.Secure,
      defaultValue: "",
      coalesceSecureWrites: true,
    });
    const events: StorageChangeEvent[] = [];
    const unsubscribe = storage.subscribe(StorageScope.Secure, (event) => {
      events.push(event);
    });

    item.set("a");
    item.set("b");
    item.set("c");
    storage.flushSecureWrites();

    events.length = 0;
    emitNative(StorageScope.Secure, key, serializeWithPrimitiveFastPath("c"));
    emitNative(
      StorageScope.Secure,
      key,
      serializeWithPrimitiveFastPath("from-outside"),
    );
    unsubscribe();

    expect(
      events.filter(
        (event) => event.type === "key" && event.operation === "external",
      ),
    ).toHaveLength(1);
  });
});

describe("native echo suppression stays balanced with the native notify count", () => {
  type QueuedEcho = {
    scope: StorageScope;
    key: string;
    value: string | undefined;
  };
  let queue: QueuedEcho[] = [];

  beforeEach(() => {
    queue = [];
    mockHybridObject.set.mockImplementation(
      (key: string, value: string, scope: StorageScope) => {
        queue.push({ scope, key, value });
      },
    );
    mockHybridObject.remove.mockImplementation(
      (key: string, scope: StorageScope) => {
        queue.push({ scope, key, value: undefined });
      },
    );
    mockHybridObject.setBatch.mockImplementation(
      (keys: string[], values: string[], scope: StorageScope) => {
        keys.forEach((key, index) => {
          queue.push({ scope, key, value: values[index] });
        });
      },
    );
    mockHybridObject.removeBatch.mockImplementation(
      (keys: string[], scope: StorageScope) => {
        keys.forEach((key) => {
          queue.push({ scope, key, value: undefined });
        });
      },
    );
  });

  afterEach(() => {
    mockHybridObject.set.mockReset();
    mockHybridObject.remove.mockReset();
    mockHybridObject.setBatch.mockReset();
    mockHybridObject.removeBatch.mockReset();
  });

  function deliverNativeEchoes(): number {
    const echoes = queue;
    queue = [];
    echoes.forEach((echo) => {
      emitNative(echo.scope, echo.key, echo.value);
    });
    return echoes.length;
  }

  function externalEvents(events: StorageChangeEvent[]): StorageChangeEvent[] {
    return events.filter(
      (event) => event.type === "key" && event.operation === "external",
    );
  }

  it("keeps a later external change after removeBatch follows coalesced removes of one key", () => {
    const key = "echo-remove-batch";
    const item = createStorageItem({
      key,
      scope: StorageScope.Disk,
      defaultValue: "",
    });
    const events: StorageChangeEvent[] = [];
    const unsubscribe = storage.subscribe(StorageScope.Disk, (event) => {
      events.push(event);
    });
    storage.setDiskWritesAsync(true);

    item.delete();
    item.delete();
    item.delete();
    removeBatch([item], StorageScope.Disk);

    expect(deliverNativeEchoes()).toBe(2);
    events.length = 0;

    emitNative(
      StorageScope.Disk,
      key,
      serializeWithPrimitiveFastPath("from-outside"),
    );
    unsubscribe();

    expect(externalEvents(events)).toHaveLength(1);
  });

  it("leaves no suppression mark when the flush throws", () => {
    const key = "echo-flush-throws";
    const item = createStorageItem({
      key,
      scope: StorageScope.Disk,
      defaultValue: "",
    });
    const events: StorageChangeEvent[] = [];
    const unsubscribe = storage.subscribe(StorageScope.Disk, (event) => {
      events.push(event);
    });
    storage.setDiskWritesAsync(true);

    item.set("a");
    item.set("b");
    mockHybridObject.setBatch.mockImplementationOnce(() => {
      throw new Error("[nitro-error:storage_full] NitroStorage: injected");
    });
    expect(() => storage.flushDiskWrites()).toThrow("storage_full");
    expect(deliverNativeEchoes()).toBe(0);
    events.length = 0;

    emitNative(
      StorageScope.Disk,
      key,
      serializeWithPrimitiveFastPath("from-outside"),
    );
    unsubscribe();

    expect(externalEvents(events)).toHaveLength(1);
  });

  it("keeps a later external change after a synchronous set on a key with a pending coalesced write", () => {
    const key = "echo-sync-over-pending";
    const item = createStorageItem({
      key,
      scope: StorageScope.Disk,
      defaultValue: "",
    });
    const events: StorageChangeEvent[] = [];
    const unsubscribe = storage.subscribe(StorageScope.Disk, (event) => {
      events.push(event);
    });
    storage.setDiskWritesAsync(true);

    item.set("a");
    item.set("b");
    storage.setDiskWritesAsync(false);
    item.set("c");

    expect(deliverNativeEchoes()).toBe(2);
    events.length = 0;

    emitNative(
      StorageScope.Disk,
      key,
      serializeWithPrimitiveFastPath("from-outside"),
    );
    unsubscribe();

    expect(externalEvents(events)).toHaveLength(1);
  });
});
