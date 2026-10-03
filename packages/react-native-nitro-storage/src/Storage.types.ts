export enum StorageScope {
  Memory = 0,
  Disk = 1,
  Secure = 2,
}

export enum AccessControl {
  /** Accessible when unlocked (default). */
  WhenUnlocked = 0,
  /** Accessible after first unlock until restart. Good for background token refresh. */
  AfterFirstUnlock = 1,
  /** Accessible only when passcode is set, non-migratable. */
  WhenPasscodeSetThisDeviceOnly = 2,
  /** Same as WhenUnlocked but non-migratable between devices. */
  WhenUnlockedThisDeviceOnly = 3,
  /** Same as AfterFirstUnlock but non-migratable. */
  AfterFirstUnlockThisDeviceOnly = 4,
}

export enum BiometricLevel {
  /** No biometric requirement (default). */
  None = 0,
  /** iOS: Keychain user presence. Android: recent authentication when opening
   * the protected store; later access uses its cached keyset. Web: no biometric enforcement. */
  BiometryOrPasscode = 1,
  /** Biometric-only Keychain/Keystore policy, without passcode fallback.
   * Android authenticates when opening the store, not each access. Web: no biometric enforcement. */
  BiometryOnly = 2,
}
