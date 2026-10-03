import { createDurabilityCoordinator } from "../core/durability";
import { AccessControl, StorageScope } from "../Storage.types";

jest.mock("../shared", () => ({
  runMicrotask: (task: () => void) => mockScheduledMicrotasks.push(task),
}));

const mockScheduledMicrotasks: Array<() => void> = [];

type ScopedStorageScope = StorageScope.Disk | StorageScope.Secure;
type TestCoordinator = ReturnType<typeof createDurabilityCoordinator>;

function scheduleWrite(
  coordinator: TestCoordinator,
  scope: ScopedStorageScope,
  key: string,
  value: string | undefined = "value",
): void {
  if (scope === StorageScope.Disk) {
    coordinator.scheduleDiskWrite(key, value);
  } else {
    coordinator.scheduleSecureWrite(key, value);
  }
}

function flushWrites(
  coordinator: TestCoordinator,
  scope: ScopedStorageScope,
): void {
  if (scope === StorageScope.Disk) {
    coordinator.flushDiskWrites();
  } else {
    coordinator.flushSecureWrites();
  }
}

function hasPendingWrite(
  coordinator: TestCoordinator,
  scope: ScopedStorageScope,
  key: string,
): boolean {
  return scope === StorageScope.Disk
    ? coordinator.hasPendingDiskWrite(key)
    : coordinator.hasPendingSecureWrite(key);
}

function runNextScheduledMicrotask(): void {
  const task = mockScheduledMicrotasks.shift();
  if (task === undefined) {
    throw new Error("No scheduled microtask to run");
  }
  task();
}

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
  beforeEach(() => {
    mockScheduledMicrotasks.length = 0;
  });

  it.each([StorageScope.Disk, StorageScope.Secure])(
    "reports a scheduled %s flush failure and retains it for retry",
    (scope) => {
      const { backend, setBatch } = createBackend();
      const coordinator = createDurabilityCoordinator({
        backend,
        resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
      });
      const failure = new Error(`scheduled ${scope} write failed`);
      const observer = jest.fn();
      setBatch.mockImplementationOnce(() => {
        throw failure;
      });
      coordinator.setScheduledFlushErrorObserver(observer);

      scheduleWrite(coordinator, scope, "scheduled-key");

      expect(mockScheduledMicrotasks).toHaveLength(1);
      expect(runNextScheduledMicrotask).not.toThrow();
      expect(observer).toHaveBeenCalledTimes(1);
      expect(observer).toHaveBeenCalledWith({ scope, error: failure });
      expect(hasPendingWrite(coordinator, scope, "scheduled-key")).toBe(true);

      flushWrites(coordinator, scope);

      expect(hasPendingWrite(coordinator, scope, "scheduled-key")).toBe(false);
    },
  );

  it.each([StorageScope.Disk, StorageScope.Secure])(
    "rethrows a scheduled %s flush failure when no observer is registered",
    (scope) => {
      const { backend, setBatch } = createBackend();
      const coordinator = createDurabilityCoordinator({
        backend,
        resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
      });
      const failure = new Error(`scheduled ${scope} write failed`);
      setBatch.mockImplementationOnce(() => {
        throw failure;
      });

      scheduleWrite(coordinator, scope, "unobserved-key");

      let caught: unknown;
      try {
        runNextScheduledMicrotask();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBe(failure);
      expect(hasPendingWrite(coordinator, scope, "unobserved-key")).toBe(true);
    },
  );

  it("does not route explicit flush failures through the observer", () => {
    const { backend, setBatch } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    const failure = new Error("explicit disk flush failed");
    const observer = jest.fn();
    setBatch.mockImplementationOnce(() => {
      throw failure;
    });
    coordinator.setScheduledFlushErrorObserver(observer);
    coordinator.scheduleDiskWrite("explicit-key", "value");

    expect(() => coordinator.flushDiskWrites()).toThrow(failure);
    expect(observer).not.toHaveBeenCalled();
    expect(coordinator.hasPendingDiskWrite("explicit-key")).toBe(true);
  });

  it("uses the current observer when a scheduled flush runs and supports clearing it", () => {
    const { backend, setBatch } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    const failure = new Error("cleared observer disk flush failed");
    const observer = jest.fn();
    coordinator.setScheduledFlushErrorObserver(observer);
    setBatch.mockImplementationOnce(() => {
      throw failure;
    });
    coordinator.scheduleDiskWrite("cleared-observer-key", "value");
    coordinator.setScheduledFlushErrorObserver(undefined);

    let caught: unknown;
    try {
      runNextScheduledMicrotask();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(failure);
    expect(observer).not.toHaveBeenCalled();
    expect(coordinator.hasPendingDiskWrite("cleared-observer-key")).toBe(true);
  });

  it("keeps scheduled flush observers independent between coordinators", () => {
    const first = createBackend();
    const second = createBackend();
    const firstCoordinator = createDurabilityCoordinator({
      backend: first.backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    const secondCoordinator = createDurabilityCoordinator({
      backend: second.backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    const firstFailure = new Error("first coordinator failed");
    const secondFailure = new Error("second coordinator failed");
    const firstObserver = jest.fn();
    first.setBatch.mockImplementationOnce(() => {
      throw firstFailure;
    });
    second.setBatch.mockImplementationOnce(() => {
      throw secondFailure;
    });
    firstCoordinator.setScheduledFlushErrorObserver(firstObserver);
    firstCoordinator.scheduleDiskWrite("first-key", "value");
    secondCoordinator.scheduleSecureWrite("second-key", "value");

    expect(runNextScheduledMicrotask).not.toThrow();
    let caught: unknown;
    try {
      runNextScheduledMicrotask();
    } catch (error) {
      caught = error;
    }

    expect(firstObserver).toHaveBeenCalledWith({
      scope: StorageScope.Disk,
      error: firstFailure,
    });
    expect(caught).toBe(secondFailure);
    expect(firstCoordinator.hasPendingDiskWrite("first-key")).toBe(true);
    expect(secondCoordinator.hasPendingSecureWrite("second-key")).toBe(true);
  });

  it("propagates observer errors and keeps failed writes queued", () => {
    const { backend, setBatch } = createBackend();
    const coordinator = createDurabilityCoordinator({
      backend,
      resolveSecureDefaultAccessControl: () => AccessControl.WhenUnlocked,
    });
    const backendFailure = new Error("backend secure flush failed");
    const observerFailure = new Error("observer failed");
    const observer = jest.fn(() => {
      throw observerFailure;
    });
    setBatch.mockImplementationOnce(() => {
      throw backendFailure;
    });
    coordinator.setScheduledFlushErrorObserver(observer);
    coordinator.scheduleSecureWrite("observer-error-key", "value");

    let caught: unknown;
    try {
      runNextScheduledMicrotask();
    } catch (error) {
      caught = error;
    }

    expect(observer).toHaveBeenCalledWith({
      scope: StorageScope.Secure,
      error: backendFailure,
    });
    expect(caught).toBe(observerFailure);
    expect(coordinator.hasPendingSecureWrite("observer-error-key")).toBe(true);

    coordinator.flushSecureWrites();

    expect(coordinator.hasPendingSecureWrite("observer-error-key")).toBe(false);
  });

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
