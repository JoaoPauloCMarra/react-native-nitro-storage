import { StorageScope } from "../Storage.types";
import {
  StorageEventRegistry,
  type StorageBatchChangeEvent,
} from "../storage-events";
import { createTestCore } from "./core-test-backend";

describe("StorageEventRegistry", () => {
  it("tracks listener presence and ignores double unsubscribe", () => {
    const registry = new StorageEventRegistry();
    const listener = jest.fn();

    expect(registry.hasListeners(StorageScope.Memory)).toBe(false);

    const unsubscribe = registry.subscribe(StorageScope.Memory, listener);
    expect(registry.hasListeners(StorageScope.Memory)).toBe(true);

    registry.emitKey({
      type: "key",
      scope: StorageScope.Memory,
      key: "count",
      oldValue: undefined,
      newValue: "1",
      operation: "set",
      source: "memory",
    });

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribe();
    expect(registry.hasListeners(StorageScope.Memory)).toBe(false);
  });

  it("notifies exact key listeners and removes empty key buckets", () => {
    const registry = new StorageEventRegistry();
    const listener = jest.fn();

    const unsubscribe = registry.subscribeKey(
      StorageScope.Disk,
      "settings:theme",
      listener,
    );

    registry.emitKey({
      type: "key",
      scope: StorageScope.Disk,
      key: "settings:other",
      oldValue: undefined,
      newValue: "light",
      operation: "set",
      source: "native",
    });
    expect(listener).not.toHaveBeenCalled();

    registry.emitKey({
      type: "key",
      scope: StorageScope.Disk,
      key: "settings:theme",
      oldValue: undefined,
      newValue: "dark",
      operation: "set",
      source: "native",
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(registry.hasListeners(StorageScope.Disk)).toBe(false);
  });

  it("filters prefix listeners for key and batch events", () => {
    const registry = new StorageEventRegistry();
    const listener = jest.fn();

    registry.subscribePrefix(StorageScope.Secure, "auth:", listener);

    registry.emitKey({
      type: "key",
      scope: StorageScope.Secure,
      key: "profile:name",
      oldValue: undefined,
      newValue: "Joao",
      operation: "set",
      source: "native",
    });
    expect(listener).not.toHaveBeenCalled();

    registry.emitBatch({
      type: "batch",
      scope: StorageScope.Secure,
      operation: "setBatch",
      source: "native",
      changes: [
        {
          type: "key",
          scope: StorageScope.Secure,
          key: "auth:access",
          oldValue: undefined,
          newValue: "access",
          operation: "setBatch",
          source: "native",
        },
        {
          type: "key",
          scope: StorageScope.Secure,
          key: "profile:name",
          oldValue: undefined,
          newValue: "Joao",
          operation: "setBatch",
          source: "native",
        },
      ],
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      type: "batch",
      changes: [{ key: "auth:access" }],
    });
  });

  it("does not notify prefix listeners for empty filtered batches", () => {
    const registry = new StorageEventRegistry();
    const listener = jest.fn();

    registry.subscribePrefix(StorageScope.Memory, "session:", listener);
    registry.emitBatch({
      type: "batch",
      scope: StorageScope.Memory,
      operation: "removeBatch",
      source: "memory",
      changes: [
        {
          type: "key",
          scope: StorageScope.Memory,
          key: "profile:name",
          oldValue: "Joao",
          newValue: undefined,
          operation: "removeBatch",
          source: "memory",
        },
      ],
    });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("storage.clear(Memory) events", () => {
  it("clear(Memory) emits every key, including non-string values", () => {
    const { createStorageItem, storage } = createTestCore();
    const obj = createStorageItem<{ n: number }>({
      key: "obj",
      scope: StorageScope.Memory,
      defaultValue: { n: 0 },
    });
    const str = createStorageItem({
      key: "str",
      scope: StorageScope.Memory,
      defaultValue: "",
    });
    obj.set({ n: 1 });
    str.set("s");
    const batches: StorageBatchChangeEvent[] = [];
    storage.subscribe(StorageScope.Memory, (event) => {
      if (event.type === "batch") {
        batches.push(event);
      }
    });
    const keyListener = jest.fn();
    storage.subscribeKey(StorageScope.Memory, "obj", keyListener);

    storage.clear(StorageScope.Memory);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.changes.map((change) => change.key)).toEqual([
      "obj",
      "str",
    ]);
    expect(keyListener).toHaveBeenCalledTimes(1);
  });
});
