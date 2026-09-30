import type { WebStorageBackend } from "./web-storage-backend";

export type WebBackendCapabilities = {
  buffered: boolean;
  flushable: boolean;
  closable: boolean;
  subscribable: boolean;
};

export function isIndexedDBBackendName(name: string | undefined): boolean {
  return name?.startsWith("indexeddb:") ?? false;
}

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
    buffered: isIndexedDBBackendName(backend.name),
    flushable: typeof backend.flush === "function",
    closable: typeof backend.close === "function",
    subscribable: typeof backend.subscribe === "function",
  };
}

export function isIndexedDBWebBackend(
  backend: WebStorageBackend | undefined,
): boolean {
  return isIndexedDBBackendName(backend?.name);
}
