import type { StorageItem } from "./index";

export type MMKVLike = {
  getString: (key: string) => string | undefined;
  getNumber: (key: string) => number | undefined;
  getBoolean: (key: string) => boolean | undefined;
  contains: (key: string) => boolean;
  delete: (key: string) => void;
  getAllKeys: () => string[];
};

export function migrateFromMMKV<T>(
  mmkv: MMKVLike,
  item: StorageItem<T>,
  deleteFromMMKV = false,
): boolean {
  const key = item.key;
  if (!mmkv.contains(key)) {
    return false;
  }

  const value = mmkv.getString(key);

  if (value !== undefined) {
    try {
      const parsed = JSON.parse(value);
      item.set(parsed);
    } catch {
      item.set(value as T);
    }

    if (deleteFromMMKV) {
      mmkv.delete(key);
    }
    return true;
  }

  const num = mmkv.getNumber(key);
  if (num !== undefined) {
    item.set(num as T);
    if (deleteFromMMKV) mmkv.delete(key);
    return true;
  }

  const bool = mmkv.getBoolean(key);
  if (bool !== undefined) {
    item.set(bool as T);
    if (deleteFromMMKV) mmkv.delete(key);
    return true;
  }

  return false;
}
