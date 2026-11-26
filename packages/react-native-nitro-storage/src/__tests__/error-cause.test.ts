import { getStorageErrorCode, isStorageError } from "../storage-runtime";

const full = new Error(
  "[nitro-error:storage_full] NitroStorage: Disk SQLite set failed: database or disk is full",
);

describe("storage error codes behind error.cause", () => {
  it("reads the code from a wrapped storage error", () => {
    const wrapped = new Error("Could not save settings", { cause: full });

    expect(getStorageErrorCode(wrapped)).toBe("storage_full");
    expect(isStorageError(wrapped, "storage_full")).toBe(true);
  });

  it("reads the code through several wrappers", () => {
    const inner = new Error("middle", { cause: full });
    const outer = new Error("outer", { cause: inner });

    expect(getStorageErrorCode(outer)).toBe("storage_full");
  });

  it("prefers the outer tag over a tag in the cause", () => {
    const corrupt = new Error("[nitro-error:storage_corruption] outer", {
      cause: full,
    });

    expect(getStorageErrorCode(corrupt)).toBe("storage_corruption");
  });

  it("stops on a cause cycle", () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    Object.defineProperty(first, "cause", { value: second });

    expect(getStorageErrorCode(first)).toBeUndefined();
  });

  it("stops after a fixed depth", () => {
    let error: Error = full;
    for (let index = 0; index < 10; index += 1) {
      error = new Error(`wrapper ${index}`, { cause: error });
    }

    expect(getStorageErrorCode(error)).toBeUndefined();
  });

  it("ignores a cause that is not an Error", () => {
    const wrapped = new Error("outer", {
      cause: "[nitro-error:storage_full] text",
    });

    expect(getStorageErrorCode(wrapped)).toBeUndefined();
  });
});
