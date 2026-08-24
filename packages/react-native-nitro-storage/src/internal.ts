import { StorageScope } from "./Storage.types";

export const MIGRATION_VERSION_KEY = "__nitro_storage_migration_version__";
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

export const ESCAPE_PREFIX = "__nitro_storage_escaped__:";

const RESERVED_RAW_TOKENS = new Set<string>([
  PRIM_NULL,
  PRIM_UNDEFINED,
  PRIM_TRUE,
  PRIM_FALSE,
  PRIM_INFINITY,
  PRIM_NEG_INFINITY,
  PRIM_NAN,
]);

export function escapeCollidingRawValue(value: string): string {
  if (
    RESERVED_RAW_TOKENS.has(value) ||
    value.startsWith(PRIMITIVE_FAST_PATH_PREFIX) ||
    value.startsWith(ESCAPE_PREFIX)
  ) {
    return `${ESCAPE_PREFIX}${value}`;
  }
  return value;
}

export function unescapeCollidingRawValue(value: string): string {
  return value.startsWith(ESCAPE_PREFIX)
    ? value.slice(ESCAPE_PREFIX.length)
    : value;
}

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
    case "string": {
      const stringValue = value as string;
      if (
        stringValue.startsWith(PRIMITIVE_FAST_PATH_PREFIX) ||
        stringValue.startsWith(ESCAPE_PREFIX)
      ) {
        return `${PRIM_STRING_PREFIX}${ESCAPE_PREFIX}${stringValue}`;
      }
      return PRIM_STRING_PREFIX + stringValue;
    }
    case "number":
      if (Number.isFinite(value)) {
        return PRIM_NUMBER_PREFIX + String(value);
      }
      if (Number.isNaN(value)) {
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
  if (value.startsWith(ESCAPE_PREFIX)) {
    return value.slice(ESCAPE_PREFIX.length) as T;
  }

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
      const unescapedPayload = payload.startsWith(ESCAPE_PREFIX)
        ? payload.slice(ESCAPE_PREFIX.length)
        : payload;
      return unescapedPayload as T;
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
