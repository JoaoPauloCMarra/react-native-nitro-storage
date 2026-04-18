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

export function getStorageErrorCode(
  err: unknown,
): StorageErrorCode | undefined {
  if (!(err instanceof Error)) {
    return undefined;
  }

  const message = err.message;
  const taggedCode = message.match(STORAGE_ERROR_TAG_PATTERN)?.[1];

  if (
    taggedCode === "keychain_locked" ||
    taggedCode === "authentication_required" ||
    taggedCode === "key_invalidated" ||
    taggedCode === "storage_corruption" ||
    taggedCode === "biometric_unavailable" ||
    taggedCode === "unsupported"
  ) {
    return taggedCode;
  }

  if (message.includes("errSecInteractionNotAllowed")) {
    return "keychain_locked";
  }

  if (
    message.includes("UserNotAuthenticatedException") ||
    message.includes("KeyStoreException") ||
    message.includes("android.security.keystore")
  ) {
    return "authentication_required";
  }

  if (
    message.includes("KeyPermanentlyInvalidatedException") ||
    message.includes("InvalidKeyException")
  ) {
    return "key_invalidated";
  }

  if (
    message.includes("AEADBadTagException") ||
    message.toLowerCase().includes("storage corruption") ||
    message.toLowerCase().includes("corrupted storage")
  ) {
    return "storage_corruption";
  }

  if (
    message.toLowerCase().includes("biometric storage unavailable") ||
    message.toLowerCase().includes("biometric storage is not available")
  ) {
    return "biometric_unavailable";
  }

  if (message.toLowerCase().includes("unsupported")) {
    return "unsupported";
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
