import {
  serializeWithPrimitiveFastPath,
  deserializeWithPrimitiveFastPath,
} from "./internal";
import type {
  StorageChangeOperation,
  StorageChangeSource,
  StorageKeyChangeEvent,
} from "./storage-events";
import {
  getStorageErrorCode,
  isLockedStorageErrorCode,
} from "./storage-runtime";
import { StorageScope } from "./Storage.types";
import type { AccessControl, BiometricLevel } from "./Storage.types";

export type Validator<T> = (value: unknown) => value is T;

export type ExpirationConfig = {
  ttlMs: number;
};

export type StorageVersion = string;

export type VersionedValue<T> = {
  value: T;
  version: StorageVersion;
};

export type StorageMetricsEvent = {
  operation: string;
  scope: StorageScope;
  durationMs: number;
  keysCount: number;
};

export type StorageMetricsObserver = (event: StorageMetricsEvent) => void;

export type StorageEventObserverOptions = {
  redactSecureValues?: boolean;
};

export type StorageExportOptions = {
  includeSecureValues?: boolean;
};

export type StorageMetricSummary = {
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
};

export type StorageSelectorListener<TSelected> = (
  value: TSelected,
  previousValue: TSelected,
) => void;

export type StorageSelectorSubscribeOptions<TSelected> = {
  isEqual?: (previousValue: TSelected, nextValue: TSelected) => boolean;
  fireImmediately?: boolean;
};

export type MigrationContext = {
  scope: StorageScope;
  getRaw: (key: string) => string | undefined;
  setRaw: (key: string, value: string) => void;
  removeRaw: (key: string) => void;
};

export type Migration = (context: MigrationContext) => void;

export type KeyListenerRegistry = Map<string, Set<() => void>>;

export type RawBatchPathItem = {
  _hasValidation?: boolean;
  _hasExpiration?: boolean;
  _hasRenameFrom?: boolean;
  _isBiometric?: boolean;
  _biometricLevel?: BiometricLevel;
  _secureAccessControl?: AccessControl;
};

export type RollbackRecord =
  | {
      kind: "memory";
      value: unknown;
      expiresAt?: number;
    }
  | {
      kind: "raw";
      value: string | undefined;
      accessControl?: AccessControl;
    }
  | {
      kind: "biometric";
      value: string | undefined;
      level: BiometricLevel;
    };

export type StorageCompositeError = Error & {
  readonly cause: unknown;
  readonly errors: readonly unknown[];
  readonly code: "storage_compensation_failed";
};

export type StorageCompensationError = StorageCompositeError;

export function createStorageCompositeError(
  operation: string,
  primary: unknown,
  contexts: readonly { label: string; error: unknown }[],
): StorageCompositeError {
  const primaryMessage =
    primary instanceof Error ? primary.message : String(primary);
  const contextMessage = contexts
    .map(({ label, error }) => {
      const message = error instanceof Error ? error.message : String(error);
      return `${label}: ${message}`;
    })
    .join("; ");
  const composite = new Error(
    `[nitro-error:storage_compensation_failed] NitroStorage: ${operation} failed; primary error: ${primaryMessage}${
      contextMessage.length > 0 ? `; ${contextMessage}` : ""
    }`,
  ) as StorageCompositeError;
  Object.defineProperties(composite, {
    cause: {
      configurable: true,
      enumerable: false,
      value: primary,
      writable: false,
    },
    errors: {
      configurable: true,
      enumerable: false,
      value: Object.freeze([primary, ...contexts.map(({ error }) => error)]),
      writable: false,
    },
    code: {
      configurable: false,
      enumerable: false,
      value: "storage_compensation_failed",
      writable: false,
    },
  });
  return composite;
}

export function normalizeStorageError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  const code = getStorageErrorCode(error);
  if (
    code !== "storage_compensation_failed" ||
    ("cause" in error && "errors" in error && "code" in error)
  ) {
    return error;
  }

  const operationMatch = error.message.match(
    /NitroStorage: ([^;]+?) failed(?:;|$)/,
  );
  const countMatch = error.message.match(/rollback_error_count=(\d+)/);
  const rollbackErrorCount = countMatch ? Number(countMatch[1]) : 0;
  const operation = operationMatch?.[1] ?? "native storage compensation";
  const contexts = Array.from({ length: rollbackErrorCount }, (_, index) => ({
    label: `native rollback ${index + 1}`,
    error: new Error("Native storage rollback failed"),
  }));
  return createStorageCompositeError(operation, error, contexts);
}

export function isUpdater<T>(
  valueOrFn: T | ((prev: T) => T),
): valueOrFn is (prev: T) => T {
  return typeof valueOrFn === "function";
}

export function typedKeys<K extends string, V>(record: Record<K, V>): K[] {
  return Object.keys(record) as K[];
}

export function assertEnumInteger(
  value: number,
  min: number,
  max: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`NitroStorage: Invalid ${label}`);
  }
  if (value !== Math.trunc(value)) {
    throw new Error(`NitroStorage: Invalid ${label}`);
  }
}

export function assertAccessControlLevel(level: number): void {
  assertEnumInteger(level, 0, 4, "access control level");
}

export function assertBiometricLevel(level: number): void {
  assertEnumInteger(level, 0, 2, "biometric level");
}

export type NonMemoryScope = StorageScope.Disk | StorageScope.Secure;

export type PendingDiskWrite = {
  key: string;
  value: string | undefined;
  generation: number;
};

export type PendingSecureWrite = {
  key: string;
  value: string | undefined;
  accessControl?: AccessControl;
  generation: number;
};

export const runMicrotask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (task: () => void) => {
        void Promise.resolve().then(task);
      };

export const now =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

export function notifyKeyListeners(
  registry: KeyListenerRegistry,
  key: string,
): void {
  const listeners = registry.get(key);
  if (listeners) {
    for (const listener of listeners) {
      listener();
    }
  }
}

export function notifyAllListeners(registry: KeyListenerRegistry): void {
  for (const listeners of registry.values()) {
    for (const listener of listeners) {
      listener();
    }
  }
}

export function createKeyChange(
  scope: StorageScope,
  key: string,
  oldValue: string | undefined,
  newValue: string | undefined,
  operation: StorageChangeOperation,
  source: StorageChangeSource,
): StorageKeyChangeEvent {
  return {
    type: "key",
    scope,
    key,
    oldValue,
    newValue,
    operation,
    source,
  };
}

export const SECURE_EVENT_REDACTED_VALUE = "[secure]";

export function redactSecureKeyChange(
  event: StorageKeyChangeEvent,
): StorageKeyChangeEvent {
  if (event.scope !== StorageScope.Secure) {
    return event;
  }

  return {
    ...event,
    oldValue:
      event.oldValue === undefined ? undefined : SECURE_EVENT_REDACTED_VALUE,
    newValue:
      event.newValue === undefined ? undefined : SECURE_EVENT_REDACTED_VALUE,
  };
}

export function canUseRawBatchPath(item: RawBatchPathItem): boolean {
  return (
    item._hasExpiration === false &&
    item._hasValidation === false &&
    item._hasRenameFrom !== true &&
    item._isBiometric !== true &&
    item._secureAccessControl === undefined
  );
}

export function canUseSecureRawBatchPath(item: RawBatchPathItem): boolean {
  return (
    item._hasExpiration === false &&
    item._hasValidation === false &&
    item._hasRenameFrom !== true &&
    item._isBiometric !== true
  );
}

export function defaultSerialize<T>(value: T): string {
  return serializeWithPrimitiveFastPath(value);
}

export function defaultDeserialize<T>(value: string): T {
  return deserializeWithPrimitiveFastPath(value);
}

export type SecureAuthStorageConfig<K extends string = string> = Record<
  K,
  {
    ttlMs?: number;
    biometric?: boolean;
    biometricLevel?: BiometricLevel;
    accessControl?: AccessControl;
    renameFrom?: string | readonly string[];
  }
>;

/**
 * @deprecated Use isStorageError(error, code) to distinguish temporary lock,
 * authentication, and invalidated-key recovery paths.
 */
export function isKeychainLockedError(err: unknown): boolean {
  return isLockedStorageErrorCode(getStorageErrorCode(err));
}
