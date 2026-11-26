export type StorageErrorCode =
  | "keychain_locked"
  | "authentication_required"
  | "key_invalidated"
  | "storage_corruption"
  | "storage_full"
  | "storage_compensation_failed"
  | "biometric_unavailable"
  | "unsupported"
  | "invalid_key";

export type StorageCapabilities = {
  platform: "native" | "web";
  backend: {
    disk: string;
    secure: string;
  };
  writeBuffering: {
    disk: boolean;
    secure: boolean;
  };
  errorClassification: boolean;
};

export type SecurityCapabilityStatus = "available" | "unavailable" | "unknown";

export type SecurityCapabilities = {
  platform: "native" | "web";
  secureStorage: {
    backend: string;
    encrypted: SecurityCapabilityStatus;
    accessControl: SecurityCapabilityStatus;
    keychainAccessGroup: SecurityCapabilityStatus;
    hardwareBacked: SecurityCapabilityStatus;
  };
  biometric: {
    storage: SecurityCapabilityStatus;
    prompt: SecurityCapabilityStatus;
    biometryOnly: SecurityCapabilityStatus;
    biometryOrPasscode: SecurityCapabilityStatus;
  };
  metadata: {
    perKey: boolean;
    listsWithoutValues: boolean;
    persistsTimestamps: boolean;
  };
};

export type SecureStorageMetadata = {
  key: string;
  exists: boolean;
  kind: "secure" | "biometric" | "missing";
  backend: string;
  encrypted: SecurityCapabilityStatus;
  hardwareBacked: SecurityCapabilityStatus;
  biometricProtected: boolean;
  valueExposed: false;
};

const STORAGE_ERROR_TAG_PATTERN = /\[nitro-error:([a-z_]+)\]/;

const STORAGE_ERROR_CODES = new Set<StorageErrorCode>([
  "keychain_locked",
  "authentication_required",
  "key_invalidated",
  "storage_corruption",
  "storage_full",
  "storage_compensation_failed",
  "biometric_unavailable",
  "unsupported",
  "invalid_key",
]);

const MAX_ERROR_CAUSE_DEPTH = 5;

function getTaggedStorageErrorCode(err: Error): StorageErrorCode | undefined {
  const taggedCode = err.message.match(STORAGE_ERROR_TAG_PATTERN)?.[1];
  return taggedCode !== undefined &&
    STORAGE_ERROR_CODES.has(taggedCode as StorageErrorCode)
    ? (taggedCode as StorageErrorCode)
    : undefined;
}

export function getStorageErrorCode(
  err: unknown,
): StorageErrorCode | undefined {
  const seen = new Set<Error>();
  let current = err;
  while (
    current instanceof Error &&
    !seen.has(current) &&
    seen.size <= MAX_ERROR_CAUSE_DEPTH
  ) {
    const code = getTaggedStorageErrorCode(current);
    if (code !== undefined) {
      return code;
    }
    seen.add(current);
    current = (current as Error & { cause?: unknown }).cause;
  }
  return undefined;
}

export function isStorageError(err: unknown, code: StorageErrorCode): boolean {
  return getStorageErrorCode(err) === code;
}

export function isLockedStorageErrorCode(
  code: StorageErrorCode | undefined,
): boolean {
  return (
    code === "keychain_locked" ||
    code === "authentication_required" ||
    code === "key_invalidated"
  );
}
