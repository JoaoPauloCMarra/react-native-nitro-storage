import { runMicrotask } from "../shared";
import { StorageScope, type AccessControl } from "../Storage.types";
import type { PendingDiskWrite, PendingSecureWrite } from "../shared";

export type DurabilityBackend = {
  setBatch(keys: string[], values: string[], scope: number): void;
  removeBatch(keys: string[], scope: number): void;
  setSecureAccessControl(level: AccessControl): void;
};

export type DurabilityCoordinator = {
  setDiskWritesAsync(enabled: boolean): void;
  isDiskWritesAsync(): boolean;
  hasPendingDiskWrite(key: string): boolean;
  hasPendingSecureWrite(key: string): boolean;
  readPendingDiskWrite(key: string): string | undefined;
  readPendingSecureWrite(key: string): string | undefined;
  clearPendingDiskWrite(key: string): void;
  clearPendingSecureWrite(key: string): void;
  clearAllPendingDiskWrites(): void;
  clearAllPendingSecureWrites(): void;
  scheduleDiskWrite(key: string, value: string | undefined): void;
  scheduleSecureWrite(
    key: string,
    value: string | undefined,
    accessControl?: AccessControl,
  ): void;
  flushDiskWrites(): void;
  flushSecureWrites(): void;
};

export function createDurabilityCoordinator(options: {
  backend: DurabilityBackend;
  resolveSecureDefaultAccessControl(): AccessControl;
}): DurabilityCoordinator {
  const pendingDiskWrites = new Map<string, PendingDiskWrite>();
  let diskFlushScheduled = false;
  let diskWritesAsync = false;
  const pendingSecureWrites = new Map<string, PendingSecureWrite>();
  let secureFlushScheduled = false;

  function flushDiskWrites(): void {
    diskFlushScheduled = false;

    if (pendingDiskWrites.size === 0) {
      return;
    }

    const writes = Array.from(pendingDiskWrites.values());
    pendingDiskWrites.clear();

    const keysToSet: string[] = [];
    const valuesToSet: string[] = [];
    const keysToRemove: string[] = [];

    writes.forEach(({ key, value }) => {
      if (value === undefined) {
        keysToRemove.push(key);
        return;
      }

      keysToSet.push(key);
      valuesToSet.push(value);
    });

    if (keysToSet.length > 0) {
      options.backend.setBatch(keysToSet, valuesToSet, StorageScope.Disk);
    }
    if (keysToRemove.length > 0) {
      options.backend.removeBatch(keysToRemove, StorageScope.Disk);
    }
  }

  function flushSecureWrites(): void {
    secureFlushScheduled = false;

    if (pendingSecureWrites.size === 0) {
      return;
    }

    const writes = Array.from(pendingSecureWrites.values());
    pendingSecureWrites.clear();

    const groupedSetWrites = new Map<
      AccessControl,
      { keys: string[]; values: string[] }
    >();
    const keysToRemove: string[] = [];

    writes.forEach(({ key, value, accessControl }) => {
      if (value === undefined) {
        keysToRemove.push(key);
      } else {
        const resolvedAccessControl =
          accessControl ?? options.resolveSecureDefaultAccessControl();
        const existingGroup = groupedSetWrites.get(resolvedAccessControl);
        const group = existingGroup ?? { keys: [], values: [] };
        group.keys.push(key);
        group.values.push(value);
        if (!existingGroup) {
          groupedSetWrites.set(resolvedAccessControl, group);
        }
      }
    });

    groupedSetWrites.forEach((group, accessControl) => {
      options.backend.setSecureAccessControl(accessControl);
      options.backend.setBatch(group.keys, group.values, StorageScope.Secure);
    });
    if (keysToRemove.length > 0) {
      options.backend.removeBatch(keysToRemove, StorageScope.Secure);
    }
  }

  function scheduleDiskWrite(key: string, value: string | undefined): void {
    pendingDiskWrites.set(key, { key, value });
    if (diskFlushScheduled) {
      return;
    }
    diskFlushScheduled = true;
    runMicrotask(flushDiskWrites);
  }

  function scheduleSecureWrite(
    key: string,
    value: string | undefined,
    accessControl?: AccessControl,
  ): void {
    const pendingWrite: PendingSecureWrite = { key, value };
    if (accessControl !== undefined) {
      pendingWrite.accessControl = accessControl;
    }
    pendingSecureWrites.set(key, pendingWrite);
    if (secureFlushScheduled) {
      return;
    }
    secureFlushScheduled = true;
    runMicrotask(flushSecureWrites);
  }

  return {
    setDiskWritesAsync(enabled) {
      diskWritesAsync = enabled;
      if (!enabled) {
        flushDiskWrites();
      }
    },
    isDiskWritesAsync: () => diskWritesAsync,
    hasPendingDiskWrite: (key) => pendingDiskWrites.has(key),
    hasPendingSecureWrite: (key) => pendingSecureWrites.has(key),
    readPendingDiskWrite: (key) => pendingDiskWrites.get(key)?.value,
    readPendingSecureWrite: (key) => pendingSecureWrites.get(key)?.value,
    clearPendingDiskWrite: (key) => {
      pendingDiskWrites.delete(key);
    },
    clearPendingSecureWrite: (key) => {
      pendingSecureWrites.delete(key);
    },
    clearAllPendingDiskWrites: () => {
      pendingDiskWrites.clear();
    },
    clearAllPendingSecureWrites: () => {
      pendingSecureWrites.clear();
    },
    scheduleDiskWrite,
    scheduleSecureWrite,
    flushDiskWrites,
    flushSecureWrites,
  };
}
