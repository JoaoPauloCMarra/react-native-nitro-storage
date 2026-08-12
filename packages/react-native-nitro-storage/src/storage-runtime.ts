export type StorageErrorCode =
  | "keychain_locked"
  | "authentication_required"
  | "key_invalidated"
  | "storage_corruption"
  | "biometric_unavailable"
  | "unsupported";

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
  "biometric_unavailable",
  "unsupported",
]);

export function getStorageErrorCode(
  err: unknown,
): StorageErrorCode | undefined {
  if (!(err instanceof Error)) {
    return undefined;
  }

  const taggedCode = err.message.match(STORAGE_ERROR_TAG_PATTERN)?.[1];

  if (
    taggedCode !== undefined &&
    STORAGE_ERROR_CODES.has(taggedCode as StorageErrorCode)
  ) {
    return taggedCode as StorageErrorCode;
  }

  return undefined;
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
