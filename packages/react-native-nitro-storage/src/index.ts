import { useSyncExternalStore, useMemo } from "react";
import { NitroModules } from "react-native-nitro-modules";
import type { Storage, StorageScope } from "./Storage.nitro";
import { StorageScope as StorageScopeEnum } from "./Storage.nitro";

export { StorageScope } from "./Storage.nitro";
export type { Storage } from "./Storage.nitro";

let _storageModule: Storage | null = null;

function getStorageModule(): Storage {
  if (!_storageModule) {
    _storageModule = NitroModules.createHybridObject<Storage>("Storage");
  }
  return _storageModule!;
}

const memoryStore = new Map<string, any>();
const memoryListeners = new Set<(key: string, value: any) => void>();

function notifyMemoryListeners(key: string, value: any) {
  memoryListeners.forEach((listener) => listener(key, value));
}

export const storage = {
  clear: (scope: StorageScope.Memory) => {
    memoryStore.clear();
  },
  clearAll: () => {
    storage.clear(StorageScopeEnum.Memory);
  },
};

export interface StorageItemConfig<T> {
  key: string;
  scope: StorageScope;
  defaultValue?: T;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
}

export interface StorageItem<T> {
  get: () => T;
  set: (value: T | ((prev: T) => T)) => void;
  delete: () => void;
  subscribe: (callback: () => void) => () => void;
  scope: StorageScope;
  key: string;
}

function defaultSerialize<T>(value: T): string {
  return JSON.stringify(value);
}

function defaultDeserialize<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function createStorageItem<T = undefined>(
  config: StorageItemConfig<T>
): StorageItem<T> {
  const serialize = config.serialize ?? defaultSerialize;
  const deserialize = config.deserialize ?? defaultDeserialize;
  const isMemory = config.scope === StorageScopeEnum.Memory;

  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;

  const ensureSubscription = () => {
    if (!unsubscribe) {
      if (isMemory) {
        const listener = (key: string) => {
          if (key === config.key) {
            listeners.forEach((l) => l());
          }
        };
        memoryListeners.add(listener);
        unsubscribe = () => memoryListeners.delete(listener);
      } else {
        unsubscribe = getStorageModule().addOnChange(config.scope, (key) => {
          if (key === config.key) {
            listeners.forEach((listener) => listener());
          }
        });
      }
    }
  };

  let lastRaw: string | any | undefined;
  let lastValue: T | undefined;

  const get = (): T => {
    let raw: string | any;

    if (isMemory) {
      raw = memoryStore.get(config.key);
    } else {
      raw = getStorageModule().get(config.key, config.scope);
    }

    if (raw === lastRaw && lastValue !== undefined) {
      return lastValue;
    }

    lastRaw = raw;

    if (raw === undefined) {
      lastValue = config.defaultValue as T;
    } else {
      if (isMemory) {
        lastValue = raw as T;
      } else {
        lastValue = deserialize(raw);
      }
    }

    return lastValue;
  };

  const set = (valueOrFn: T | ((prev: T) => T)): void => {
    const currentValue = get();
    const newValue =
      valueOrFn instanceof Function
        ? (valueOrFn as Function)(currentValue)
        : valueOrFn;

    if (isMemory) {
      memoryStore.set(config.key, newValue);
      notifyMemoryListeners(config.key, newValue);
    } else {
      const serialized = serialize(newValue);
      getStorageModule().set(config.key, serialized, config.scope);
    }
  };

  const deleteItem = (): void => {
    if (isMemory) {
      memoryStore.delete(config.key);
      notifyMemoryListeners(config.key, undefined);
    } else {
      getStorageModule().remove(config.key, config.scope);
    }
  };

  const subscribe = (callback: () => void): (() => void) => {
    ensureSubscription();
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0 && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
  };

  return {
    get,
    set,
    delete: deleteItem,
    subscribe,
    scope: config.scope,
    key: config.key,
  };
}

export function useStorage<T>(
  item: StorageItem<T>
): [T, (value: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(item.subscribe, item.get, item.get);
  return [value, item.set];
}

export function useSetStorage<T>(item: StorageItem<T>) {
  return item.set;
}
