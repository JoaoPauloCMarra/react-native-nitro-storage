import { useSyncExternalStore } from "react";

export enum StorageScope {
  Memory = 0,
  Disk = 1,
  Secure = 2,
}

export interface Storage {
  name: string;
  equals: (other: any) => boolean;
  dispose: () => void;
  set(key: string, value: string, scope: number): void;
  get(key: string, scope: number): string | undefined;
  remove(key: string, scope: number): void;
  clear(scope: number): void;
  setBatch(keys: string[], values: string[], scope: number): void;
  getBatch(keys: string[], scope: number): (string | undefined)[];
  removeBatch(keys: string[], scope: number): void;
  addOnChange(
    scope: number,
    callback: (key: string, value: string | undefined) => void
  ): () => void;
}

const diskListeners = new Map<string, Set<() => void>>();
const secureListeners = new Map<string, Set<() => void>>();

function notifyDiskListeners(key: string) {
  diskListeners.get(key)?.forEach((cb) => cb());
}

function notifySecureListeners(key: string) {
  secureListeners.get(key)?.forEach((cb) => cb());
}

const WebStorage: Storage = {
  name: "Storage",
  equals: (other) => other === WebStorage,
  dispose: () => {},
  set: (key: string, value: string, scope: number) => {
    if (scope === StorageScope.Disk) {
      localStorage?.setItem(key, value);
      notifyDiskListeners(key);
    } else if (scope === StorageScope.Secure) {
      sessionStorage?.setItem(key, value);
      notifySecureListeners(key);
    }
  },

  get: (key: string, scope: number) => {
    if (scope === StorageScope.Disk) {
      return localStorage?.getItem(key) ?? undefined;
    } else if (scope === StorageScope.Secure) {
      return sessionStorage?.getItem(key) ?? undefined;
    }
    return undefined;
  },
  remove: (key: string, scope: number) => {
    if (scope === StorageScope.Disk) {
      localStorage?.removeItem(key);
      notifyDiskListeners(key);
    } else if (scope === StorageScope.Secure) {
      sessionStorage?.removeItem(key);
      notifySecureListeners(key);
    }
  },

  clear: (scope: number) => {
    if (scope === StorageScope.Disk) {
      localStorage?.clear();
      diskListeners.forEach((listeners) => {
        listeners.forEach((cb) => cb());
      });
    } else if (scope === StorageScope.Secure) {
      sessionStorage?.clear();
      secureListeners.forEach((listeners) => {
        listeners.forEach((cb) => cb());
      });
    }
  },
  setBatch: (keys: string[], values: string[], scope: number) => {
    keys.forEach((key, i) => WebStorage.set(key, values[i], scope));
  },
  getBatch: (keys: string[], scope: number) => {
    return keys.map((key) => WebStorage.get(key, scope));
  },
  removeBatch: (keys: string[], scope: number) => {
    keys.forEach((key) => WebStorage.remove(key, scope));
  },
  addOnChange: (
    _scope: number,
    _callback: (key: string, value: string | undefined) => void
  ) => {
    return () => {};
  },
};

const memoryStore = new Map<string, any>();
const memoryListeners = new Set<(key: string, value: any) => void>();

function notifyMemoryListeners(key: string, value: any) {
  memoryListeners.forEach((listener) => listener(key, value));
}

export const storage = {
  clear: (scope: StorageScope) => {
    if (scope === StorageScope.Memory) {
      memoryStore.clear();
      notifyMemoryListeners("", undefined);
    } else {
      WebStorage.clear(scope);
    }
  },
  clearAll: () => {
    storage.clear(StorageScope.Memory);
    storage.clear(StorageScope.Disk);
    storage.clear(StorageScope.Secure);
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
  serialize: (value: T) => string;
  deserialize: (value: string) => T;
  _triggerListeners: () => void;
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
  const isMemory = config.scope === StorageScope.Memory;

  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  let lastRaw: string | undefined;
  let lastValue: T | undefined;

  const ensureSubscription = () => {
    if (!unsubscribe) {
      if (isMemory) {
        const listener = (key: string) => {
          if (key === "" || key === config.key) {
            lastRaw = undefined;
            lastValue = undefined;
            listeners.forEach((l) => l());
          }
        };
        memoryListeners.add(listener);
        unsubscribe = () => memoryListeners.delete(listener);
      } else if (config.scope === StorageScope.Disk) {
        const listener = () => {
          lastRaw = undefined;
          lastValue = undefined;
          listeners.forEach((l) => l());
        };
        if (!diskListeners.has(config.key)) {
          diskListeners.set(config.key, new Set());
        }
        diskListeners.get(config.key)!.add(listener);
        unsubscribe = () => diskListeners.get(config.key)?.delete(listener);
      } else if (config.scope === StorageScope.Secure) {
        const listener = () => {
          lastRaw = undefined;
          lastValue = undefined;
          listeners.forEach((l) => l());
        };
        if (!secureListeners.has(config.key)) {
          secureListeners.set(config.key, new Set());
        }
        secureListeners.get(config.key)!.add(listener);
        unsubscribe = () => secureListeners.get(config.key)?.delete(listener);
      }
    }
  };

  const get = (): T => {
    let raw: string | undefined;
    if (isMemory) {
      raw = memoryStore.get(config.key);
    } else {
      raw = WebStorage.get(config.key, config.scope);
    }

    if (raw === lastRaw && lastValue !== undefined) {
      return lastValue;
    }

    lastRaw = raw;

    if (raw === undefined) {
      lastValue = config.defaultValue as T;
    } else {
      lastValue = isMemory ? (raw as T) : deserialize(raw);
    }

    return lastValue;
  };

  const set = (valueOrFn: T | ((prev: T) => T)): void => {
    const currentValue = get();
    const newValue =
      typeof valueOrFn === "function"
        ? (valueOrFn as (prev: T) => T)(currentValue)
        : valueOrFn;

    lastRaw = undefined;

    if (isMemory) {
      memoryStore.set(config.key, newValue);
      notifyMemoryListeners(config.key, newValue);
    } else {
      WebStorage.set(config.key, serialize(newValue), config.scope);
    }
  };

  const deleteItem = (): void => {
    lastRaw = undefined;

    if (isMemory) {
      memoryStore.delete(config.key);
      notifyMemoryListeners(config.key, undefined);
    } else {
      WebStorage.remove(config.key, config.scope);
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
    serialize,
    deserialize,
    _triggerListeners: () => {
      lastRaw = undefined;
      lastValue = undefined;
      listeners.forEach((l) => l());
    },
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

export function getBatch(
  items: StorageItem<any>[],
  scope: StorageScope
): any[] {
  if (scope === StorageScope.Memory) {
    return items.map((item) => item.get());
  }

  const keys = items.map((item) => item.key);
  const rawValues = WebStorage.getBatch(keys, scope);

  return items.map((item, idx) => {
    const raw = rawValues[idx];
    if (raw === undefined) {
      return item.get();
    }
    return item.deserialize(raw);
  });
}

export function setBatch(
  items: { item: StorageItem<any>; value: any }[],
  scope: StorageScope
): void {
  if (scope === StorageScope.Memory) {
    items.forEach(({ item, value }) => item.set(value));
    return;
  }

  const keys = items.map((i) => i.item.key);
  const values = items.map((i) => i.item.serialize(i.value));
  WebStorage.setBatch(keys, values, scope);

  items.forEach(({ item }) => {
    item._triggerListeners();
  });
}

export function removeBatch(
  items: StorageItem<any>[],
  scope: StorageScope
): void {
  if (scope === StorageScope.Memory) {
    items.forEach((item) => item.delete());
    return;
  }

  const keys = items.map((item) => item.key);
  WebStorage.removeBatch(keys, scope);
  items.forEach((item) => item.delete());
}
