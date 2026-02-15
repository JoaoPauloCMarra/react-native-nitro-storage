import { StorageScope } from "../Storage.types";
import {
  NATIVE_BATCH_MISSING_SENTINEL,
  assertBatchScope,
  assertValidScope,
  decodeNativeBatchValue,
  deserializeWithPrimitiveFastPath,
  isStoredEnvelope,
  serializeWithPrimitiveFastPath,
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
      })
    ).toBe(true);
    expect(
      isStoredEnvelope({
        __nitroStorageEnvelope: true,
        expiresAt: "1234",
        payload: "value",
      })
    ).toBe(false);
  });

  it("validates scopes", () => {
    expect(() => assertValidScope(StorageScope.Memory)).not.toThrow();
    expect(() => assertValidScope(StorageScope.Disk)).not.toThrow();
    expect(() => assertValidScope(StorageScope.Secure)).not.toThrow();
    expect(() => assertValidScope(999 as StorageScope)).toThrow(/Invalid storage scope/);
  });

  it("validates batch item scopes and reports scope names", () => {
    expect(() =>
      assertBatchScope(
        [
          { key: "a", scope: StorageScope.Disk },
          { key: "b", scope: StorageScope.Disk },
        ],
        StorageScope.Disk
      )
    ).not.toThrow();

    expect(() =>
      assertBatchScope(
        [{ key: "bad-key", scope: 999 as StorageScope }],
        StorageScope.Disk
      )
    ).toThrow(/expected Disk, received 999/);
  });

  it("decodes native missing sentinel", () => {
    expect(decodeNativeBatchValue(NATIVE_BATCH_MISSING_SENTINEL)).toBeUndefined();
    expect(decodeNativeBatchValue("raw")).toBe("raw");
  });

  it("serializes primitives via fast path and falls back to JSON", () => {
    expect(serializeWithPrimitiveFastPath("hello")).toBe("__nitro_storage_primitive__:s:hello");
    expect(serializeWithPrimitiveFastPath(42)).toBe("__nitro_storage_primitive__:n:42");
    expect(serializeWithPrimitiveFastPath(true)).toBe("__nitro_storage_primitive__:b:1");
    expect(serializeWithPrimitiveFastPath(false)).toBe("__nitro_storage_primitive__:b:0");
    expect(serializeWithPrimitiveFastPath(undefined)).toBe("__nitro_storage_primitive__:u");
    expect(serializeWithPrimitiveFastPath(null)).toBe("__nitro_storage_primitive__:l");
    expect(serializeWithPrimitiveFastPath(Number.POSITIVE_INFINITY)).toBe("null");
    expect(serializeWithPrimitiveFastPath({ nested: "ok" })).toBe('{"nested":"ok"}');
  });

  it("throws when default serialization cannot produce a string", () => {
    expect(() => serializeWithPrimitiveFastPath(() => undefined)).toThrow(
      /Unable to serialize value/
    );
  });

  it("deserializes fast-path values and JSON fallback values", () => {
    expect(deserializeWithPrimitiveFastPath<string>("__nitro_storage_primitive__:s:value")).toBe(
      "value"
    );
    expect(deserializeWithPrimitiveFastPath<number>("__nitro_storage_primitive__:n:123")).toBe(
      123
    );
    expect(deserializeWithPrimitiveFastPath<boolean>("__nitro_storage_primitive__:b:1")).toBe(
      true
    );
    expect(deserializeWithPrimitiveFastPath<boolean>("__nitro_storage_primitive__:b:0")).toBe(
      false
    );
    expect(
      deserializeWithPrimitiveFastPath<undefined>("__nitro_storage_primitive__:u")
    ).toBeUndefined();
    expect(deserializeWithPrimitiveFastPath<null>("__nitro_storage_primitive__:l")).toBeNull();

    expect(
      deserializeWithPrimitiveFastPath<string>("__nitro_storage_primitive__:n:not-a-number")
    ).toBe("__nitro_storage_primitive__:n:not-a-number");
    expect(deserializeWithPrimitiveFastPath<{ ok: boolean }>('{"ok":true}')).toEqual({
      ok: true,
    });
    expect(deserializeWithPrimitiveFastPath<string>("legacy-raw-value")).toBe("legacy-raw-value");
  });
});
