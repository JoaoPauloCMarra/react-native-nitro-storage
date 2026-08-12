import type { StorageCore } from "./storage-core";
import type {
  SecurityCapabilities,
  StorageCapabilities,
} from "./storage-runtime";
import type { AccessControl, StorageScope } from "./Storage.types";

export type PlatformStorage = StorageCore["storage"] & {
  setAccessControl(level: AccessControl): void;
  setSecureWritesAsync(enabled: boolean): void;
  setKeychainAccessGroup(group: string): void;
  getCapabilities(): StorageCapabilities;
  getSecurityCapabilities(): SecurityCapabilities;
};

export type PlatformScope = StorageScope;
