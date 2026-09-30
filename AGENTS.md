# AGENTS

React Native Nitro Storage — synchronous storage for React Native via JSI.

## Quick Reference

- Package manager: `bun` / `bunx`
- Root quality gate (library): `bun run check`
- Example lint: `bun run example:lint`

## Universal Rules

- Shared item/batch/transaction/raw-value logic lives once in `packages/react-native-nitro-storage/src/storage-core.ts` (`createStorageCore(buildAdapter)`); `src/index.ts` and `src/index.web.ts` are thin platform adapters. Keep export parity between the two entrypoints and put platform divergences behind the `StorageCoreAdapter` seam instead of duplicating logic.
- All mutable storage state (memory store, pending write maps, raw caches, registered migrations, event registry, metrics) is created inside `createStorageCore`, so each entrypoint owns its own instance; never hoist that state to module-level singletons shared across entries (tests load both entrypoints in one Jest runtime).
- Add/update tests for behavior changes in `packages/react-native-nitro-storage/src/__tests__/`.
- Never manually edit `packages/react-native-nitro-storage/nitrogen/generated/**`.
- If Nitro spec/native bindings change, run `bun run codegen` and commit generated files.
- For user-facing behavior changes, update `README.md` and `CHANGELOG.md`.
- Keep README feature docs exhaustive: each public feature should have at least one concrete TypeScript use-case snippet.
- In `CHANGELOG.md`, do not keep an `Unreleased` section; always place changes under the current version header at the top.
- PR body is the current version's CHANGELOG section. The GitHub release description must match it. Do not add Summary, Test plan, or extra sections.
- For `apps/example`, prefer extending shared UI primitives/tokens in `apps/example/components/shared.tsx` instead of adding repeated inline styling per screen.
- `apps/example/ios` and `apps/example/android` are generated (gitignored); CI must run `CI=1 bunx expo prebuild --platform <ios|android>` before Pod/Gradle steps.
- Do not re-add the removed `./plugins/with-fmt-ios-compat` plugin unless a current SDK 56+ iOS build proves the `fmt` pod patch is required again.
- Keep the Expo example on SDK 57's supported pair: `react@19.2.3`, `react-dom@19.2.3`, `react-native@0.86.3`. Do not override that React Native version with 0.87. Keep `typecheck:rn087` as the packed-declaration compatibility check against React Native 0.87.
- Android `packages/react-native-nitro-storage/android/CMakeLists.txt` must exclude `*Test.cpp` from the shared library source list to avoid duplicate `main` linker errors.
- In `src/storage-core.ts` and the entrypoints, avoid `any` for internal item casts; use the typed helper guards (`isUpdater`, typed key iteration, `asInternal`).
- If `src/Storage.nitro.ts` changes, run `bun run codegen` and ensure `cpp/bindings/HybridStorage.*` overrides stay aligned with generated `HybridStorageSpec`.
- Keep public API parity for prefix queries, versioned item writes, metrics APIs, web secure backend exports, and `storage.import` across `src/index.ts` and `src/index.web.ts`.
- `runTransaction` rollback for Disk/Secure uses batch set/remove paths; when testing with mocked native/web adapters, always mock `setBatch` and `removeBatch`.
- `storage.import(data, scope)` writes raw strings only — no serialization. For Memory scope it is atomic: all keys are written before any listener fires. For Disk/Secure it delegates to native `setBatch`.
- `setBatch` on Memory scope is two-phase: write all values first, then notify all listeners. Items with `validate` or `expiration` fall back to per-item `set` calls to preserve those semantics.
- TTL expiry fires `item.subscribe()` listeners synchronously on the read that detects expiry. Do not rely on the native event bus for TTL notification in tests — mock `setBatch`/`removeBatch` and assert listener calls directly.
- `createIndexedDBBackend` lives in `src/indexeddb-backend.ts` and is exported from the `react-native-nitro-storage/indexeddb-backend` subpath. The in-memory cache is always authoritative; IndexedDB writes are fire-and-forget.
- Web storage-event tests should keep a stable `window` event target across cases because `index.web.ts` guards subscription with a one-time flag.
- Web biometric fallback tests should mock `console.warn` and restore mocks per test to avoid expected dev warnings polluting Jest output.

## Native Code Rules

- Android `setSecure`, `deleteSecure`, `setSecureBatch`, `deleteSecureBatch` must all use `synchronized(inst)` to avoid cache invalidation races.
- Android `getSecureKeysCached()` must filter out `EncryptedSharedPreferences` internal keys (prefix `__androidx_security_crypto_encrypted_prefs_`).
- Android corruption recovery (`initializeEncryptedPreferences`) must rebuild a fresh `MasterKey` after deleting the old KeyStore alias — never reuse the stale `MasterKey` object.
- iOS `hasDisk` checks SQLite first, then the suite defaults; the legacy `standardUserDefaults` migration is a one-time versioned cutover on the first Disk operation (`ensureDiskMigrated`) (marker key `__nitro_storage_legacy_disk_migration_v1__`). Suite string keys are then imported into SQLite WAL once; the `suite_v1` marker in the SQLite `meta` table skips the import (and the suite domain read) on later launches. Do not replace Disk with MMKV; see `docs/native-libraries.md`.
- Android Disk uses `DiskSqliteStore` (WAL). `NitroStorage` SharedPreferences are imported once into SQLite; Secure stays on EncryptedSharedPreferences.
- iOS `setSecureBiometricWithLevel(level=0)` must delete any existing biometric Keychain entry and call `markBiometricKeyRemoved` before delegating to `setSecure`.
- C++ `toScope()`, `setSecureAccessControl()`, `setSecureBiometricWithLevel()` must reject `NaN`, `Inf`, and fractional values before `static_cast<int>` (UB or silent truncation otherwise).
- C++ tests that call `addOnChange` must heap-allocate `HybridStorage` via `std::make_shared` (not stack) because `addOnChange` uses `shared_from_this()`.
- Web `storage` object must export `getString`, `setString`, `deleteString`, and `isKeychainLockedError` to maintain parity with native.
- Web coalesced secure write fallbacks must use `secureDefaultAccessControl`, not hardcoded `AccessControl.WhenUnlocked`.

## Performance Notes

- `StorageItem#set(value)` must not read current storage value; only updater functions (`set(prev => next)`) should read.
- `storage.clear(StorageScope.Secure)` already clears biometric entries through native/web secure clear paths; do not call biometric clear again.
- Android secure writes default to synchronous `commit()` mode; `storage.setSecureWritesAsync(true)` opts into asynchronous `apply()` mode.
- Use `storage.flushSecureWrites()` after opting into async writes when deterministic secure persistence is required before assertions, namespace clears, or transactions.
- `getBatch(...)` raw-path misses return each item's internal default value instead of calling `item.get()` fallback reads.
