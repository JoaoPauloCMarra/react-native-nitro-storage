# Changelog

All notable changes to this project are documented in this file.

The format follows Keep a Changelog and the project adheres to SemVer.

## 0.3.1 - 2026-02-16

### Added

- Add package-level lint/format scripts and workspace `eslint-config-expo-magic` flat config wiring.

### Changed

- Isolate web Secure scope keys under `__secure_` prefix while keeping biometric fallback under `__bio_`.
- Align `storage.clear(StorageScope.Secure)` with biometric cleanup semantics.
- Update README installation, enum docs, and quality command docs to match current APIs.

### Fixed

- Fix web scope bleed where clearing Disk/Secure could wipe the other secure domain.
- Fix biometric listener updates by emitting change notifications for biometric set/delete/clear paths.
- Fix secure namespace cleanup by flushing pending secure writes before namespace removal.
- Fix secure access-control leakage by applying access control at write time and disabling coalesced raw batch path when access control is configured.
- Fix global `storage.setAccessControl(...)` handling so non-item raw secure writes keep the configured level instead of being forced back to default.
- Fix Android secure key enumeration to return deduplicated key sets when secure and biometric stores share key names.

## 0.3.0 - 2026-02-15

### Added

- Add `useStorageSelector(item, selector, isEqual?)` to reduce rerenders from unrelated object updates.
- Add opt-in `coalesceSecureWrites` and per-item `readCache` controls in `createStorageItem` config.
- Add benchmark regression gate (`benchmark` task/script) and wire it into CI and publish checks.

### Changed

- Switch default serialization to a primitive fast path for primitives while preserving JSON compatibility for objects and legacy values.
- Replace broad listener fan-out with key-indexed registries and automatic pruning for memory/native/web paths.
- Rework Turbo task graph so `build` depends on `codegen`, `test`/`typecheck` run from source, and `codegen` can be cached.

### Fixed

- Route native batch calls through true adapter-level batch APIs (HybridStorage + iOS/Android adapters) instead of per-key loops.
- Add read-through cache invalidation on scoped/key change events and native/web clear paths.

## 0.2.1 - 2026-02-15

### Added

- Add explicit package `exports` for ESM/CJS/react-native/web resolution.

### Fixed

- Preserve validation and TTL semantics in batch APIs by falling back to per-item paths when needed.
- Preserve item-level semantics in transaction `setItem`/`removeItem` by using item methods directly.
- Decode native batch missing values correctly to avoid empty-string ambiguity on iOS/Android C++ bindings.
- Avoid duplicate observer updates on native/web `setBatch` paths.
- Scope iOS disk storage to a dedicated UserDefaults suite and avoid clearing unrelated app defaults.
- Use a package-specific Android master-key alias for encrypted storage initialization and recovery.
- Expo config plugin now preserves existing `NSFaceIDUsageDescription` values.
- Expo config plugin makes Android biometric permissions opt-in.

### Changed

- Raise `react` peer dependency floor to `>=18.2.0`.
- Update CI workflow action versions and Bun runtime pin to latest stable releases.

## 0.2.0 - 2026-02-15

### Added

- Export `migrateFromMMKV` from the package root entrypoint.
- Add dedicated web storage tests and include `index.web.ts` in coverage collection.
- Add `runTransaction(scope, fn)` with rollback on thrown errors.
- Add versioned migration APIs: `registerMigration` and `migrateToLatest`.
- Add schema-aware storage options: `validate` and `onValidationError`.
- Add per-item TTL support via `expiration.ttlMs`.

### Fixed

- Validate batch operation scope to prevent mixed-scope usage.
- Avoid duplicate native remove calls in `removeBatch`.
- Clear cached item values on `delete()` to prevent stale reads (native and web).

### Changed

- Standardize internal package scripts and README contributor commands to Bun/Bunx.
- Remove the Turbo `test` outputs config to avoid warnings on non-coverage test runs.
- Expand README with complete API behavior/throws documentation.
- Strengthen native and web test coverage for validation, TTL, migrations, and transactions.

## 0.1.4 - 2026-02-09

### Added

- Add `clearAll` event.

### Fixed

- Fix Android behavior.

### Changed

- Bump react-native-nitro-modules to the latest version and raise the peer dependency floor.

## 0.1.3 - 2026-01-22

### Fixed

- Prevent ProGuard from stripping the JNI class in release builds.

## 0.1.2 - 2026-01-07

### Added

- Finalize batch operations and clean up the implementation.
- Add missing batch coverage and exclude web from the coverage report.

### Changed

- Point types to the correct path and simplify bob targets.

## 0.1.1 - 2025-12-15

### Added

- MMKV migration utility.
- Benchmark UI improvements.

### Changed

- Update native build configs.
- Update README screenshots.
- Add tests for memory item deletion and MMKV migration, and simplify the README.

## 0.1.0 - 2025-12-15

### Added

- Initial public release from the private repository.
