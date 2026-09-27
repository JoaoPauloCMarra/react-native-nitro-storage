# react-native-nitro-storage — Codebase Audit

> Audited by 4 parallel Opus 4.6 agents: Android, iOS, C++, JS/TS
> Branch: `fix/keychain-locked-migration-crash` · v0.4.2
> Date: 2026-03-05

---

## Fixed (this session)

| # | Layer | Severity | Issue | Fix |
|---|-------|----------|-------|-----|
| H-1 | Android | HIGH | `clearCorruptedStorage` deletes master key alias then retries with stale `MasterKey` object | Rebuild fresh `MasterKey` after deleting the old alias |
| H-2 | Android | HIGH | `getAllKeysSecure` leaks `EncryptedSharedPreferences` internal metadata keys (`__androidx_security_crypto_*`) | Filter internal keys in `getSecureKeysCached()` |
| H-3 | C++ | HIGH | Tests call `shared_from_this()` on stack-allocated `HybridStorage` — UB | Changed to `std::make_shared<HybridStorage>` in affected tests |
| H-4 | C++ | HIGH | `toScope()` / `setSecureAccessControl` / `setSecureBiometricWithLevel` don't reject NaN — `static_cast<int>(NaN)` is UB | Added `std::isnan`/`std::isinf` guards before all int casts |
| H-5 | Web | HIGH | Web `storage` object missing `getString`, `setString`, `deleteString` | Added methods to web storage object |
| H-6 | Web | HIGH | Web missing `isKeychainLockedError` export | Added stub that always returns `false` |
| M-1 | Android | MEDIUM | `setSecure` and `deleteSecure` not synchronized — race with cache invalidation | Wrapped both in `synchronized(inst)` |
| M-2 | iOS | MEDIUM | `hasDisk` doesn't check legacy `standardUserDefaults` (inconsistent with `getDisk` migration) | Added legacy fallback check in `hasDisk` |
| M-3 | iOS | MEDIUM | `setSecureBiometricWithLevel(level=0)` doesn't clean up old biometric entry or cache | Delete biometric keychain entry + `markBiometricKeyRemoved` before `setSecure` |
| M-7 | Web | MEDIUM | Coalesced secure writes hardcode `AccessControl.WhenUnlocked` instead of `secureDefaultAccessControl` | Changed all 3 occurrences to use `secureDefaultAccessControl` |
| M-8 | Web | MEDIUM | `storage.import` doesn't update `cacheRawValue` for non-memory scopes | Added `cacheRawValue` call after web `setBatch` |
| M-9 | Android | MEDIUM | Dead `isNewArchitectureEnabled()` code in `build.gradle` | Removed function + all conditional blocks |
| L-1 | Android | LOW | Unused `JContext` struct | Removed |
| L-2 | Android | LOW | Dead constructor null check in `AndroidStorageAdapterCpp` | Simplified to empty body |
| L-3 | C++ | LOW | Redundant `reserve` before copy-assign in `copyListenersForScope` | Removed `reserve` line |
| L-5 | C++ | LOW | `#include <map>` unused outside test macro | Moved inside `#ifdef` |
| L-6 | iOS | LOW | Unused `#include <algorithm>` | Removed |
| L-7 | iOS | LOW | Duplicate `#include <unordered_set>` | Removed duplicate |
| L-8 | iOS | LOW | `std::atomic<bool>` where plain `bool` suffices | Changed to `bool` |
| L-9 | JS/TS | LOW | `Object.keys(data).length` computed twice in `storage.import` | Use `keys.length` |

## Not fixed (accepted risks / design limitations)

| # | Layer | Severity | Issue | Reason |
|---|-------|----------|-------|--------|
| M-4 | iOS | MEDIUM | `clearDisk` doesn't clear un-migrated legacy keys from `standardUserDefaults` | Can't distinguish NitroStorage legacy keys from other `standardUserDefaults` entries. Inherent to lazy migration. |
| M-5 | C++ | MEDIUM | `set()` + `clear()` interleaving can leave phantom keys in index | Requires specific cross-thread timing. Conservative fix (generation counter) adds complexity for an edge case. |
| M-6 | C++ | MEDIUM | 7 pure virtual methods in `NativeStorageAdapter` never called | Removing them risks breaking external consumers. May be useful for future direct-query path. |
| L-4 | C++ | LOW | Unreachable `return` statements after exhaustive switches | Suppress compiler warnings. Intentional. |
| L-10 | JS/TS | LOW | `migrateFromMMKV` uses unsafe `as T` casts | Migration is best-effort by design. |

## Test gaps (not addressed)

| Gap | File | Description |
|-----|------|-------------|
| TG-1 | `src/index.ts:1535-1546` | `isKeychainLockedError` — 6 error patterns, no test coverage |
| TG-2 | `src/index.web.ts:345-362` | `handleWebStorageEvent` biometric key path untested |
| TG-3 | `src/index.ts:838, 988, 1030` | `onExpired` callback — 3 invocation paths, never asserted |
| TG-4 | `src/internal.ts:168-184` | `toVersionToken` FNV-1a hash — no direct test |
| TG-5 | `src/index.ts:624-638` | `storage.getString/setString/deleteString` — no dedicated tests |

## New findings — 2026-09-26

Audited at `0a8544d`. Read all 142 in-scope source, test, example, tooling, and guidance/configuration files in full; excluded dependencies, vendored/generated code, lockfiles, and build output. Existing fixed items, accepted risks, and test gaps above were excluded. The priorities below use this audit's definitions: P0 means broken behavior today, P1 misleading behavior, P2 inconsistency/change cost, and P3 duplication/dead code/polish. Verification used isolated Bun probes and a host C++ probe against the current SQLite implementation. Device and release gates were not run for this tracker-only audit.

Tick an item when it lands, and note the commit next to it.

| # | Layer | Severity | Issue | Fix |
|---|-------|----------|-------|-----|
| 11 | JS/TS | P0 | [ ] **Memory prefix reads expose the internal escape format.** `packages/react-native-nitro-storage/src/storage-core.ts:1317` places cached strings directly in the result, unlike the disk path at line 1337 and `getAll` at line 1351. After `setString` stores a literal beginning with `__nitro_storage_primitive__:`, `getString` and `getAll` return the original string but `getByPrefix` returns its escaped representation. | **Extract Function** for decoding raw entries and use it in each raw enumeration path, including memory prefix reads; cover a string that starts with the reserved prefix. |
| 12 | JS/TS | P0 | [ ] **The valid key `__proto__` disappears from object-backed results and sets.** `getByPrefix` and `getAll` create ordinary objects and assign user keys at `packages/react-native-nitro-storage/src/storage-core.ts:1311` and line 1346. `createSetItem` repeats this for default members at line 3746, additions at line 3765, and typed reads at line 3789. Probes can read the raw key individually but lose it from enumeration/export; a set default or `add("__proto__")` still reports no member. | **Substitute Algorithm** with safe own-data-property construction for arbitrary keys in all named builders, preserving serialization and the public return shape; test raw enumeration/export and both set insertion paths. |
| 13 | Android / iOS / C++ | P0 | [ ] **Disk prefix matching ignores ASCII case and can clear another namespace.** `packages/react-native-nitro-storage/android/src/main/java/com/nitrostorage/DiskSqliteStore.kt:103` and `packages/react-native-nitro-storage/cpp/core/SqliteDiskStore.cpp:127` use SQLite `LIKE`, whose default comparison folds ASCII case. A host probe stores `User::token` and `user::token`; querying `user::` returns both. The iOS union at `packages/react-native-nitro-storage/ios/IOSStorageAdapterCpp.mm:391` keeps those SQL matches, and `packages/react-native-nitro-storage/cpp/bindings/HybridStorage.cpp:417` deletes the returned keys in `removeByPrefix`, reached by `clearNamespace`. | **Substitute Algorithm** with literal, case-sensitive prefix matching in both SQLite implementations; cover differently cased namespaces in reads and deletion, including the iOS legacy-key union. |

### P3: Dead code

| # | Layer | Severity | Issue | Fix |
|---|-------|----------|-------|-----|
| 14 | Example types | P3 | [ ] **The Storage example retains an unrelated MathJax declaration.** `apps/example/types/react-native-mathjax-svg.d.ts:1` declares a package absent from the manifests and every source, test, example, and documentation reference. A repository-wide search outside dependencies/build output finds only this declaration; it is not a package export or runtime registration. | **Remove Dead Code** by deleting the 13-line ambient declaration, which can mask an accidental unresolved import. |

## Implementation receipt — 2026-09-27

Findings 11–14 are implemented locally, not committed. Checkboxes above remain open until final acceptance. Focused C++ prefix/deletion tests and 439 scoped Jest tests passed; example lint/typecheck passed. Controller restored escaped LIKE candidate narrowing with full-prefix exact filtering, including embedded NUL, and reran the C++ suite successfully. Android runtime, final sanitizers, browser verification, package preflight, and performance measurements remain pending. Historical entries above are unchanged.

### Final local package gates

`bun run release:preflight` passed on the final Memory iteration candidate, including ASan/TSan/UBSan, emitted declarations, package audit and publish dry run. Final example integrity contains 15 passing Chromium cases, with no page errors. The host-only enumeration experiment and its RSS limitation are recorded in docs/benchmarks.md. Required Android/iOS runtime integrity checks remain open pending target selection; earlier local Android/iOS builds passed. No landing commit or publication exists.

Final retained-source release:preflight PASS; refreshed Chromium integrity 15 PASS, zero failures/skips/page errors. Direct prefix-scan experiment reverted after a small-workload regression. Native runtime/performance acceptance remains pending; no landing/publication claimed.
