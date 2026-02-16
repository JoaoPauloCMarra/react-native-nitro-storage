import { type HybridObject } from "react-native-nitro-modules";

export interface Storage extends HybridObject<{ ios: "c++"; android: "c++" }> {
  set(key: string, value: string, scope: number): void;
  get(key: string, scope: number): string | undefined;
  remove(key: string, scope: number): void;
  clear(scope: number): void;
  has(key: string, scope: number): boolean;
  getAllKeys(scope: number): string[];
  size(scope: number): number;
  setBatch(keys: string[], values: string[], scope: number): void;
  getBatch(keys: string[], scope: number): (string | undefined)[];
  removeBatch(keys: string[], scope: number): void;
  addOnChange(
    scope: number,
    callback: (key: string, value: string | undefined) => void,
  ): () => void;
  setSecureAccessControl(level: number): void;
  setKeychainAccessGroup(group: string): void;
  setSecureBiometric(key: string, value: string): void;
  getSecureBiometric(key: string): string | undefined;
  deleteSecureBiometric(key: string): void;
  hasSecureBiometric(key: string): boolean;
  clearSecureBiometric(): void;
}
