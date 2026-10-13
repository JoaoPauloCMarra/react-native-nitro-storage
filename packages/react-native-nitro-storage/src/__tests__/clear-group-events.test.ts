import type { StorageChangeEvent } from "../storage-events";
import { StorageScope } from "../Storage.types";
import { createTestCore } from "./core-test-backend";

describe.each([
  StorageScope.Memory,
  StorageScope.Disk,
  StorageScope.Secure,
] as const)("clearGroup change operation (%s)", (scope) => {
  it("emits clearGroup while removeBatch keeps its own operation", () => {
    const { createStorageItem, removeBatch, storage } = createTestCore();
    const first = createStorageItem({
      key: "first",
      scope,
      defaultValue: "",
      group: "g",
    });
    const second = createStorageItem({
      key: "second",
      scope,
      defaultValue: "",
      group: "g",
    });
    first.set("a");
    second.set("b");
    const events: StorageChangeEvent[] = [];
    storage.subscribe(scope, (event) => {
      events.push(event);
    });

    storage.clearGroup("g");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "batch",
      operation: "clearGroup",
    });
    expect(first.has()).toBe(false);

    first.set("a");
    removeBatch([first, second], scope);
    expect(events[events.length - 1]).toMatchObject({
      type: "batch",
      operation: "removeBatch",
    });
  });
});
