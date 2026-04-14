# Changelog

All notable changes to this project are documented in this file.

The format follows Keep a Changelog and the project adheres to SemVer.

## 0.4.5 - 2026-04-14

### Added

- Add configurable web Disk backend hooks: `setWebDiskStorageBackend()`, `getWebDiskStorageBackend()`, and `flushWebStorageBackends()`.
- Extend the web backend contract with optional batch, sizing, subscription, and flush hooks for higher-performance custom backends.
- Add IndexedDB backend support for `getMany`, `setMany`, `removeMany`, `size`, `flush`, and `BroadcastChannel`-based cross-tab sync.
- Expand regression coverage for web backend overrides, backend subscription-driven cache invalidation, backend flush hooks, IndexedDB broadcast sync, and IndexedDB error surfacing.
- Add Disk write buffering APIs: `coalesceDiskWrites`, `storage.setDiskWritesAsync()`, `storage.flushDiskWrites()`, and `storage.getCapabilities()`.
- Add structured storage error classification via `getStorageErrorCode()` while keeping `isKeychainLockedError()` as the convenience helper, and tag native bridge errors with stable `[nitro-error:<code>]` markers.
- Extend the example app and smoke runner to cover runtime capabilities, structured error codes, and Disk write buffering flows.

### Changed

- Upgrade to **Nitro Modules 0.35.4** and regenerate bindings against the latest stable Nitro 0.35 line.
- Migrate `nitro.json` to the current schema (`$schema`, `ignorePaths`, `gitAttributesGeneratedFlag`, and `autolinking.all.language = "c++"`).
- Raise the published `react-native-nitro-modules` requirement to `>= 0.35.4` so package metadata matches the tested Nitro baseline.
- Refresh root tooling to current patch releases for linting, testing, and workspace orchestration.
- Align the example app to `react-native-nitro-modules 0.35.4`.
- Add an example-only Expo config plugin that patches the generated iOS `fmt` pod during `pod install`, keeping clean prebuilds working on Xcode 26.4.
- Switch web operation timing to `performance.now()` when available for tighter metrics on fast paths.
- Keep the example smoke runner aligned with the expanded web backend API surface, including backend override and flush coverage on web.

## 0.4.2/0.4.3 - 2026-03-05

### Fixed

- Fix crash on Android devices without biometric hardware — all biometric storage paths now catch initialization failures gracefully (non-biometric operations unaffected).
- Fix Android keystore corruption recovery incorrectly wiping data on a locked keystore — only `AEADBadTagException` now triggers wipe; all other init failures throw without touching stored data.
- Synchronize `AndroidStorageAdapter.invalidateSecureKeysCache()` under instance lock to close a race between concurrent reads and writes.
- Synchronize `setSecureBatch`/`deleteSecureBatch` under instance lock to prevent cache rebuild racing a mid-batch write.
- Propagate `SharedPreferences.commit()` failures out of `applySecureEditor` instead of swallowing them.
- Fix `IOSStorageAdapterCpp::clearDisk()` using `dictionaryRepresentation` (includes OS-injected keys) — switched to `persistentDomainForName:` scoped strictly to the app suite.
- Fix `clearSecure()`/`clearSecureBiometric()` clearing the in-memory key cache before confirming `SecItemDelete` succeeded — cache is now only updated after the deletion is confirmed.
- Fix potential unexpected biometric auth prompt in `getSecure()` — added `kSecUseAuthenticationUI = kSecUseAuthenticationUIFail` consistent with `hasSecure()`.
- Fix `setKeychainAccessGroup()` race where a concurrent `getAllKeysSecure()` could observe a stale cache between group update and cache invalidation — both are now updated atomically under both mutexes.
- Fix CFErrorRef leak in `SecAccessControlCreateWithFlags` error path.
- Fix `setSecureBiometricWithLevel()` incorrectly reporting "value restored" when backup restoration itself threw — now propagates the composite error.
- Mark `secureKeyCacheHydrated_` as `std::atomic<bool>` to satisfy the C++ memory model.
- Fix `HybridStorage::addOnChange()` unsubscribe lambda capturing `this` raw pointer — switched to `std::weak_ptr` capture to prevent use-after-free if `HybridStorage` is destroyed before the JS unsubscribe callback fires.
- Validate access control level in `setSecureAccessControl()` (must be 0–4) and biometric level in `setSecureBiometricWithLevel()` (must be 0–2) — invalid values now throw instead of being silently passed to the native adapter.
- Fix `clearSecureBiometric()` calling `onScopeClear` which unnecessarily evicted all secure keys from the index — now only marks the index stale for lazy re-hydration.
- Fix `fromJavaStringArray()` silently dropping null JNI array elements — null entries are now preserved as empty strings to maintain positional alignment.
- Extend `isKeychainLockedError()` to detect Android `KeyPermanentlyInvalidatedException` and `InvalidKeyException` in addition to existing iOS/Android patterns.
- Fix web `getAll()` performing O(n) individual reads — switched to `WebStorage.getBatch()`.
- Fix web `subscribe()` accumulating `window.addEventListener("storage", …)` calls — now reference-counted and removed when the last subscriber unsubscribes.
- Fix web `import()` for Secure scope skipping `flushSecureWrites()` and `setSecureAccessControl()` before writing.
- Expand ProGuard/R8 keep rules with explicit method-signature patterns so JNI-callable methods survive aggressive R8 shrinking in release builds.

## 0.4.1 - 2026-03-04

### Added

- Add `storage.import(data, scope)` to bulk-load a `Record<string, string>` of raw key/value pairs into any scope in one call. Memory imports are atomic (all keys visible simultaneously before any listener fires).
- Add `createIndexedDBBackend(dbName?, storeName?)` factory (exported from `react-native-nitro-storage/indexeddb-backend`) that wraps IndexedDB with a write-through in-memory cache, enabling persistent web Secure storage for large payloads without blocking the UI thread.

### Fixed

- Fix TTL expiry notification: subscribers registered via `item.subscribe()` are now correctly notified when a value expires on `item.get()` — both on cache-hit expiry and on envelope-parse expiry. Previously the notification was only emitted by the native event bus, which is not triggered in write-through or coalesced paths.
- Fix `setBatch` Memory atomicity: all values in a Memory-scope batch are now written to the store before any listener is notified, eliminating partial-batch observation windows. Items with `validate` or `expiration` config fall back to per-item sets to preserve those semantics.

### Changed

- Upgrade to **Nitro Modules 0.35.0** — regenerate nitrogen specs with the new `registerAllNatives()` JNI entry point, fixing the Kotlin `HybridObject` `jni::global_ref` memory leak (Nitro #1238).
- Update `cpp-adapter.cpp` to use `registerAllNatives()` instead of the deprecated `initialize(vm)` shim.
- Upgrade example app to **Expo SDK 55** (`expo ~55.0.4`, `expo-router ~55.0.3`, `expo-status-bar ~55.0.4`, `expo-system-ui ~55.0.9`, `expo-build-properties ~55.0.9`, `expo-asset ~55.0.8`, `babel-preset-expo ~55.0.10`).
- Bump to **React 19.2.0** and **React Native 0.83.2** across workspace and example.
- Update `react-native-screens` to `~4.23.0` and `react-native-safe-area-context` to `~5.6.2` in the example app.
- Remove `newArchEnabled` from example `app.json` — Expo SDK 55 dropped Legacy Architecture; new arch is always on.
- Add iOS and Android example build CI jobs that run `expo prebuild` and verify native compilation under New Architecture.
- Add `--provenance` flag to `npm publish` for npm supply-chain attestation.

## 0.4.0 - 2026-02-25

### Added

- Add prefix query APIs: `storage.getKeysByPrefix(prefix, scope)` and `storage.getByPrefix(prefix, scope)`.
- Add optimistic concurrency APIs on items: `item.getWithVersion()` and `item.setIfVersion(version, value)`.
- Add storage metrics APIs: `storage.setMetricsObserver`, `storage.getMetricsSnapshot`, and `storage.resetMetrics`.
- Add `biometricLevel` item/auth config and native bridge support for `setSecureBiometricWithLevel`.
- Add configurable web Secure backend hooks: `setWebSecureStorageBackend` and `getWebSecureStorageBackend`.
- Add native prefix key retrieval plumbing (`getKeysByPrefix`) across Nitro spec, C++ core/bindings, Android, and iOS.
- Add regression coverage for prefix APIs, versioned APIs, metrics APIs, secure coalescing with access control, cross-tab web updates, and transaction rollback batch behavior.

### Changed

- Optimize non-memory transaction rollback paths to use batch native/web writes and removals.
- Improve batch read semantics by using per-item cache hits and returning each item's default when raw batch data is missing.
- Improve native/web secure write coalescing by preserving optional access control without violating strict optional typing.
- Keep iOS secure keychain cache/index behavior aligned with new prefix query and biometric-level paths.
- Expand README/API docs to cover the new public API surface with concrete TypeScript use-case snippets.

## 0.3.2 - 2026-02-22

### Added

- Add `storage.setSecureWritesAsync(enabled)` to toggle Android secure writes between synchronous `commit()` and asynchronous `apply()`.
- Add `storage.flushSecureWrites()` for deterministic flush control of coalesced secure writes.
- Add native `removeByPrefix(prefix, scope)` plumbing and route namespace clears through the native/web prefix path.
- Add dedicated C++ binding tests for `HybridStorage` behavior (`cpp/bindings/HybridStorageTest.cpp`), wired into `test:cpp`.
- Add type-level public API tests (`test:types`) and package content guard checks (`check:pack`).

### Changed

- Skip unnecessary read path on direct `item.set(value)` writes (still reads for updater functions).
- Reuse TTL envelope parse results while entries remain unexpired to avoid repeated JSON parse/deserialization work.
- Group secure raw batch writes by per-item access control so secure batch paths stay fast even with mixed access-control settings.
- Optimize C++ batch listener dispatch by copying scoped listeners once per batch operation.
- Avoid duplicate secure biometric clearing calls by relying on secure clear paths that already include biometric cleanup.
- Optimize web secure/disk key bookkeeping with an indexed key cache (faster `size`, `getAllKeys`, and namespace clears without repeated `localStorage` scans).
- Improve iOS secure key union performance by deduplicating with an `unordered_set`.
- Extract shared React hooks into `src/storage-hooks.ts` to reduce native/web entrypoint duplication.
- Expand benchmark coverage to include Disk and Secure scope throughput checks and tighten regression thresholds.
- Refresh the Expo example app UI with a cleaner shared design system and add an Android secure write mode demo control.
- Configure Expo iOS example builds to use React Native source builds under New Architecture and silence expected deprecated RN host warnings in the Android template wrapper.
- Extend CI with Android/iOS example build jobs under New Architecture.
- Expand README coverage so every public feature has a concrete TypeScript use-case example, including secure write flush, biometric/access-control usage, batch bootstrap, and storage utility workflows.

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
