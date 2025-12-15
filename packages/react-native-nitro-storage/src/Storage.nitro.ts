import type { HybridObject } from "react-native-nitro-modules";

export enum StorageScope {
  Memory = 0,
  Disk = 1,
  Secure = 2,
}

export interface Storage extends HybridObject<{ ios: "c++"; android: "c++" }> {
  set(key: string, value: string, scope: number): void;
  get(key: string, scope: number): string | undefined;
  remove(key: string, scope: number): void;
  addOnChange(
    scope: number,
    callback: (key: string, value: string | undefined) => void
  ): () => void;
}
