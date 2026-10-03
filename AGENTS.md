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
- Android Disk uses `DiskSqliteStore` (WAL), opened lazily on the first Disk call; never construct it at app start. Disk SQLite failures on both platforms must keep the `[nitro-error:storage_full]` and `[nitro-error:storage_corruption]` tags. `NitroStorage` SharedPreferences are imported once into SQLite; Secure stays on EncryptedSharedPreferences.
- Android `DiskSqliteStore` multi-statement writes must run through `inTransaction`: SQLite rolls a transaction back by itself on `SQLITE_FULL`, and a bare `endTransaction()` in `finally` then replaces the `SQLiteFullException` with "cannot rollback - no transaction is active" and drops the `storage_full` tag.
- Android `DiskSqliteStore.get` must read values above `VALUE_CHUNK_BYTES` in `substr(CAST(value AS BLOB), ...)` chunks; one row larger than the platform `CursorWindow` (2 MiB) cannot be read through a cursor.
- C++ `SqliteDiskStore` pins `wal_autocheckpoint` and `journal_size_limit`; stock SQLite keeps the WAL at its high-water size without the limit.
- Android Disk opens with `CREATE_IF_NECESSARY or NO_LOCALIZED_COLLATORS or ENABLE_WRITE_AHEAD_LOGGING` so the framework keeps WAL on every pooled connection and never flips the journal mode or rewrites `android_metadata` at open. If that open fails with a non-corruption `SQLiteException` (a full volume cannot convert a rollback-journal database), it retries once without the WAL flag and rethrows the first error if the retry also fails; the next launch tries WAL again. Corruption is never retried; do not set `journal_mode`, `wal_autocheckpoint`, or `journal_size_limit` by PRAGMA (the framework applies 100 pages / 512 KiB). `rawQuery(...).close()` never runs a PRAGMA; step it. `synchronous=NORMAL` is used only when `journal_mode` reports `wal`; otherwise `FULL`.
- A corrupt Disk database is never deleted on open or on a failed call (Android opens with a no-op `DatabaseErrorHandler`). Every Disk call reports `storage_corruption`; only `clear(Disk)` deletes the database with its `-wal`/`-shm`/`-journal` files and recreates an empty store, on both platforms. `clear(Disk)` takes the same delete-and-recreate path when the normal delete fails with `storage_full`, and wipes the legacy defaults/preferences before recreating. In `storage-core.ts`, `clear(Disk)` must reach `backend.clear` even when the previous-value read or the pending-write flush throws.
- `SQLITE_IOERR_*` is `storage_full` only with proof of no space: iOS when `sqlite3_system_errno` is `ENOSPC` or `EDQUOT`; Android when a `SQLiteDiskIOException` occurs with less than 1 MiB usable on the database volume. Other IO errors stay untagged.
- Disk prefix queries use a primary-key range (`key >= ? AND key < ?`). Prefixes that are not well-formed (invalid UTF-8 in C++, unpaired surrogates in Kotlin) keep the `LIKE` scan so results stay identical; the differential tests guard both paths.
- C++ tests must not `fork()` without `exec`: Apple's SQLite crashes in `os_log` in a forked child. Spawn the test binary again (`posix_spawn`) for process-kill scenarios.
- New `cpp/**/*Test.cpp` and `ios/*Test.mm` files must be registered in `packages/react-native-nitro-storage/scripts/test-cpp.js`. Test helpers (fault VFS, fake Keychain) live inside those files only; other names ship in the pod and npm package.
- Android JVM tests live in `packages/react-native-nitro-storage/android/src/test` and run with `bun run android:test`. It is a required local release step and needs the generated example Android project (`bun run example:prebuild`); it is not part of `check` or CI.
- iOS `setSecureBiometricWithLevel(level=0)` must delete any existing biometric Keychain entry and call `markBiometricKeyRemoved` before delegating to `setSecure`.
- C++ `toScope()`, `setSecureAccessControl()`, `setSecureBiometricWithLevel()` must reject `NaN`, `Inf`, and fractional values before `static_cast<int>` (UB or silent truncation otherwise).
- C++ tests that call `addOnChange` must heap-allocate `HybridStorage` via `std::make_shared` (not stack) because `addOnChange` uses `shared_from_this()`.
- Web `storage` object must export `getString`, `setString`, `deleteString`, and `isKeychainLockedError` to maintain parity with native.
- Web coalesced secure write fallbacks must use `secureDefaultAccessControl`, not hardcoded `AccessControl.WhenUnlocked`.

## Performance Notes

- `StorageItem#set(value)` must not read current storage value; only updater functions (`set(prev => next)`) should read.
- `storage.clear(StorageScope.Secure)` already clears biometric entries through native/web secure clear paths; do not call biometric clear again.
- Android secure writes default to synchronous `commit()` mode; `storage.setSecureWritesAsync(true)` opts into asynchronous `apply()` mode.
- `storage.flushSecureWrites()` drains the JavaScript queue, not Android's asynchronous `apply()` persistence. Select synchronous secure writes before writes that need synchronous persistence; changing the mode is not a barrier for earlier `apply()` calls.
- `getBatch(...)` raw-path misses return each item's internal default value instead of calling `item.get()` fallback reads.

## Replay Maintenance

- Keep `e2e/storage-replay-coverage.json` aligned with concrete assertions in the example and its `.ad` flows. Distinguish native storage, testing adapters, and pending hardware prerequisites.
- After package runtime or example changes, review affected coverage before running `bun run example:replay:refresh`. `check` validates the source lock and replay helper tests without using a device.
- Run `bun run example:replay --platform ios --udid <exact-target>` or `--platform android --serial <exact-target>` only when device testing is authorized. The runner uses official `agent-device test`, and unique OS-temp artifacts; `agent-device test` closes each attempt session itself.
- A static source lock is not runtime proof. Do not report skipped biometric, keychain-lock, corruption, or power-loss acceptance rows as passing.
