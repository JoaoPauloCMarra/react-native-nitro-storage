import { StorageScope } from "../Storage.types";
import {
  NATIVE_BATCH_MISSING_SENTINEL,
  assertBatchScope,
  assertValidScope,
  decodeNativeBatchValue,
  deserializeWithPrimitiveFastPath,
  isStoredEnvelope,
  prefixKey,
  isNamespaced,
  serializeWithPrimitiveFastPath,
  toVersionToken,
} from "../internal";

describe("internal helpers", () => {
  it("detects stored envelope shapes", () => {
    expect(isStoredEnvelope(null)).toBe(false);
    expect(isStoredEnvelope("nope")).toBe(false);
    expect(
      isStoredEnvelope({
        __nitroStorageEnvelope: true,
        expiresAt: 1234,
        payload: "value",
      }),
    ).toBe(true);
    expect(
      isStoredEnvelope({
        __nitroStorageEnvelope: true,
        expiresAt: "1234",
        payload: "value",
      }),
    ).toBe(false);
  });

  it("validates scopes", () => {
    expect(() => assertValidScope(StorageScope.Memory)).not.toThrow();
    expect(() => assertValidScope(StorageScope.Disk)).not.toThrow();
    expect(() => assertValidScope(StorageScope.Secure)).not.toThrow();
    expect(() => assertValidScope(999 as StorageScope)).toThrow(
      /Invalid storage scope/,
    );
  });

  it("validates batch item scopes and reports scope names", () => {
    expect(() =>
      assertBatchScope(
        [
          { key: "a", scope: StorageScope.Disk },
          { key: "b", scope: StorageScope.Disk },
        ],
        StorageScope.Disk,
      ),
    ).not.toThrow();

    expect(() =>
      assertBatchScope(
        [{ key: "bad-key", scope: 999 as StorageScope }],
        StorageScope.Disk,
      ),
    ).toThrow(/expected Disk, received 999/);
  });

  it("decodes native missing sentinel", () => {
    expect(
      decodeNativeBatchValue(NATIVE_BATCH_MISSING_SENTINEL),
    ).toBeUndefined();
    expect(decodeNativeBatchValue("raw")).toBe("raw");
  });

  it("serializes primitives via fast path and falls back to JSON", () => {
    expect(serializeWithPrimitiveFastPath("hello")).toBe(
      "__nitro_storage_primitive__:s:hello",
    );
    expect(serializeWithPrimitiveFastPath(42)).toBe(
      "__nitro_storage_primitive__:n:42",
    );
    expect(serializeWithPrimitiveFastPath(true)).toBe(
      "__nitro_storage_primitive__:b:1",
    );
    expect(serializeWithPrimitiveFastPath(false)).toBe(
      "__nitro_storage_primitive__:b:0",
    );
    expect(serializeWithPrimitiveFastPath(undefined)).toBe(
      "__nitro_storage_primitive__:u",
    );
    expect(serializeWithPrimitiveFastPath(null)).toBe(
      "__nitro_storage_primitive__:l",
    );
    expect(serializeWithPrimitiveFastPath(Number.POSITIVE_INFINITY)).toBe(
      "__nitro_storage_primitive__:n:Infinity",
    );
    expect(serializeWithPrimitiveFastPath({ nested: "ok" })).toBe(
      '{"nested":"ok"}',
    );
  });

  it("throws when default serialization cannot produce a string", () => {
    expect(() => serializeWithPrimitiveFastPath(() => undefined)).toThrow(
      /Unable to serialize value/,
    );
  });

  it("deserializes fast-path values and JSON fallback values", () => {
    expect(
      deserializeWithPrimitiveFastPath<string>(
        "__nitro_storage_primitive__:s:value",
      ),
    ).toBe("value");
    expect(
      deserializeWithPrimitiveFastPath<number>(
        "__nitro_storage_primitive__:n:123",
      ),
    ).toBe(123);
    expect(
      deserializeWithPrimitiveFastPath<boolean>(
        "__nitro_storage_primitive__:b:1",
      ),
    ).toBe(true);
    expect(
      deserializeWithPrimitiveFastPath<boolean>(
        "__nitro_storage_primitive__:b:0",
      ),
    ).toBe(false);
    expect(
      deserializeWithPrimitiveFastPath<undefined>(
        "__nitro_storage_primitive__:u",
      ),
    ).toBeUndefined();
    expect(
      deserializeWithPrimitiveFastPath<null>("__nitro_storage_primitive__:l"),
    ).toBeNull();

    expect(
      deserializeWithPrimitiveFastPath<string>(
        "__nitro_storage_primitive__:n:not-a-number",
      ),
    ).toBe("__nitro_storage_primitive__:n:not-a-number");
    expect(
      deserializeWithPrimitiveFastPath<{ ok: boolean }>('{"ok":true}'),
    ).toEqual({
      ok: true,
    });
    expect(deserializeWithPrimitiveFastPath<string>("legacy-raw-value")).toBe(
      "legacy-raw-value",
    );
  });

  it("prefixes key with namespace separator", () => {
    expect(prefixKey("auth", "token")).toBe("auth:token");
    expect(prefixKey("deep", "nested")).toBe("deep:nested");
  });

  it("returns key unchanged when namespace is undefined or empty", () => {
    expect(prefixKey(undefined, "key")).toBe("key");
    expect(prefixKey("", "key")).toBe("key");
  });

  it("detects namespaced keys", () => {
    expect(isNamespaced("auth:token", "auth")).toBe(true);
    expect(isNamespaced("auth:refresh", "auth")).toBe(true);
    expect(isNamespaced("other:token", "auth")).toBe(false);
    expect(isNamespaced("token", "auth")).toBe(false);
  });

  it("does not false-positive on partial namespace matches", () => {
    expect(isNamespaced("auth2:token", "auth")).toBe(false);
    expect(isNamespaced("authentication:token", "auth")).toBe(false);
  });
});

describe("special number serialization", () => {
  it("serializes NaN via fast path", () => {
    expect(serializeWithPrimitiveFastPath(NaN)).toBe(
      "__nitro_storage_primitive__:n:NaN",
    );
  });

  it("deserializes NaN correctly", () => {
    expect(
      deserializeWithPrimitiveFastPath("__nitro_storage_primitive__:n:NaN"),
    ).toBeNaN();
  });

  it("serializes -Infinity via fast path", () => {
    expect(serializeWithPrimitiveFastPath(-Infinity)).toBe(
      "__nitro_storage_primitive__:n:-Infinity",
    );
  });

  it("deserializes -Infinity correctly", () => {
    expect(
      deserializeWithPrimitiveFastPath(
        "__nitro_storage_primitive__:n:-Infinity",
      ),
    ).toBe(-Infinity);
  });

  it("round-trips NaN through serialize/deserialize", () => {
    const serialized = serializeWithPrimitiveFastPath(NaN);
    const deserialized = deserializeWithPrimitiveFastPath<number>(serialized);
    expect(deserialized).toBeNaN();
  });

  it("round-trips Infinity through serialize/deserialize", () => {
    const serialized = serializeWithPrimitiveFastPath(Infinity);
    const deserialized = deserializeWithPrimitiveFastPath<number>(serialized);
    expect(deserialized).toBe(Infinity);
  });

  it("round-trips -Infinity through serialize/deserialize", () => {
    const serialized = serializeWithPrimitiveFastPath(-Infinity);
    const deserialized = deserializeWithPrimitiveFastPath<number>(serialized);
    expect(deserialized).toBe(-Infinity);
  });
});

describe("toVersionToken", () => {
  it('returns "missing" token for undefined', () => {
    expect(toVersionToken(undefined)).toBe("__nitro_storage_version__:missing");
  });

  it("returns consistent hash for same string", () => {
    const a = toVersionToken("hello");
    const b = toVersionToken("hello");
    expect(a).toBe(b);
  });

  it("returns different hash for different strings", () => {
    expect(toVersionToken("hello")).not.toBe(toVersionToken("world"));
  });

  it("handles objects by JSON.stringify", () => {
    const token = toVersionToken({ a: 1 });
    expect(token).toContain("__nitro_storage_version__:");
  });

  it("returns consistent hash for same object", () => {
    expect(toVersionToken({ a: 1 })).toBe(toVersionToken({ a: 1 }));
  });

  it("returns different hash for different objects", () => {
    expect(toVersionToken({ a: 1 })).not.toBe(toVersionToken({ a: 2 }));
  });

  it("handles cyclic object without throwing (falls back to String())", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(() => toVersionToken(obj)).not.toThrow();
  });

  it("handles numbers", () => {
    expect(toVersionToken(42)).toContain("__nitro_storage_version__:");
  });

  it("handles booleans", () => {
    expect(toVersionToken(true)).not.toBe(toVersionToken(false));
  });

  it("handles null", () => {
    expect(toVersionToken(null)).toContain("__nitro_storage_version__:");
  });
});
