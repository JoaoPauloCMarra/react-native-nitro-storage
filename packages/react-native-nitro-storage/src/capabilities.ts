export type WriteBuffering = {
  disk: boolean;
  secure: boolean;
};

export type PlatformCapabilityProfile = {
  platform: "native" | "web" | "testing";
  writeBuffering: WriteBuffering;
};

export function resolveWebWriteBuffering(
  diskBackendName: string | undefined,
  secureBackendName: string | undefined,
): WriteBuffering {
  return {
    disk: isIndexedDBWebBackendByName(diskBackendName),
    secure: isIndexedDBWebBackendByName(secureBackendName),
  };
}

function isIndexedDBWebBackendByName(backendName: string | undefined): boolean {
  if (!backendName) {
    return false;
  }
  return backendName.startsWith("indexeddb:");
}

export function resolveNativeWriteBuffering(
  platform: "ios" | "android",
  secureWritesAsync: boolean,
): WriteBuffering {
  return {
    disk: true,
    secure: platform === "android" ? secureWritesAsync : false,
  };
}
