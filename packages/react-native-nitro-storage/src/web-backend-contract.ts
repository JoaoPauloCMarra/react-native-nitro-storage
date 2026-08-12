import type { WebStorageBackend } from "./web-storage-backend";

export type WebBackendCapabilities = {
  buffered: boolean;
  flushable: boolean;
  closable: boolean;
  subscribable: boolean;
};

export function describeWebBackendCapabilities(
  backend: WebStorageBackend | undefined,
): WebBackendCapabilities {
  if (!backend) {
    return {
      buffered: false,
      flushable: false,
      closable: false,
      subscribable: false,
    };
  }

  return {
    buffered: backend.name?.startsWith("indexeddb:") ?? false,
    flushable: typeof backend.flush === "function",
    closable: typeof backend.close === "function",
    subscribable: typeof backend.subscribe === "function",
  };
}

export function isIndexedDBWebBackend(
  backend: WebStorageBackend | undefined,
): boolean {
  return backend?.name?.startsWith("indexeddb:") ?? false;
}
