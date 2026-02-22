import { useRef, useSyncExternalStore } from "react";

type HookStorageItem<T> = {
  get: () => T;
  set: (value: T | ((prev: T) => T)) => void;
  subscribe: (callback: () => void) => () => void;
};

export function useStorage<T>(
  item: HookStorageItem<T>,
): [T, (value: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(item.subscribe, item.get, item.get);
  return [value, item.set];
}

export function useStorageSelector<T, TSelected>(
  item: HookStorageItem<T>,
  selector: (value: T) => TSelected,
  isEqual: (prev: TSelected, next: TSelected) => boolean = Object.is,
): [TSelected, (value: T | ((prev: T) => T)) => void] {
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

export function useSetStorage<T>(item: HookStorageItem<T>) {
  return item.set;
}
