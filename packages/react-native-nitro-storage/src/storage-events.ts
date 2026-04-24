import { StorageScope } from "./Storage.types";

export type StorageChangeOperation =
  | "set"
  | "remove"
  | "clear"
  | "clearNamespace"
  | "setBatch"
  | "removeBatch"
  | "import"
  | "external";

export type StorageChangeSource = "memory" | "native" | "web" | "external";

export type StorageKeyChangeEvent = {
  type: "key";
  scope: StorageScope;
  key: string;
  oldValue: string | undefined;
  newValue: string | undefined;
  operation: StorageChangeOperation;
  source: StorageChangeSource;
};

export type StorageBatchChangeEvent = {
  type: "batch";
  scope: StorageScope;
  operation: StorageChangeOperation;
  source: StorageChangeSource;
  changes: StorageKeyChangeEvent[];
};

export type StorageChangeEvent =
  | StorageKeyChangeEvent
  | StorageBatchChangeEvent;

export type StorageEventListener = (event: StorageChangeEvent) => void;

type PrefixListener = {
  prefix: string;
  listener: StorageEventListener;
};

function addListener<T>(
  registry: Map<StorageScope, Set<T>>,
  scope: StorageScope,
  listener: T,
): () => void {
  let listeners = registry.get(scope);
  if (!listeners) {
    listeners = new Set();
    registry.set(scope, listeners);
  }

  listeners.add(listener);
  return () => {
    const scopedListeners = registry.get(scope);
    if (!scopedListeners) {
      return;
    }
    scopedListeners.delete(listener);
    if (scopedListeners.size === 0) {
      registry.delete(scope);
    }
  };
}

export class StorageEventRegistry {
  private readonly scopeListeners = new Map<
    StorageScope,
    Set<StorageEventListener>
  >();
  private readonly keyListeners = new Map<
    StorageScope,
    Map<string, Set<StorageEventListener>>
  >();
  private readonly prefixListeners = new Map<
    StorageScope,
    Set<PrefixListener>
  >();

  subscribe(scope: StorageScope, listener: StorageEventListener): () => void {
    return addListener(this.scopeListeners, scope, listener);
  }

  hasListeners(scope: StorageScope): boolean {
    return (
      (this.scopeListeners.get(scope)?.size ?? 0) > 0 ||
      (this.keyListeners.get(scope)?.size ?? 0) > 0 ||
      (this.prefixListeners.get(scope)?.size ?? 0) > 0
    );
  }

  subscribeKey(
    scope: StorageScope,
    key: string,
    listener: StorageEventListener,
  ): () => void {
    let scopedListeners = this.keyListeners.get(scope);
    if (!scopedListeners) {
      scopedListeners = new Map();
      this.keyListeners.set(scope, scopedListeners);
    }

    let keyListeners = scopedListeners.get(key);
    if (!keyListeners) {
      keyListeners = new Set();
      scopedListeners.set(key, keyListeners);
    }

    keyListeners.add(listener);
    return () => {
      const currentScopedListeners = this.keyListeners.get(scope);
      const currentKeyListeners = currentScopedListeners?.get(key);
      if (!currentKeyListeners) {
        return;
      }
      currentKeyListeners.delete(listener);
      if (currentKeyListeners.size === 0) {
        currentScopedListeners?.delete(key);
      }
      if (currentScopedListeners?.size === 0) {
        this.keyListeners.delete(scope);
      }
    };
  }

  subscribePrefix(
    scope: StorageScope,
    prefix: string,
    listener: StorageEventListener,
  ): () => void {
    const entry: PrefixListener = { prefix, listener };
    return addListener(this.prefixListeners, scope, entry);
  }

  emitKey(event: StorageKeyChangeEvent): void {
    this.emitToScope(event);
    this.emitToKey(event);
    this.emitToPrefixes(event);
  }

  emitBatch(event: StorageBatchChangeEvent): void {
    this.emitToScope(event);
    event.changes.forEach((change) => {
      this.emitToKey(change);
    });
    this.emitBatchToPrefixes(event);
  }

  private emitToScope(event: StorageChangeEvent): void {
    this.scopeListeners.get(event.scope)?.forEach((listener) => {
      listener(event);
    });
  }

  private emitToKey(event: StorageKeyChangeEvent): void {
    this.keyListeners
      .get(event.scope)
      ?.get(event.key)
      ?.forEach((listener) => {
        listener(event);
      });
  }

  private emitToPrefixes(event: StorageKeyChangeEvent): void {
    this.prefixListeners.get(event.scope)?.forEach(({ prefix, listener }) => {
      if (event.key.startsWith(prefix)) {
        listener(event);
      }
    });
  }

  private emitBatchToPrefixes(event: StorageBatchChangeEvent): void {
    this.prefixListeners.get(event.scope)?.forEach(({ prefix, listener }) => {
      const changes = event.changes.filter((change) =>
        change.key.startsWith(prefix),
      );
      if (changes.length > 0) {
        listener({ ...event, changes });
      }
    });
  }
}
