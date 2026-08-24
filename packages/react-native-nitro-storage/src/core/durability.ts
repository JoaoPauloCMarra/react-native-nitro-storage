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
  readPendingSecureAccessControl(key: string): AccessControl | undefined;
  clearPendingDiskWrite(key: string): void;
  clearPendingSecureWrite(key: string): void;
  clearPendingDiskWriteIf(write: PendingDiskWrite): void;
  clearPendingSecureWriteIf(write: PendingSecureWrite): void;
  clearAllPendingDiskWrites(): void;
  clearAllPendingSecureWrites(): void;
  scheduleDiskWrite(key: string, value: string | undefined): PendingDiskWrite;
  scheduleSecureWrite(
    key: string,
    value: string | undefined,
    accessControl?: AccessControl,
  ): PendingSecureWrite;
  flushDiskWrites(): void;
  flushSecureWrites(): void;
  runSecurePromotion<T>(key: string, promotion: () => T): T;
};

export function createDurabilityCoordinator(options: {
  backend: DurabilityBackend;
  resolveSecureDefaultAccessControl(): AccessControl;
}): DurabilityCoordinator {
  type PendingWrite = PendingDiskWrite | PendingSecureWrite;

  const pendingDiskWrites = new Map<string, PendingDiskWrite>();
  let nextGeneration = 0;
  let diskFlushScheduled = false;
  let diskWritesAsync = false;
  const pendingSecureWrites = new Map<string, PendingSecureWrite>();
  let secureFlushScheduled = false;
  const securePromotionsInProgress = new Set<string>();

  function clearPendingWrites<T extends PendingWrite>(
    pendingWrites: Map<string, T>,
    writes: readonly T[],
  ): void {
    writes.forEach((write) => {
      if (pendingWrites.get(write.key) === write) {
        pendingWrites.delete(write.key);
      }
    });
  }

  function restorePendingWrites<T extends PendingWrite>(
    pendingWrites: Map<string, T>,
    writes: readonly T[],
  ): void {
    writes.forEach((write) => {
      if (!pendingWrites.has(write.key)) {
        pendingWrites.set(write.key, write);
      }
    });
  }

  function flushDiskWrites(): void {
    diskFlushScheduled = false;

    if (pendingDiskWrites.size === 0) {
      return;
    }

    const writes = Array.from(pendingDiskWrites.values());

    const setWrites = writes.filter((write) => write.value !== undefined);
    const removeWrites = writes.filter((write) => write.value === undefined);

    if (setWrites.length > 0) {
      try {
        options.backend.setBatch(
          setWrites.map(({ key }) => key),
          setWrites.map(({ value }) => value as string),
          StorageScope.Disk,
        );
      } catch (error) {
        restorePendingWrites(pendingDiskWrites, setWrites);
        throw error;
      }
      clearPendingWrites(pendingDiskWrites, setWrites);
    }

    if (removeWrites.length > 0) {
      try {
        options.backend.removeBatch(
          removeWrites.map(({ key }) => key),
          StorageScope.Disk,
        );
      } catch (error) {
        restorePendingWrites(pendingDiskWrites, removeWrites);
        throw error;
      }
      clearPendingWrites(pendingDiskWrites, removeWrites);
    }
  }

  function flushSecureWrites(): void {
    secureFlushScheduled = false;

    if (pendingSecureWrites.size === 0) {
      return;
    }

    const writes = Array.from(pendingSecureWrites.values());

    const groupedSetWrites = new Map<
      AccessControl,
      { writes: PendingSecureWrite[] }
    >();
    const removeWrites: PendingSecureWrite[] = [];

    writes.forEach((write) => {
      const { value, accessControl } = write;
      if (value === undefined) {
        removeWrites.push(write);
      } else {
        const resolvedAccessControl =
          accessControl ?? options.resolveSecureDefaultAccessControl();
        const existingGroup = groupedSetWrites.get(resolvedAccessControl);
        const group = existingGroup ?? { writes: [] };
        group.writes.push(write);
        if (!existingGroup) {
          groupedSetWrites.set(resolvedAccessControl, group);
        }
      }
    });

    for (const [accessControl, group] of groupedSetWrites) {
      try {
        options.backend.setSecureAccessControl(accessControl);
        options.backend.setBatch(
          group.writes.map(({ key }) => key),
          group.writes.map(({ value }) => value as string),
          StorageScope.Secure,
        );
      } catch (error) {
        restorePendingWrites(pendingSecureWrites, group.writes);
        throw error;
      }
      clearPendingWrites(pendingSecureWrites, group.writes);
    }

    if (removeWrites.length > 0) {
      try {
        options.backend.removeBatch(
          removeWrites.map(({ key }) => key),
          StorageScope.Secure,
        );
      } catch (error) {
        restorePendingWrites(pendingSecureWrites, removeWrites);
        throw error;
      }
      clearPendingWrites(pendingSecureWrites, removeWrites);
    }
  }

  function scheduleDiskWrite(
    key: string,
    value: string | undefined,
  ): PendingDiskWrite {
    const pendingWrite: PendingDiskWrite = {
      key,
      value,
      generation: ++nextGeneration,
    };
    pendingDiskWrites.set(key, pendingWrite);
    if (diskFlushScheduled) {
      return pendingWrite;
    }
    diskFlushScheduled = true;
    runMicrotask(flushDiskWrites);
    return pendingWrite;
  }

  function scheduleSecureWrite(
    key: string,
    value: string | undefined,
    accessControl?: AccessControl,
  ): PendingSecureWrite {
    const pendingWrite: PendingSecureWrite = {
      key,
      value,
      generation: ++nextGeneration,
    };
    if (accessControl !== undefined) {
      pendingWrite.accessControl = accessControl;
    }
    pendingSecureWrites.set(key, pendingWrite);
    if (secureFlushScheduled) {
      return pendingWrite;
    }
    secureFlushScheduled = true;
    runMicrotask(flushSecureWrites);
    return pendingWrite;
  }

  function runSecurePromotion<T>(key: string, promotion: () => T): T {
    if (securePromotionsInProgress.has(key)) {
      throw new Error("NitroStorage: Reentrant secure promotion");
    }

    securePromotionsInProgress.add(key);
    try {
      if (pendingSecureWrites.has(key)) {
        flushSecureWrites();
      }
      return promotion();
    } finally {
      securePromotionsInProgress.delete(key);
    }
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
    readPendingSecureAccessControl: (key) =>
      pendingSecureWrites.get(key)?.accessControl,
    clearPendingDiskWrite: (key) => {
      pendingDiskWrites.delete(key);
    },
    clearPendingSecureWrite: (key) => {
      pendingSecureWrites.delete(key);
    },
    clearPendingDiskWriteIf: (write) => {
      if (pendingDiskWrites.get(write.key) === write) {
        pendingDiskWrites.delete(write.key);
      }
    },
    clearPendingSecureWriteIf: (write) => {
      if (pendingSecureWrites.get(write.key) === write) {
        pendingSecureWrites.delete(write.key);
      }
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
    runSecurePromotion,
  };
}
