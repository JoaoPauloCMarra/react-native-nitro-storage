import { createDurabilityCoordinator } from "../core/durability";
import { AccessControl, StorageScope } from "../Storage.types";

function createBackend() {
  const setBatch = jest.fn();
  const removeBatch = jest.fn();
  const setSecureAccessControl = jest.fn();

  return {
    setBatch,
    removeBatch,
    setSecureAccessControl,
    backend: {
      setBatch,
      removeBatch,
      setSecureAccessControl,
    },
  };
}

describe("durability coordinator", () => {
  it("retains failed secure writes and retries them", () => {
    const { backend, setBatch } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    const failure = new Error("secure write failed");
    setBatch.mockImplementationOnce(() => {
      throw failure;
    });

    coordinator.scheduleSecureWrite("a", "one");
    coordinator.scheduleSecureWrite("b", "two");

    expect(() => coordinator.flushSecureWrites()).toThrow(failure);
    expect(coordinator.hasPendingSecureWrite("a")).toBe(true);
    expect(coordinator.hasPendingSecureWrite("b")).toBe(true);

    coordinator.flushSecureWrites();

    expect(setBatch).toHaveBeenLastCalledWith(
      ["a", "b"],
      ["one", "two"],
      StorageScope.Secure,
    );
    expect(coordinator.hasPendingSecureWrite("a")).toBe(false);
    expect(coordinator.hasPendingSecureWrite("b")).toBe(false);
  });

  it("retains an unattempted secure access-control group after an earlier group succeeds", () => {
    const { backend, setBatch, setSecureAccessControl } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    setBatch
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("second group failed");
      });

    coordinator.scheduleSecureWrite("first", "one", AccessControl.WhenUnlocked);
    coordinator.scheduleSecureWrite(
      "second",
      "two",
      AccessControl.AfterFirstUnlock,
    );

    expect(() => coordinator.flushSecureWrites()).toThrow(
      "second group failed",
    );
    expect(coordinator.hasPendingSecureWrite("first")).toBe(false);
    expect(coordinator.hasPendingSecureWrite("second")).toBe(true);

    coordinator.flushSecureWrites();

    expect(setSecureAccessControl).toHaveBeenLastCalledWith(
      AccessControl.AfterFirstUnlock,
    );
    expect(setBatch).toHaveBeenLastCalledWith(
      ["second"],
      ["two"],
      StorageScope.Secure,
    );
    expect(coordinator.hasPendingSecureWrite("second")).toBe(false);
  });

  it("keeps a failed disk delete queued for retry", () => {
    const { backend, removeBatch } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    const failure = new Error("disk delete failed");
    removeBatch.mockImplementationOnce(() => {
      throw failure;
    });

    coordinator.scheduleDiskWrite("removed", undefined);

    expect(() => coordinator.flushDiskWrites()).toThrow(failure);
    expect(coordinator.hasPendingDiskWrite("removed")).toBe(true);
    expect(coordinator.getPendingDiskWrite("removed")?.value).toBeUndefined();

    coordinator.flushDiskWrites();

    expect(removeBatch).toHaveBeenLastCalledWith(
      ["removed"],
      StorageScope.Disk,
    );
    expect(coordinator.hasPendingDiskWrite("removed")).toBe(false);
  });

  it("preserves a newer concurrent write over an in-flight older write", () => {
    const { backend, setBatch } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    setBatch.mockImplementationOnce(() => {
      coordinator.scheduleSecureWrite("same-key", "new");
    });

    coordinator.scheduleSecureWrite("same-key", "old");
    coordinator.flushSecureWrites();

    expect(coordinator.hasPendingSecureWrite("same-key")).toBe(true);
    expect(coordinator.getPendingSecureWrite("same-key")?.value).toBe("new");

    coordinator.flushSecureWrites();

    expect(setBatch).toHaveBeenLastCalledWith(
      ["same-key"],
      ["new"],
      StorageScope.Secure,
    );
    expect(coordinator.hasPendingSecureWrite("same-key")).toBe(false);
  });

  it("clears only the generation that a failed migration attempted", () => {
    const { backend, setBatch } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    const attempted = coordinator.scheduleSecureWrite("same-generation", "old");
    const newer = coordinator.scheduleSecureWrite("same-generation", "new");

    coordinator.clearPendingSecureWriteIf(attempted);

    expect(attempted.generation).toBeLessThan(newer.generation);
    expect(coordinator.getPendingSecureWrite("same-generation")?.value).toBe(
      "new",
    );
    expect(setBatch).not.toHaveBeenCalled();
  });

  it("preserves a newer disk write created by an in-flight flush", () => {
    const { backend, setBatch } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    setBatch.mockImplementationOnce(() => {
      coordinator.scheduleDiskWrite("same-disk-key", "new");
    });

    coordinator.scheduleDiskWrite("same-disk-key", "old");
    coordinator.flushDiskWrites();

    expect(coordinator.getPendingDiskWrite("same-disk-key")?.value).toBe("new");
    coordinator.flushDiskWrites();
    expect(setBatch).toHaveBeenLastCalledWith(
      ["same-disk-key"],
      ["new"],
      StorageScope.Disk,
    );
  });

  it("preserves a newer disk write created by an in-flight delete flush", () => {
    const { backend, removeBatch } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    removeBatch.mockImplementationOnce(() => {
      coordinator.scheduleDiskWrite("same-disk-delete-key", "recreated");
    });

    coordinator.scheduleDiskWrite("same-disk-delete-key", undefined);
    coordinator.flushDiskWrites();

    expect(coordinator.getPendingDiskWrite("same-disk-delete-key")?.value).toBe(
      "recreated",
    );
    coordinator.flushDiskWrites();
    expect(backend.setBatch).toHaveBeenLastCalledWith(
      ["same-disk-delete-key"],
      ["recreated"],
      StorageScope.Disk,
    );
  });

  it("preserves a newer secure write created by an in-flight delete flush", () => {
    const { backend, removeBatch } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    removeBatch.mockImplementationOnce(() => {
      coordinator.scheduleSecureWrite("same-secure-delete-key", "recreated");
    });

    coordinator.scheduleSecureWrite("same-secure-delete-key", undefined);
    coordinator.flushSecureWrites();

    expect(
      coordinator.getPendingSecureWrite("same-secure-delete-key")?.value,
    ).toBe("recreated");
    coordinator.flushSecureWrites();
    expect(backend.setBatch).toHaveBeenLastCalledWith(
      ["same-secure-delete-key"],
      ["recreated"],
      StorageScope.Secure,
    );
  });
});
