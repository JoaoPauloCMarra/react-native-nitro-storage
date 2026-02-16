import { StorageScope } from "./Storage.types";

export const MIGRATION_VERSION_KEY = "__nitro_storage_migration_version__";
export const NATIVE_BATCH_MISSING_SENTINEL =
  "__nitro_storage_batch_missing__::v1";
const PRIMITIVE_FAST_PATH_PREFIX = "__nitro_storage_primitive__:";
const NAMESPACE_SEPARATOR = ":";

export type StoredEnvelope = {
  __nitroStorageEnvelope: true;
  expiresAt: number;
  payload: string;
};

export function isStoredEnvelope(value: unknown): value is StoredEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<StoredEnvelope>;
  return (
    candidate.__nitroStorageEnvelope === true &&
    typeof candidate.expiresAt === "number" &&
    typeof candidate.payload === "string"
  );
}

export function assertValidScope(scope: StorageScope): void {
  if (
    scope !== StorageScope.Memory &&
    scope !== StorageScope.Disk &&
    scope !== StorageScope.Secure
  ) {
    throw new Error(`Invalid storage scope: ${String(scope)}`);
  }
}

export type ScopedBatchItem = {
  key: string;
  scope: StorageScope;
};

export function assertBatchScope(
  items: readonly ScopedBatchItem[],
  scope: StorageScope,
): void {
  const mismatchedItem = items.find((item) => item.scope !== scope);
  if (!mismatchedItem) {
    return;
  }

  const expectedScope = StorageScope[scope] ?? String(scope);
  const actualScope =
    StorageScope[mismatchedItem.scope] ?? String(mismatchedItem.scope);

  throw new Error(
    `Batch scope mismatch for "${mismatchedItem.key}": expected ${expectedScope}, received ${actualScope}.`,
  );
}

export function decodeNativeBatchValue(
  value: string | undefined,
): string | undefined {
  if (value === NATIVE_BATCH_MISSING_SENTINEL) {
    return undefined;
  }

  return value;
}

export function prefixKey(namespace: string | undefined, key: string): string {
  if (!namespace) return key;
  return `${namespace}${NAMESPACE_SEPARATOR}${key}`;
}

export function isNamespaced(key: string, namespace: string): boolean {
  return key.startsWith(`${namespace}${NAMESPACE_SEPARATOR}`);
}

export function serializeWithPrimitiveFastPath<T>(value: T): string {
  if (value === null) {
    return `${PRIMITIVE_FAST_PATH_PREFIX}l`;
  }

  switch (typeof value) {
    case "string":
      return `${PRIMITIVE_FAST_PATH_PREFIX}s:${value}`;
    case "number":
      if (Number.isFinite(value)) {
        return `${PRIMITIVE_FAST_PATH_PREFIX}n:${value}`;
      }
      break;
    case "boolean":
      return `${PRIMITIVE_FAST_PATH_PREFIX}b:${value ? "1" : "0"}`;
    case "undefined":
      return `${PRIMITIVE_FAST_PATH_PREFIX}u`;
    default:
      break;
  }

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error(
      "Unable to serialize value with default serializer. Provide a custom serialize function.",
    );
  }
  return serialized;
}

export function deserializeWithPrimitiveFastPath<T>(value: string): T {
  if (value.startsWith(PRIMITIVE_FAST_PATH_PREFIX)) {
    const encodedValue = value.slice(PRIMITIVE_FAST_PATH_PREFIX.length);
    if (encodedValue === "u") {
      return undefined as T;
    }
    if (encodedValue === "l") {
      return null as T;
    }

    const separatorIndex = encodedValue.indexOf(":");
    if (separatorIndex > 0) {
      const tag = encodedValue.slice(0, separatorIndex);
      const payload = encodedValue.slice(separatorIndex + 1);
      if (tag === "s") {
        return payload as T;
      }
      if (tag === "b") {
        return (payload === "1") as T;
      }
      if (tag === "n") {
        const parsed = Number(payload);
        if (Number.isFinite(parsed)) {
          return parsed as T;
        }
      }
    }
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}
