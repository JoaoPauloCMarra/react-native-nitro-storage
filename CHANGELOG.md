# Changelog

All notable changes to this project are documented in this file.

The format follows Keep a Changelog and the project adheres to SemVer.

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
