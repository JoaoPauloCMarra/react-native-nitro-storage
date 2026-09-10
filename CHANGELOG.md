# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Breaking changes are always listed first in each release section.

## [0.10.2] - 2026-09-10

### Breaking changes

- None.

### Fixed

- iOS builds using static frameworks and source-built React Native now resolve
  Folly and React Native headers when compiling the Nitro Swift/C++ bridge.

## [0.10.1] - 2026-09-09

### Breaking changes

- None.

### Fixed

- Apply the Kotlin Android plugin only when the Gradle Kotlin extension is
  absent, so AGP 9 consumers that already ship built-in Kotlin can configure
  the library.

## [0.10.0] - 2026-08-25

### Breaking changes

- None when upgrading from `0.9.x`. Direct upgrades from `0.8.x` or earlier
  still require Nitro Modules `0.37.x` and a native rebuild as described in
  the `0.9.0` entry. This release restores the previous set-item type and
  secure-write defaults for existing consumers.

### Added

- Added `isStorageError(error, code)` to select recovery behavior from an exact
  stable storage error code on native and web.

### Changed

- Restored `SetStorageItem.get()` and its `item` property to the original
  `Record<string, true>` compatibility shape. Added `getTyped()` for new code
  that wants `Partial<Record<TMember, true>>` without forcing a type migration.
- Restored synchronous Android Secure writes by default. Asynchronous
  `apply()` writes remain available through the explicit
  `storage.setSecureWritesAsync(true)` opt-in and can be drained with
  `storage.flushSecureWrites()`.
- Enabled raw read-cache lookups now reuse cached missing values in single and
  batch reads without per-item fallback calls.

### Deprecated

- Deprecated `isKeychainLockedError()`. It remains backward compatible but
  groups `keychain_locked`, `authentication_required`, and `key_invalidated`;
  use `isStorageError()` when deciding whether to retry, authenticate, or
  rebuild a credential.

### Documentation

- Documented secure-storage recovery semantics and warned against cached
  fallback for authentication tokens unless stale credentials are an explicit
  application policy.
- Clarified isolated web benchmark limits and corrected capability/API examples.

## [0.9.0] - 2026-08-20

### Breaking changes

- `react-native-nitro-modules` now has a peer range of `>=0.37.0 <0.38.0`.
  Upgrade Nitro Modules and rebuild the native app before using Nitro Storage
  0.9.0; the previous 0.36.x range is not supported.
- `SetStorageItem.get()` now returns `Partial<Record<TMember, true>>`. Use
  `has()` for membership checks or handle an indexed value as `true | undefined`
  instead of assuming every member exists.
- Android Secure writes now default to asynchronous `apply()`. Call
  `storage.setSecureWritesAsync(false)` when existing code depends on
  synchronous `commit()` durability, or call `storage.flushSecureWrites()` at
  deterministic persistence boundaries.

### Changed

- Regenerated the shipped Nitro bindings with Nitro Modules and Nitrogen 0.37.0
  while preserving synchronous JSI storage behavior across native platforms.
- Native batch reads now preserve missing entries as `undefined`, matching the
  TypeScript contract and allowing stored values that match the old internal
  sentinel string.
- Secure write flushes now retain failed and unattempted last-write-wins entries
  for retry instead of silently dropping them.
- iOS legacy Disk migration is conservative and retryable. A valid registry is
  copied into the suite domain and each `standardUserDefaults` source is
  removed only after target persistence is verified; malformed registries,
  fallback or same-domain stores, conflicts, and failed persistence leave the
  source and registry available for recovery.

### Fixed

- `storage.clearBiometric()` flushes pending Secure writes, clears the JS raw
  cache before listener notification, uses a durable Android biometric clear,
  surfaces failures, and emits the same Secure-scope `clear` event as a Secure
  clear after success.
- Android biometric corruption is checked and recovered at preference-store
  initialization instead of probing the full encrypted store on each
  existence or deletion hot path.

## [0.8.0] - 2026-08-12

### Breaking changes

- None. `getMetricsSnapshot()` keeps its unscoped, cross-scope aggregate keys.
  Use the new `getScopedMetricsSnapshot()` when per-scope counters are needed.

### Added

- Exported `PlatformStorage` and `PlatformScope` types from the native, web,
  and testing entrypoints so shared consumer code can verify platform parity
  without duplicating the package contract.
- Added `getScopedMetricsSnapshot()` with keys such as `item:set:1`, without
  changing established dashboards that consume `getMetricsSnapshot()`.

### Fixed

- **Data-loss prevention:** `storage.import()` now flushes pending coalesced Disk and Secure writes before writing, so a later scheduled flush can never overwrite imported values.
- **Biometric parity:** promoting a value to biometric storage removes the plain secure copy on iOS and web, matching Android; plain reads can no longer return stale values after promotion.
- **iOS legacy disk data:** Disk enumeration, size, prefix queries, and clear now cover both the suite domain and legacy `standardUserDefaults` values, so deleted legacy values cannot reappear.
- **Failure-atomic migrations:** each migration step runs in its own transaction with its version marker; a failed step rolls back its data and marker, and rerunning `migrateToLatest()` retries from the last completed version.
- **Transaction events:** failed transactions emit exactly one typed `rollback` batch event with pre-rollback and restored raw values.
- **Atomic memory batch removes:** `removeBatch()` in Memory scope mutates all keys first and emits a single `removeBatch` event.
- **Stable error classification:** storage error codes now come only from `[nitro-error:<code>]` tags produced by the native and web adapters; message-text scraping was removed and every public code has a producer.
- **Encoding collisions:** reserved primitive tokens and the native batch missing sentinel are escaped in the stored encoding; legacy reads are preserved and raw API round-trips are unchanged.

### Changed

- `getCapabilities().writeBuffering` now reports real per-mode durability: native Secure writes report buffering only while `setSecureWritesAsync(true)` is active on Android, and web backends report buffering only for IndexedDB-based backends.
- The IndexedDB backend reports affected keys when `flush()` fails and starts a best-effort flush on `pagehide` and hidden visibility changes.
- `setIfVersion()` is documented as optimistic (no backend-level atomicity); CAS guarantees are covered by race tests.

## [0.7.0] - 2026-07-30

### Changes

- **Breaking change:** Android secure key discovery, existence checks, and cleanup now surface locked, unavailable, or invalidated biometric-store errors instead of treating inaccessible protected values as absent. Catch storage errors around these operations and use `isKeychainLockedError()` when retrying after device authentication is appropriate.
- Upgrade the validated package baseline to Expo SDK 57, React Native 0.86.2, and Nitro Modules/Nitrogen 0.36.4.
- Preserve each item/value relationship in heterogeneous `setBatch()` calls so TypeScript rejects values assigned to the wrong storage item.
- Serialize native key-index hydration with concurrent mutations so `has`, `size`, and key queries cannot remain stale after a racing write.
- Enforce Android biometric policy levels with distinct Keystore keys, propagate locked or invalidated biometric failures, and keep secure preference files excluded from backup.
- Preflight biometric store access before aggregate secure mutations and surface native commit or corruption-recovery failures.

## [0.6.0] - 2026-06-15

### Added

- Object-state ergonomics on `StorageItem<T>`: `item.merge(partial)` for shallow object updates, `item.reset()` to return to the default value, and `item.setOrDelete(value)` which deletes on `null`/`undefined` and sets otherwise.
- Scoped item factories `memoryItem`, `diskItem`, and `secureItem` so call sites no longer repeat `scope: StorageScope.X`.
- `createSetItem()` for set-membership state backed by storage, with `add`/`delete`/`has`/`toggle`/`values`/`size`/`clear`/`reset` and no-op-safe writes (no event/render churn when adding an existing member or deleting an absent one).
- Lifecycle helpers: `storage.clear(scope, { except })` to wipe a scope while preserving listed keys/items, per-item `group` config plus `storage.clearGroup(group)` and `storage.getGroupItems(group)` (which compose for "clear all except a group").
- Declarative legacy migration: `renameFrom` on items (and per-key on `createSecureAuthStorage`) copies a legacy key to the new key on first read and removes the legacy entry. `createSecureAuthStorage` also accepts `group` and `fallbackToCacheOnReadError`.
- Secure read resilience: `fallbackToCacheOnReadError` returns the last cached value when a secure read throws a locked-keychain error, plus an `onReadError` hook.
- Global expiration events: TTL expiry now emits a `"expire"` change event (memory and disk) routed through the event bus, with `storage.subscribeExpired(scope, listener)`.
- Hook ergonomics: `useStorage` now returns a third, render-stable `actions` element (`set`/`merge`/`reset`/`remove`/`setOrDelete`); new `useStorageValue` (read-only) and `useStorageActions` hooks.
- Dev introspection: `storage.findDuplicateKeys()` and `storage.getRegisteredKeys()` to audit accidental `(scope, key)` collisions at startup.
- New `react-native-nitro-storage/testing` entrypoint: a faithful in-memory implementation of the full public surface plus `createNitroStorageMock()` and `resetNitroStorageMock()` for Jest/Storybook without native modules.

### Changed

- Faster writes when nothing is subscribed: the native write/notify path now takes a lock-free fast path (per-scope atomic listener counts) and skips locking and copying the listener vector when a scope has no listeners. Applies to both iOS and Android via the shared C++ `HybridStorage`, and is thread-safe (verified under the C++ AddressSanitizer, ThreadSanitizer, and UndefinedBehaviorSanitizer suites).

### Breaking Changes

All new APIs are additive — existing code keeps working. These behavior and
type changes can affect advanced consumers:

- TTL expiry now emits a `"expire"` change event instead of `"remove"`. Previously, a disk/secure value expiring on read emitted `operation: "remove"` and an expiring memory value emitted no event at all. If you subscribe to storage events and branch on `operation === "remove"` to detect expiry, also handle `"expire"` (or use the new `storage.subscribeExpired()`).
- `StorageChangeOperation` gained the `"expire"` and `"clearGroup"` members. Exhaustive `switch` statements over a change event's `operation` need cases for the new members.
- `useStorage()` now returns a three-element tuple `[value, setter, actions]` (was two). Array destructuring such as `const [value, setStore] = useStorage(item)` is unaffected; only code that annotated the result with an explicit two-element tuple type needs to widen the annotation.

## [0.5.9] - 2026-06-11

### Fixed

- Added a package-owned Android manifest initializer so storage setup no longer requires generated `MainApplication` edits in Expo or bare React Native apps.
- Tied the Expo config plugin run-once metadata to the package version so updated package plugin behavior is reapplied correctly after package upgrades.

### Changed

- Included `CHANGELOG.md` in the packed package docs.

## [0.5.8] - 2026-06-11

### Changed

- Refactor native and web entrypoints to share the same storage core for item, batch, transaction, migration, metrics, import/export, and event behavior.
- Strengthen TypeScript checks with stricter compiler options so missing returns, switch fallthrough, and unchecked optional shapes are caught during package validation.

### Fixed

- Regenerate Nitrogen output and package build artifacts before pack-content audits so clean release and CI environments validate the actual published tarball.

## [0.5.7] - 2026-06-10

### Added

- Add C++ sanitizer release gates for AddressSanitizer, ThreadSanitizer, and UndefinedBehaviorSanitizer so native storage regressions can be isolated before publishing.
- Add C++ stress coverage for listener unsubscribe behavior, hydrated batch key indexes, and concurrent Memory scope access.

### Changed

- Speed up iOS Secure batch operations by reusing the resolved Keychain access group and access-control level across each batch instead of re-reading configuration per key.
- Refactor iOS Secure set/get/delete helpers so single-item and batch paths share Keychain status handling and cache updates.
- Strengthen TypeScript inference parity on web by exporting `StorageSetter` and preserving tuple value types from `getBatch()`.

### Fixed

- Keep native and web public TypeScript entrypoints aligned so IDEs infer storage setters and batch tuple results consistently across React Native and web imports.
- Keep the README, issue template, package metadata, and release notes aligned with the current `0.5.7` package surface.

## [0.5.6] - 2026-05-22

### Added

- Update the package baseline to Expo SDK 56, React Native 0.85.3, React 19.2.3, TypeScript 6.0.3, and Nitro Modules 0.35.7.
- Add secure export guardrails: `storage.export(StorageScope.Secure)` now requires an explicit `{ includeSecureValues: true }` opt-in, with `storage.exportSecureUnsafe()` available for short-lived secure migration flows.
- Add secure event observer redaction options so `storage.setEventObserver()` redacts Secure values by default and requires explicit opt-in for raw Secure event values.
- Add Expo plugin Android backup rules that exclude Nitro Storage secure preference files from cloud backup and device transfer.
- Add public web backend contract exports for `WebDiskStorageBackend` and `WebSecureStorageBackend` from the native and web entrypoints.

### Changed

- Close replaced web storage backends so IndexedDB-backed `BroadcastChannel` and database handles do not leak after backend swaps.
- Update README and package docs for the current secure export, event observer, Expo backup, web backend, and TypeScript usage surface.
- Preserve tuple value types in `getBatch()` so IDEs infer each returned value from its matching `StorageItem`.

### Fixed

- Avoid Metro private `metro-config/src/defaults/exclusionList` imports and exclude generated Android `.cxx` directories from Metro and Watchman scans.
- Remove package-owned Android native log spam for expected unavailable biometric storage paths.
- Modernize Android Gradle assignment syntax to avoid package-owned Gradle warnings.

## [0.5.4] - 2026-05-13

### Fixed

- Align web secure runtime validation with native for access-control and biometric levels.
- Preserve secure biometric and access-control item semantics during transaction rollback.
- Keep web raw batch writes from indexing keys whose values were not written.
- Reject fractional C++ secure access-control and biometric levels before casting them for native adapters.
- Publish GitHub Releases to npm through a Trusted Publishing/OIDC workflow.
- Resolve the package build's TypeScript binary lookup warning during release checks.

## [0.5.2] - 2026-04-27

### Fixed

- Make `createIndexedDBBackend().flush()` reject queued IndexedDB write failures after surfacing them through `onError`.
- Stabilize the release benchmark gate by sampling each benchmark three times while keeping the same regression thresholds.
- Correct package content check commands in the release documentation for current Bun.

## [0.5.1] - 2026-04-24

### Added

- Add `storage.export(scope)` for raw string snapshots that can be restored with `storage.import(data, scope)`.
- Add event subscriptions with `storage.subscribe`, `storage.subscribeKey`, `storage.subscribePrefix`, and `storage.subscribeNamespace`.
- Add `StorageItem#subscribeSelector()` for selector-based subscriptions with equality checks.
- Add `storage.setEventObserver()` for devtools and storage event logging integrations.
- Add enforced JS/TS and C++ coverage gates for the package release path.

### Changed

- Improve Memory namespace clear notification fan-out so subscribers under the cleared namespace are notified consistently.
- Improve web key-index fast paths when the active backend exposes indexed key operations.
- Emit batch change envelopes for raw import/export-adjacent workflows and batch writes/removes.
- Document raw import/export workflows and warn that Secure exports expose secret values.
- Refactor the publish script to validate release docs, report check timings, support coverage gates, and avoid redundant pack dry-runs.

## [0.5.0] - 2026-04-18

### Added

- Add secure-storage capability metadata with `storage.getSecurityCapabilities()`.
- Add metadata-only secure key inspection with `storage.getSecureMetadata(key)` and `storage.getAllSecureMetadata()`.
- Add public `SecurityCapabilities` and `SecureStorageMetadata` types.
- Add security policy and focused docs for secure storage, React hooks, and MMKV migration.

### Changed

- Refresh README positioning, badges, platform support, security model, storage-library comparison guidance, and benchmark guidance for npm/GitHub discoverability.
- Tighten README decisioning with an at-a-glance API map, Expo plugin options, bare Android setup, migration paths, and a release checklist.
- Split detailed usage material into focused docs for API reference, React hooks, secure storage, web backends, batch/transaction/migration workflows, recipes, MMKV migration, and benchmarks.
- Expand npm package description and keywords around React Native secure storage, biometric storage, Keychain, Android Keystore, Nitro Modules, MMKV migration, Expo SecureStore, Zustand/Jotai, and IndexedDB.
- Harden publish dry-runs, package docs syncing, and npm pack content validation.

## [0.4.5] - 2026-04-14

### Added

- Add configurable web Disk backend hooks: `setWebDiskStorageBackend()`, `getWebDiskStorageBackend()`, and `flushWebStorageBackends()`.
- Extend the web backend contract with optional batch, sizing, subscription, and flush hooks for higher-performance custom backends.
- Add IndexedDB backend support for `getMany`, `setMany`, `removeMany`, `size`, `flush`, and `BroadcastChannel`-based cross-tab sync.
- Expand regression coverage for web backend overrides, backend subscription-driven cache invalidation, backend flush hooks, IndexedDB broadcast sync, and IndexedDB error surfacing.
- Add Disk write buffering APIs: `coalesceDiskWrites`, `storage.setDiskWritesAsync()`, `storage.flushDiskWrites()`, and `storage.getCapabilities()`.
- Add structured storage error classification via `getStorageErrorCode()` while keeping `isKeychainLockedError()` as the convenience helper, and tag native bridge errors with stable `[nitro-error:<code>]` markers.

### Changed

- Upgrade to **Nitro Modules 0.35.4** and regenerate bindings against the latest stable Nitro 0.35 line.
- Migrate `nitro.json` to the current schema (`$schema`, `ignorePaths`, `gitAttributesGeneratedFlag`, and `autolinking.all.language = "c++"`).
- Raise the published `react-native-nitro-modules` requirement to `>= 0.35.4` so package metadata matches the tested Nitro baseline.
- Refresh root tooling to current patch releases for linting, testing, and workspace orchestration.
- Switch web operation timing to `performance.now()` when available for tighter metrics on fast paths.

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

## [0.4.1] - 2026-03-04

### Added

- Add `storage.import(data, scope)` to bulk-load a `Record<string, string>` of raw key/value pairs into any scope in one call. Memory imports are atomic (all keys visible simultaneously before any listener fires).
- Add `createIndexedDBBackend(dbName?, storeName?)` factory (exported from `react-native-nitro-storage/indexeddb-backend`) that wraps IndexedDB with a write-through in-memory cache, enabling persistent web Secure storage for large payloads without blocking the UI thread.

### Fixed

- Fix TTL expiry notification: subscribers registered via `item.subscribe()` are now correctly notified when a value expires on `item.get()` — both on cache-hit expiry and on envelope-parse expiry. Previously the notification was only emitted by the native event bus, which is not triggered in write-through or coalesced paths.
- Fix `setBatch` Memory atomicity: all values in a Memory-scope batch are now written to the store before any listener is notified, eliminating partial-batch observation windows. Items with `validate` or `expiration` config fall back to per-item sets to preserve those semantics.

### Changed

- Upgrade to **Nitro Modules 0.35.0** — regenerate nitrogen specs with the new `registerAllNatives()` JNI entry point, fixing the Kotlin `HybridObject` `jni::global_ref` memory leak (Nitro #1238).
- Update `cpp-adapter.cpp` to use `registerAllNatives()` instead of the deprecated `initialize(vm)` shim.
- Bump to **React 19.2.0** and **React Native 0.83.2** across workspace and example.
- Add `--provenance` flag to `npm publish` for npm supply-chain attestation.

## [0.4.0] - 2026-02-25

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

## [0.3.2] - 2026-02-22

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
- Expand README coverage so every public feature has a concrete TypeScript use-case example, including secure write flush, biometric/access-control usage, batch bootstrap, and storage utility workflows.

## [0.3.1] - 2026-02-16

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

## [0.3.0] - 2026-02-15

### Added

- Add `useStorageSelector(item, selector, isEqual?)` to reduce rerenders from unrelated object updates.
- Add opt-in `coalesceSecureWrites` and per-item `readCache` controls in `createStorageItem` config.

### Changed

- Switch default serialization to a primitive fast path for primitives while preserving JSON compatibility for objects and legacy values.
- Replace broad listener fan-out with key-indexed registries and automatic pruning for memory/native/web paths.

### Fixed

- Route native batch calls through true adapter-level batch APIs (HybridStorage + iOS/Android adapters) instead of per-key loops.
- Add read-through cache invalidation on scoped/key change events and native/web clear paths.

## [0.2.1] - 2026-02-15

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

## [0.2.0] - 2026-02-15

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
- Expand README with complete API behavior/throws documentation.
- Strengthen native and web test coverage for validation, TTL, migrations, and transactions.

## [0.1.4] - 2026-02-09

### Added

- Add `clearAll` event.

### Fixed

- Fix Android behavior.

### Changed

- Bump react-native-nitro-modules to the latest version and raise the peer dependency floor.

## [0.1.3] - 2026-01-22

### Fixed

- Prevent ProGuard from stripping the JNI class in release builds.

## [0.1.2] - 2026-01-07

### Added

- Finalize batch operations and clean up the implementation.
- Add missing batch coverage and exclude web from the coverage report.

### Changed

- Point types to the correct path and simplify bob targets.

## [0.1.1] - 2025-12-15

### Added

- MMKV migration utility.
- Benchmark UI improvements.

### Changed

- Update native build configs.
- Update README screenshots.
- Add tests for memory item deletion and MMKV migration, and simplify the README.

## [0.1.0] - 2025-12-15

### Added

- Initial public release from the private repository.
