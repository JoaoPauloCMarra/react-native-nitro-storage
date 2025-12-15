import { useSyncExternalStore } from "react";
import { NitroModules } from "react-native-nitro-modules";
import type { Storage, StorageScope } from "./Storage.nitro";

export { StorageScope } from "./Storage.nitro";
export type { Storage } from "./Storage.nitro";

let _storageModule: Storage | null = null;

function getStorageModule(): Storage {
  if (!_storageModule) {
    _storageModule = NitroModules.createHybridObject<Storage>("Storage");
  }
  return _storageModule!;
}

export interface StorageItemConfig<T> {
  key: string;
  scope: StorageScope;
  defaultValue?: T;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
}

export interface StorageItem<T> {
  get: () => T;
  set: (value: T) => void;
  delete: () => void;
  subscribe: (callback: () => void) => () => void;
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

  const listeners = new Set<() => void>();

  let unsubscribe: (() => void) | null = null;

  const ensureSubscription = () => {
    if (!unsubscribe) {
      unsubscribe = getStorageModule().addOnChange(config.scope, (key) => {
        if (key === config.key) {
          listeners.forEach((listener) => listener());
        }
      });
    }
  };

  let lastRaw: string | undefined;
  let lastValue: T | undefined;

  const get = (): T => {
    const raw = getStorageModule().get(config.key, config.scope);

    if (raw === lastRaw && lastValue !== undefined) {
      return lastValue;
    }

    lastRaw = raw;

    if (raw === undefined) {
      lastValue = config.defaultValue as T;
    } else {
      lastValue = deserialize(raw);
    }

    return lastValue;
  };

  const set = (value: T): void => {
    const serialized = serialize(value);
    getStorageModule().set(config.key, serialized, config.scope);
  };

  const deleteItem = (): void => {
    getStorageModule().remove(config.key, config.scope);
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
  };
}

export function useStorage<T>(item: StorageItem<T>): [T, (value: T) => void] {
  const value = useSyncExternalStore(item.subscribe, item.get, item.get);
  return [value, item.set];
}
