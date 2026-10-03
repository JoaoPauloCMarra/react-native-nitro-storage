import {
  storage,
  StorageScope,
  type StorageScheduledFlushError,
  type StorageScheduledFlushErrorObserver,
} from "../src";
import type { StorageScheduledFlushErrorObserver as WebObserver } from "../src/index.web";
import type { StorageScheduledFlushErrorObserver as TestingObserver } from "../src/testing";

const observer: StorageScheduledFlushErrorObserver = (event) => {
  const scope: StorageScope.Disk | StorageScope.Secure = event.scope;
  const error: unknown = event.error;
  // @ts-expect-error Event scope is readonly.
  event.scope = StorageScope.Disk;
  // @ts-expect-error The original failure is unknown until narrowed.
  const message: string = event.error.message;
  void scope;
  void error;
  void message;
};
const webObserver: WebObserver = observer;
const testingObserver: TestingObserver = observer;
storage.setScheduledFlushErrorObserver(observer);
storage.setScheduledFlushErrorObserver(undefined);
const invalidScope: StorageScheduledFlushError = {
  // @ts-expect-error Memory writes have no scheduled backend flush.
  scope: StorageScope.Memory,
  error: "failure",
};
// @ts-expect-error An observer must be callable.
storage.setScheduledFlushErrorObserver({ error: "failure" });
void webObserver;
void testingObserver;
void invalidScope;
