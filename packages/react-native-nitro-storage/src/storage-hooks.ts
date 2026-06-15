import { useMemo, useRef, useSyncExternalStore } from "react";

type HookStorageItem<T> = {
  get: () => T;
  set: StorageSetter<T>;
  subscribe: (callback: () => void) => () => void;
  merge?: (partial: Partial<T>) => void;
  reset?: () => void;
  delete?: () => void;
  setOrDelete?: (value: T | null | undefined) => void;
};

type ReadableStorageItem<T> = {
  get: () => T;
  subscribe: (callback: () => void) => () => void;
};

export type StorageSetter<T> = (value: T | ((prev: T) => T)) => void;

export type StorageActions<T> = {
  set: StorageSetter<T>;
  merge: (partial: Partial<T>) => void;
  reset: () => void;
  remove: () => void;
  setOrDelete: (value: T | null | undefined) => void;
};

export function useStorageActions<T>(
  item: HookStorageItem<T>,
): StorageActions<T> {
  return useMemo<StorageActions<T>>(
    () => ({
      set: item.set,
      merge: (partial) => item.merge?.(partial),
      reset: () => item.reset?.(),
      remove: () => item.delete?.(),
      setOrDelete: (value) => item.setOrDelete?.(value),
    }),
    [item],
  );
}

export function useStorage<T>(
  item: HookStorageItem<T>,
): [T, StorageSetter<T>, StorageActions<T>] {
  const value = useSyncExternalStore(item.subscribe, item.get, item.get);
  const actions = useStorageActions(item);
  return [value, item.set, actions];
}

export function useStorageValue<T>(item: ReadableStorageItem<T>): T {
  return useSyncExternalStore(item.subscribe, item.get, item.get);
}

export function useStorageSelector<T, TSelected>(
  item: HookStorageItem<T>,
  selector: (value: T) => TSelected,
  isEqual: (prev: TSelected, next: TSelected) => boolean = Object.is,
): [TSelected, StorageSetter<T>] {
  const selectedRef = useRef<
    { hasValue: false } | { hasValue: true; value: TSelected }
  >({
    hasValue: false,
  });

  const getSelectedSnapshot = () => {
    const nextSelected = selector(item.get());
    const current = selectedRef.current;
    if (current.hasValue && isEqual(current.value, nextSelected)) {
      return current.value;
    }

    selectedRef.current = { hasValue: true, value: nextSelected };
    return nextSelected;
  };

  const selectedValue = useSyncExternalStore(
    item.subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot,
  );
  return [selectedValue, item.set];
}

export function useSetStorage<T>(item: HookStorageItem<T>): StorageSetter<T> {
  return item.set;
}
