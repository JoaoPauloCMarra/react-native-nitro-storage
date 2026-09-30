import { isIndexedDBBackendName } from "./web-backend-contract";

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
    disk: isIndexedDBBackendName(diskBackendName),
    secure: isIndexedDBBackendName(secureBackendName),
  };
}

export const DEFAULT_SECURE_WRITES_ASYNC = false;

export function resolveNativeWriteBuffering(
  platform: "ios" | "android",
  secureWritesAsync: boolean = DEFAULT_SECURE_WRITES_ASYNC,
): WriteBuffering {
  return {
    disk: true,
    secure: platform === "android" ? secureWritesAsync : false,
  };
}
