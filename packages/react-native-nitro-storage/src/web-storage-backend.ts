import { StorageScope } from "./Storage.types";

export type WebStorageChangeEvent = {
  key: string | null;
  newValue: string | null;
};

export type WebStorageScope = StorageScope.Disk | StorageScope.Secure;

export type WebStorageBackend = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  getAllKeys: () => string[];
  getMany?: (keys: string[]) => (string | null)[];
  setMany?: (
    entries: readonly (readonly [key: string, value: string])[],
  ) => void;
  removeMany?: (keys: string[]) => void;
  size?: () => number;
  subscribe?: (listener: (event: WebStorageChangeEvent) => void) => () => void;
  flush?: () => Promise<void>;
  name?: string;
};

export type WebDiskStorageBackend = WebStorageBackend;
export type WebSecureStorageBackend = WebStorageBackend;

type LocalStorageBackendOptions = {
  includeKey?: (key: string) => boolean;
  name?: string;
  resolveStorage?: () => Storage | undefined;
};

function getResolvedStorage(
  resolveStorage: (() => Storage | undefined) | undefined,
): Storage | undefined {
  if (resolveStorage) {
    return resolveStorage();
  }

  if (typeof globalThis.localStorage === "undefined") {
    return undefined;
  }

  return globalThis.localStorage;
}

export function createLocalStorageWebBackend(
  options: LocalStorageBackendOptions = {},
): WebStorageBackend {
  const includeKey = options.includeKey;
  const resolveStorage = options.resolveStorage;

  const listKeys = (): string[] => {
    const storage = getResolvedStorage(resolveStorage);
    if (!storage) {
      return [];
    }

    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) {
        continue;
      }
      if (includeKey && !includeKey(key)) {
        continue;
      }
      keys.push(key);
    }
    return keys;
  };

  return {
    name: options.name ?? "localStorage",
    getItem(key: string): string | null {
      return getResolvedStorage(resolveStorage)?.getItem(key) ?? null;
    },
    setItem(key: string, value: string): void {
      getResolvedStorage(resolveStorage)?.setItem(key, value);
    },
    removeItem(key: string): void {
      getResolvedStorage(resolveStorage)?.removeItem(key);
    },
    clear(): void {
      const storage = getResolvedStorage(resolveStorage);
      if (!storage) {
        return;
      }

      listKeys().forEach((key) => {
        storage.removeItem(key);
      });
    },
    getAllKeys(): string[] {
      return listKeys();
    },
    getMany(keys: string[]): (string | null)[] {
      const storage = getResolvedStorage(resolveStorage);
      if (!storage) {
        return keys.map(() => null);
      }
      return keys.map((key) => storage.getItem(key));
    },
    setMany(entries): void {
      const storage = getResolvedStorage(resolveStorage);
      if (!storage) {
        return;
      }
      entries.forEach(([key, value]) => {
        storage.setItem(key, value);
      });
    },
    removeMany(keys: string[]): void {
      const storage = getResolvedStorage(resolveStorage);
      if (!storage) {
        return;
      }
      keys.forEach((key) => {
        storage.removeItem(key);
      });
    },
    size(): number {
      return listKeys().length;
    },
  };
}
