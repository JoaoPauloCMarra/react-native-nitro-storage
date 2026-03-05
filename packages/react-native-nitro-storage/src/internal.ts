import { StorageScope } from "./Storage.types";

export const MIGRATION_VERSION_KEY = "__nitro_storage_migration_version__";
export const NATIVE_BATCH_MISSING_SENTINEL =
  "__nitro_storage_batch_missing__::v1";
const PRIMITIVE_FAST_PATH_PREFIX = "__nitro_storage_primitive__:";
const PRIM_NULL = "__nitro_storage_primitive__:l";
const PRIM_UNDEFINED = "__nitro_storage_primitive__:u";
const PRIM_TRUE = "__nitro_storage_primitive__:b:1";
const PRIM_FALSE = "__nitro_storage_primitive__:b:0";
const PRIM_STRING_PREFIX = "__nitro_storage_primitive__:s:";
const PRIM_NUMBER_PREFIX = "__nitro_storage_primitive__:n:";
const PRIM_INFINITY = "__nitro_storage_primitive__:n:Infinity";
const PRIM_NEG_INFINITY = "__nitro_storage_primitive__:n:-Infinity";
const PRIM_NAN = "__nitro_storage_primitive__:n:NaN";
const NAMESPACE_SEPARATOR = ":";
const VERSION_TOKEN_PREFIX = "__nitro_storage_version__:";

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
    return PRIM_NULL;
  }

  switch (typeof value) {
    case "string":
      return PRIM_STRING_PREFIX + (value as string);
    case "number":
      if (Number.isFinite(value)) {
        return PRIM_NUMBER_PREFIX + String(value);
      }
      if (Number.isNaN(value as number)) {
        return PRIM_NAN;
      }
      if (value === Infinity) {
        return PRIM_INFINITY;
      }
      if (value === -Infinity) {
        return PRIM_NEG_INFINITY;
      }
      break;
    case "boolean":
      return value ? PRIM_TRUE : PRIM_FALSE;
    case "undefined":
      return PRIM_UNDEFINED;
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

// charCode constants for fast tag dispatch
const CHAR_U = 117; // 'u'
const CHAR_L = 108; // 'l'
const CHAR_S = 115; // 's'
const CHAR_B = 98; // 'b'
const CHAR_N = 110; // 'n'

export function deserializeWithPrimitiveFastPath<T>(value: string): T {
  if (value.startsWith(PRIMITIVE_FAST_PATH_PREFIX)) {
    const prefixLen = PRIMITIVE_FAST_PATH_PREFIX.length;
    const tagChar = value.charCodeAt(prefixLen);

    if (tagChar === CHAR_U) {
      return undefined as T;
    }
    if (tagChar === CHAR_L) {
      return null as T;
    }

    // Tagged values have format: prefix + tag + ':' + payload
    const payload = value.slice(prefixLen + 2);

    if (tagChar === CHAR_S) {
      return payload as T;
    }
    if (tagChar === CHAR_B) {
      return (payload === "1") as T;
    }
    if (tagChar === CHAR_N) {
      if (payload === "NaN") return NaN as T;
      if (payload === "Infinity") return Infinity as T;
      if (payload === "-Infinity") return -Infinity as T;
      const parsed = Number(payload);
      if (Number.isFinite(parsed)) {
        return parsed as T;
      }
    }
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function toVersionToken(raw: unknown): string {
  if (raw === undefined) {
    return `${VERSION_TOKEN_PREFIX}missing`;
  }

  if (typeof raw === "string") {
    return `${VERSION_TOKEN_PREFIX}${raw.length}:${fnv1aHash(raw)}`;
  }

  let normalized: string;
  try {
    normalized = JSON.stringify(raw) ?? String(raw);
  } catch {
    normalized = String(raw);
  }
  return `${VERSION_TOKEN_PREFIX}${normalized.length}:${fnv1aHash(normalized)}`;
}
