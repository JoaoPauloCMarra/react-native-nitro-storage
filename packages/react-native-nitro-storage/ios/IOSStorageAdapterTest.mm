#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>

#include "SqliteDiskStore.hpp"

#include <sqlite3.h>

#include <algorithm>
#include <cassert>
#include <fstream>
#include <functional>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

using NitroStorage::IOSStorageAdapterCpp;

namespace NitroStorage {
void runLegacyDiskMigrationCutoverForTesting(NSUserDefaults* defaults);
void resetSqliteDiskStoreForTesting();
void resetSharedSqliteDiskStoreForTesting();
bool sqliteDiskStoreHasKeyForTesting(const std::string& key);
std::string diskStorePathForTesting();
}

namespace {

const char* kHostKey = "nitro-storage-ut-host-owned";
const char* kLegacyKey = "nitro-storage-ut-legacy";
const char* kLegacyGetKey = "nitro-storage-ut-legacy-get";
const char* kLegacyHasKey = "nitro-storage-ut-legacy-has";
const char* kSuiteKey = "nitro-storage-ut-suite";
const char* kConflictKey = "nitro-storage-ut-conflict";
const char* kSuiteImportedKey = "nitro-storage-ut-suite-imported";
const char* kSuiteLateKey = "nitro-storage-ut-suite-late";
const char* kProbeKey = "nitro-storage-ut-probe";

bool containsKey(const std::vector<std::string>& keys, const std::string& needle) {
    return std::find(keys.begin(), keys.end(), needle) != keys.end();
}

NSString* nsKey(const char* key) {
    return [NSString stringWithUTF8String:key];
}

void cleanupState() {
    NitroStorage::resetSqliteDiskStoreForTesting();
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    [standard removeObjectForKey:nsKey(kHostKey)];
    [standard removeObjectForKey:nsKey(kLegacyKey)];
    [standard removeObjectForKey:nsKey(kLegacyGetKey)];
    [standard removeObjectForKey:nsKey(kLegacyHasKey)];
    [standard removeObjectForKey:nsKey(kSuiteKey)];
    [standard removeObjectForKey:nsKey(kConflictKey)];
    [standard removeObjectForKey:nsKey(kSuiteImportedKey)];
    [standard removeObjectForKey:nsKey(kSuiteLateKey)];
    [standard removeObjectForKey:@"__nitro_storage_legacy_disk_keys__"];
    [standard removeObjectForKey:@"__nitro_storage_legacy_disk_migration_v1__"];
    [standard removePersistentDomainForName:@"com.nitrostorage.disk"];
    [standard synchronize];
}

void runFirstDiskOperation(IOSStorageAdapterCpp& adapter) {
    assert(!adapter.hasDisk(kProbeKey));
}

std::string failureMessage(const std::function<void()>& operation) {
    try {
        operation();
    } catch (const std::exception& error) {
        return error.what();
    }
    return "";
}

bool startsWith(const std::string& value, const std::string& prefix) {
    return value.compare(0, prefix.size(), prefix) == 0;
}

std::vector<std::function<void()>> diskOperations(IOSStorageAdapterCpp& adapter) {
    return {
        [&] { adapter.setDisk("k", "v"); },
        [&] { (void)adapter.getDisk("k"); },
        [&] { adapter.deleteDisk("k"); },
        [&] { (void)adapter.hasDisk("k"); },
        [&] { (void)adapter.getAllKeysDisk(); },
        [&] { (void)adapter.getKeysByPrefixDisk("k"); },
        [&] { (void)adapter.sizeDisk(); },
        [&] { adapter.setDiskBatch({"k"}, {"v"}); },
        [&] { (void)adapter.getDiskBatch({"k"}); },
        [&] { adapter.deleteDiskBatch({"k"}); },
    };
}

std::string fileContents(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
}

void testCorruptDiskIsReportedOnEveryCallAndRecoveredOnlyByClear() {
    cleanupState();
    const std::string tag = "[nitro-error:storage_corruption] NitroStorage: Disk SQLite ";
    const std::string diskPath = NitroStorage::diskStorePathForTesting();
    const std::string garbage(8192, 'x');
    for (const char* suffix : {"", "-wal", "-shm"}) {
        std::ofstream corrupt(diskPath + suffix, std::ios::binary | std::ios::trunc);
        corrupt << garbage;
    }
    NSUserDefaults* suite = [[NSUserDefaults alloc] initWithSuiteName:@"com.nitrostorage.disk"];
    [suite setObject:@"imported" forKey:nsKey(kSuiteImportedKey)];

    IOSStorageAdapterCpp adapter;
    for (int round = 0; round < 2; ++round) {
        for (const auto& operation : diskOperations(adapter)) {
            assert(startsWith(failureMessage(operation), tag));
        }
    }
    assert(fileContents(diskPath) == garbage);

    adapter.clearDisk();
    assert(adapter.sizeDisk() == 0);
    assert(!adapter.getDisk(kSuiteImportedKey).has_value());
    assert([suite objectForKey:nsKey(kSuiteImportedKey)] == nil);
    adapter.setDisk("k", "v");
    assert(adapter.getDisk("k").value() == "v");
    NitroStorage::resetSharedSqliteDiskStoreForTesting();
    IOSStorageAdapterCpp nextLaunch;
    assert(nextLaunch.getDisk("k").value() == "v");
    assert(nextLaunch.sizeDisk() == 1);

    nextLaunch.setDiskBatch({"a", "b", "c"}, {"1", "2", "3"});
    NitroStorage::resetSharedSqliteDiskStoreForTesting();
    {
        const std::string contents = fileContents(diskPath);
        assert(contents.size() >= 3 * 4096);
        std::fstream file(diskPath, std::ios::binary | std::ios::in | std::ios::out);
        file.seekp(4096);
        file << std::string(contents.size() - 4096, 'x');
    }
    IOSStorageAdapterCpp corruptedLater;
    assert(startsWith(failureMessage([&] { (void)corruptedLater.getDisk("a"); }), tag));
    assert(startsWith(failureMessage([&] { corruptedLater.setDisk("a", "x"); }), tag));
    corruptedLater.clearDisk();
    assert(corruptedLater.sizeDisk() == 0);
    corruptedLater.setDisk("after", "ok");
    assert(corruptedLater.getDisk("after").value() == "ok");
    corruptedLater.clearDisk();
    assert(corruptedLater.sizeDisk() == 0);
}

void testClearOnAFullDatabaseRecreatesItAndFreesSpace() {
    cleanupState();
    const std::string diskPath = NitroStorage::diskStorePathForTesting();
    NSUserDefaults* suite = [[NSUserDefaults alloc] initWithSuiteName:@"com.nitrostorage.disk"];
    {
        IOSStorageAdapterCpp writer;
        std::vector<std::string> keys;
        for (int index = 0; index < 200; ++index) {
            keys.push_back("bulk-" + std::to_string(index));
        }
        writer.setDiskBatch(keys, std::vector<std::string>(keys.size(), std::string(4000, 'b')));
    }
    NitroStorage::resetSharedSqliteDiskStoreForTesting();
    sqlite3* raw = nullptr;
    assert(sqlite3_open_v2(diskPath.c_str(), &raw, SQLITE_OPEN_READWRITE, nullptr) == SQLITE_OK);
    assert(sqlite3_exec(
        raw,
        "CREATE TRIGGER grow_on_delete BEFORE DELETE ON kv BEGIN "
        "INSERT OR REPLACE INTO kv(key, value) VALUES('grow', hex(zeroblob(1048576))); END;",
        nullptr, nullptr, nullptr
    ) == SQLITE_OK);
    sqlite3_close(raw);
    const size_t sizeBefore = fileContents(diskPath).size();
    assert(sizeBefore > 500000);

    IOSStorageAdapterCpp adapter;
    assert(adapter.sizeDisk() == 200);
    [suite setObject:@"late" forKey:nsKey(kSuiteLateKey)];
    auto& store = NitroStorage::SqliteDiskStore::shared(diskPath);
    store.limitPageCountForTesting(1);
    assert(startsWith(
        failureMessage([&] { store.clear(); }),
        "[nitro-error:storage_full] NitroStorage: Disk SQLite clear failed: "
    ));
    assert(adapter.sizeDisk() == 201);

    adapter.clearDisk();

    assert(adapter.sizeDisk() == 0);
    assert([suite objectForKey:nsKey(kSuiteLateKey)] == nil);
    adapter.setDisk("after", std::string(8192, 'a'));
    assert(adapter.getDisk("after").value().size() == 8192);
    NitroStorage::resetSharedSqliteDiskStoreForTesting();
    assert(fileContents(diskPath).size() < sizeBefore / 4);
    IOSStorageAdapterCpp nextLaunch;
    assert(nextLaunch.sizeDisk() == 1);
}

void testInvalidUtf8KeysAreRejectedBeforeTheDatabaseIsTouched() {
    cleanupState();
    IOSStorageAdapterCpp adapter;
    const std::string invalid("bad-\xff\xfe", 6);
    const std::string expected = "NitroStorage: String is not valid UTF-8";
    auto& store = NitroStorage::SqliteDiskStore::shared(NitroStorage::diskStorePathForTesting());

    assert(failureMessage([&] { adapter.setDisk(invalid, "v"); }) == expected);
    assert(!store.has(invalid));
    assert(failureMessage([&] { adapter.setDiskBatch({"valid", invalid}, {"1", "2"}); }) == expected);
    assert(!store.has("valid") && !store.has(invalid));

    store.set(invalid, "stored-directly");
    adapter.setDisk("valid", "1");
    assert(failureMessage([&] { adapter.deleteDisk(invalid); }) == expected);
    assert(store.has(invalid));
    assert(failureMessage([&] { adapter.deleteDiskBatch({"valid", invalid}); }) == expected);
    assert(store.has("valid") && store.has(invalid));
    adapter.setDisk("valid-key", invalid);
    assert(adapter.getDisk("valid-key").value() == invalid);
    store.remove(invalid);
}

std::vector<std::string> sorted(std::vector<std::string> values) {
    std::sort(values.begin(), values.end());
    return values;
}

void assertSizeAndPrefixQueriesMatchFullEnumeration(IOSStorageAdapterCpp& adapter) {
    const auto all = adapter.getAllKeysDisk();
    assert(adapter.sizeDisk() == all.size());
    std::vector<std::string> prefixes = {
        "", "n", "nitro", "nitro-storage-ut-", "nitro-storage-ut-suite", "sqlite", "sqlite:", "SQLITE", "%", "_",
        "\\", "missing", "caf\xc3\xa9", "\xf0", "\xff", "\xc3", std::string("nul\0", 4), std::string("\0", 1),
    };
    for (const auto& key : all) {
        prefixes.push_back(key);
        prefixes.push_back(key.substr(0, key.size() / 2));
    }
    for (const auto& prefix : prefixes) {
        std::vector<std::string> expected;
        for (const auto& key : all) {
            if (key.rfind(prefix, 0) == 0) {
                expected.push_back(key);
            }
        }
        assert(sorted(adapter.getKeysByPrefixDisk(prefix)) == sorted(expected));
    }
}

void testSizeAndPrefixQueriesMatchFullEnumerationInEveryLegacyState() {
    cleanupState();
    NSUserDefaults* suite = [[NSUserDefaults alloc] initWithSuiteName:@"com.nitrostorage.disk"];
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    IOSStorageAdapterCpp adapter;
    assertSizeAndPrefixQueriesMatchFullEnumeration(adapter);

    const std::string nulKey("nul\0key", 7);
    adapter.setDiskBatch(
        {"sqlite:a", "sqlite:b", "SQLITE:a", "sqlite%", "sqlite_", "caf\xc3\xa9:1", nulKey, "", "\xf0\x9f\x98\x80"},
        {"1", "2", "3", "4", "5", "6", "7", "8", "9"}
    );
    assertSizeAndPrefixQueriesMatchFullEnumeration(adapter);

    [suite setObject:@"late" forKey:nsKey(kSuiteLateKey)];
    [suite setObject:@"duplicate" forKey:@"sqlite:a"];
    [suite setObject:@123 forKey:@"nitro-storage-ut-suite-number"];
    assertSizeAndPrefixQueriesMatchFullEnumeration(adapter);

    [standard setObject:@"legacy" forKey:nsKey(kLegacyHasKey)];
    assert(adapter.hasDisk(kLegacyHasKey));
    [standard setObject:@"shadowed" forKey:@"sqlite:b"];
    assert(adapter.hasDisk("sqlite:b"));
    [standard setObject:@"host" forKey:nsKey(kHostKey)];
    assertSizeAndPrefixQueriesMatchFullEnumeration(adapter);

    adapter.deleteDisk("sqlite:a");
    adapter.setDisk(kSuiteLateKey, "now-in-sqlite");
    assertSizeAndPrefixQueriesMatchFullEnumeration(adapter);

    adapter.clearDisk();
    assert(adapter.sizeDisk() == 0);
    assertSizeAndPrefixQueriesMatchFullEnumeration(adapter);
    [standard removeObjectForKey:@"sqlite:b"];
}

void testFullDiskErrorsKeepTheirTagAndLegacyReadsStillWork() {
    cleanupState();
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    const std::string tag = "[nitro-error:storage_full] NitroStorage: Disk SQLite ";
    const std::string oversized(1 << 20, 'x');
    IOSStorageAdapterCpp adapter;
    adapter.setDisk("kept", "value");
    NitroStorage::SqliteDiskStore::shared(NitroStorage::diskStorePathForTesting())
        .limitPageCountForTesting(1);

    [standard setObject:@"legacy-value" forKey:nsKey(kLegacyKey)];
    assert(startsWith(failureMessage([&] { adapter.setDisk(kLegacyKey, oversized); }), tag));
    assert([[standard stringForKey:nsKey(kLegacyKey)] isEqualToString:@"legacy-value"]);
    assert(startsWith(
        failureMessage([&] { adapter.setDiskBatch({"batch", kLegacyKey}, {"1", oversized}); }),
        tag
    ));
    assert(!NitroStorage::sqliteDiskStoreHasKeyForTesting("batch"));
    assert([[standard stringForKey:nsKey(kLegacyKey)] isEqualToString:@"legacy-value"]);

    NSString* legacyLarge = [@"" stringByPaddingToLength:(1 << 20) withString:@"y" startingAtIndex:0];
    [standard setObject:legacyLarge forKey:nsKey(kLegacyGetKey)];
    std::optional<std::string> legacyRead;
    assert(failureMessage([&] { legacyRead = adapter.getDisk(kLegacyGetKey); }).empty());
    assert(legacyRead.value() == std::string(1 << 20, 'y'));
    assert(adapter.getDiskBatch({kLegacyGetKey})[0].value() == std::string(1 << 20, 'y'));

    assert(adapter.getDisk("kept").value() == "value");
    assert(adapter.hasDisk("kept"));
    assert(containsKey(adapter.getAllKeysDisk(), "kept"));
    adapter.deleteDisk("kept");
    assert(!adapter.hasDisk("kept"));
    adapter.clearDisk();
    assert(adapter.sizeDisk() == 0);
}

} // namespace

// Verifies the disk-scoping contract: enumeration and clear must only ever
// touch keys owned by Nitro Storage (the suite domain or legacy keys observed
// through the storage API), never arbitrary host-app standard defaults keys.
int main() {
    @autoreleasepool {
        cleanupState();

        NSUserDefaults* suite = [[NSUserDefaults alloc] initWithSuiteName:@"com.nitrostorage.disk"];

        // A corrupt Disk database must not fail adapter construction. Disk
        // operations surface the error and retry the lazy migration later.
        {
            const std::string diskPath = NitroStorage::diskStorePathForTesting();
            {
                std::ofstream corrupt(diskPath, std::ios::binary | std::ios::trunc);
                corrupt << std::string(8192, 'x');
            }
            [suite setObject:@"imported" forKey:nsKey(kSuiteImportedKey)];
            IOSStorageAdapterCpp corruptDisk;
            bool diskThrew = false;
            try {
                (void)corruptDisk.getDisk(kSuiteImportedKey);
            } catch (const std::exception&) {
                diskThrew = true;
            }
            assert(diskThrew);
            NitroStorage::resetSqliteDiskStoreForTesting();
            assert(corruptDisk.getDisk(kSuiteImportedKey).value() == "imported");
            assert(NitroStorage::sqliteDiskStoreHasKeyForTesting(kSuiteImportedKey));
        }

        cleanupState();

        // A fallback or same-domain target is a recovery barrier. Exercise
        // the guard with the standard defaults object itself: source,
        // registry, and marker must remain untouched.
        [[NSUserDefaults standardUserDefaults]
            setObject:@"legacy-value" forKey:nsKey(kLegacyKey)];
        [[NSUserDefaults standardUserDefaults]
            setObject:@[nsKey(kLegacyKey)] forKey:@"__nitro_storage_legacy_disk_keys__"];
        NitroStorage::runLegacyDiskMigrationCutoverForTesting(
            [NSUserDefaults standardUserDefaults]
        );
        assert([[[NSUserDefaults standardUserDefaults] stringForKey:nsKey(kLegacyKey)] isEqualToString:@"legacy-value"]);
        assert([[NSUserDefaults standardUserDefaults] objectForKey:@"__nitro_storage_legacy_disk_keys__"] != nil);
        assert(![[NSUserDefaults standardUserDefaults] boolForKey:@"__nitro_storage_legacy_disk_migration_v1__"]);

        cleanupState();

        // A malformed registry is a recovery barrier: neither the source nor
        // the registry is changed, and no completion marker is written.
        [[NSUserDefaults standardUserDefaults]
            setObject:@"legacy-value" forKey:nsKey(kLegacyKey)];
        [suite setObject:@"not-an-array" forKey:@"__nitro_storage_legacy_disk_keys__"];
        IOSStorageAdapterCpp malformed;
        runFirstDiskOperation(malformed);
        assert([[[NSUserDefaults standardUserDefaults] stringForKey:nsKey(kLegacyKey)] isEqualToString:@"legacy-value"]);
        assert([[suite objectForKey:@"__nitro_storage_legacy_disk_keys__"] isEqualToString:@"not-an-array"]);
        assert(![suite boolForKey:@"__nitro_storage_legacy_disk_migration_v1__"]);

        cleanupState();

        // A target value already present in the suite domain is accepted only
        // when it matches the source. A conflict preserves the source and
        // registry so a later retry can resolve it.
        [[NSUserDefaults standardUserDefaults]
            setObject:@"legacy-value" forKey:nsKey(kConflictKey)];
        [suite setObject:@[nsKey(kConflictKey)] forKey:@"__nitro_storage_legacy_disk_keys__"];
        [suite setObject:@"suite-value" forKey:nsKey(kConflictKey)];
        IOSStorageAdapterCpp conflict;
        runFirstDiskOperation(conflict);
        assert([[[NSUserDefaults standardUserDefaults] stringForKey:nsKey(kConflictKey)] isEqualToString:@"legacy-value"]);
        assert([[[suite stringForKey:nsKey(kConflictKey)] description] isEqualToString:@"suite-value"]);
        assert([suite objectForKey:@"__nitro_storage_legacy_disk_keys__"] != nil);
        assert(![suite boolForKey:@"__nitro_storage_legacy_disk_migration_v1__"]);

        cleanupState();

        // A failed copy (non-string legacy data) remains retryable. Replacing
        // it with a valid value allows a later adapter initialization to
        // complete the migration without losing the source.
        [[NSUserDefaults standardUserDefaults]
            setObject:@123 forKey:nsKey(kLegacyKey)];
        [suite setObject:@[nsKey(kLegacyKey)] forKey:@"__nitro_storage_legacy_disk_keys__"];
        IOSStorageAdapterCpp failedCopy;
        runFirstDiskOperation(failedCopy);
        assert([[NSUserDefaults standardUserDefaults] objectForKey:nsKey(kLegacyKey)] != nil);
        assert([suite objectForKey:@"__nitro_storage_legacy_disk_keys__"] != nil);
        assert(![suite boolForKey:@"__nitro_storage_legacy_disk_migration_v1__"]);

        [[NSUserDefaults standardUserDefaults]
            setObject:@"legacy-value" forKey:nsKey(kLegacyKey)];
        IOSStorageAdapterCpp retried;
        assert(retried.getDisk(kLegacyKey).value() == "legacy-value");
        assert([[NSUserDefaults standardUserDefaults] objectForKey:nsKey(kLegacyKey)] == nil);
        assert([suite objectForKey:@"__nitro_storage_legacy_disk_keys__"] == nil);
        assert([suite boolForKey:@"__nitro_storage_legacy_disk_migration_v1__"]);

        cleanupState();

        // The suite import into SQLite runs once. A later adapter
        // initialization does not re-read or re-import the suite domain.
        [suite setObject:@"imported" forKey:nsKey(kSuiteImportedKey)];
        {
            IOSStorageAdapterCpp firstLaunch;
            assert(!NitroStorage::sqliteDiskStoreHasKeyForTesting(kSuiteImportedKey));
            runFirstDiskOperation(firstLaunch);
            assert(NitroStorage::sqliteDiskStoreHasKeyForTesting(kSuiteImportedKey));
        }
        [suite setObject:@"late" forKey:nsKey(kSuiteLateKey)];
        NitroStorage::resetSharedSqliteDiskStoreForTesting();
        {
            IOSStorageAdapterCpp secondLaunch;
            runFirstDiskOperation(secondLaunch);
            assert(!NitroStorage::sqliteDiskStoreHasKeyForTesting(kSuiteLateKey));
            assert(NitroStorage::sqliteDiskStoreHasKeyForTesting(kSuiteImportedKey));
            assert([[suite stringForKey:nsKey(kSuiteImportedKey)] isEqualToString:@"imported"]);
            assert(secondLaunch.getDisk(kSuiteLateKey).value() == "late");
        }

        cleanupState();
        IOSStorageAdapterCpp adapter;

        [[NSUserDefaults standardUserDefaults]
            setObject:@"host-value" forKey:nsKey(kHostKey)];

        // 1. Host-app keys are never enumerated.
        const auto keysBefore = adapter.getAllKeysDisk();
        assert(!containsKey(keysBefore, kHostKey));
        assert(!containsKey(adapter.getKeysByPrefixDisk("nitro-storage-ut-"), kHostKey));

        // 2. Host-app keys are never deleted by clearDisk.
        adapter.clearDisk();
        assert([[[NSUserDefaults standardUserDefaults] stringForKey:nsKey(kHostKey)] isEqualToString:@"host-value"]);

        // 3. Legacy values remain readable through the storage API even when
        //    they were not included in the one-time migration registry.
        [[NSUserDefaults standardUserDefaults]
            setObject:@"legacy-get-value" forKey:nsKey(kLegacyGetKey)];
        assert(!containsKey(adapter.getAllKeysDisk(), kLegacyGetKey));
        assert(adapter.getDisk(kLegacyGetKey).value() == "legacy-get-value");
        assert([suite stringForKey:nsKey(kLegacyGetKey)] != nil);
        assert([[NSUserDefaults standardUserDefaults] objectForKey:nsKey(kLegacyGetKey)] == nil);

        [[NSUserDefaults standardUserDefaults]
            setObject:@"legacy-has-value" forKey:nsKey(kLegacyHasKey)];
        assert(!containsKey(adapter.getAllKeysDisk(), kLegacyHasKey));
        assert(adapter.hasDisk(kLegacyHasKey));
        assert(containsKey(adapter.getAllKeysDisk(), kLegacyHasKey));
        adapter.clearDisk();
        assert(!containsKey(adapter.getAllKeysDisk(), kLegacyGetKey));
        assert(!containsKey(adapter.getAllKeysDisk(), kLegacyHasKey));
        assert([[NSUserDefaults standardUserDefaults] objectForKey:nsKey(kLegacyGetKey)] == nil);
        assert([[NSUserDefaults standardUserDefaults] objectForKey:nsKey(kLegacyHasKey)] == nil);

        // 4. The one-time cutover migrates registered legacy keys into the
        //    suite domain and removes their standard-defaults copies.
        [[NSUserDefaults standardUserDefaults]
            setObject:@"legacy-value" forKey:nsKey(kLegacyKey)];
        [suite setObject:@[nsKey(kLegacyKey)] forKey:@"__nitro_storage_legacy_disk_keys__"];
        [suite removeObjectForKey:@"__nitro_storage_legacy_disk_migration_v1__"];
        IOSStorageAdapterCpp migrated;
        assert(migrated.getDisk(kLegacyKey).value() == "legacy-value");
        assert([[NSUserDefaults standardUserDefaults] objectForKey:nsKey(kLegacyKey)] == nil);
        assert([suite objectForKey:@"__nitro_storage_legacy_disk_keys__"] == nil);
        assert([suite boolForKey:@"__nitro_storage_legacy_disk_migration_v1__"]);

        // 5. Suite-domain keys are enumerated and cleared normally, and
        //    clearDisk preserves the migration marker.
        migrated.setDisk(kSuiteKey, "suite-value");
        assert(containsKey(migrated.getAllKeysDisk(), kSuiteKey));
        assert(containsKey(migrated.getAllKeysDisk(), kLegacyKey));
        migrated.clearDisk();
        assert(!containsKey(migrated.getAllKeysDisk(), kSuiteKey));
        assert(!containsKey(migrated.getAllKeysDisk(), kLegacyKey));
        assert([suite boolForKey:@"__nitro_storage_legacy_disk_migration_v1__"]);

        // Length-delimited keys must never alias a legacy key before NUL.
        const std::string nulKey = std::string(kHostKey) + '\0' + "caf\xc3\xa9";
        const std::string nulValue = std::string("before\0after", 12) + " \xf0\x9f\x98\x80";
        NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
        [standard setObject:@"host-value" forKey:nsKey(kHostKey)];
        assert(!migrated.hasDisk(nulKey));
        assert(!migrated.getDisk(nulKey).has_value());
        migrated.setDisk(nulKey, nulValue);
        assert(migrated.getDisk(nulKey).value() == nulValue);
        assert([[standard stringForKey:nsKey(kHostKey)] isEqualToString:@"host-value"]);
        migrated.deleteDisk(nulKey);
        assert([[standard stringForKey:nsKey(kHostKey)] isEqualToString:@"host-value"]);
        migrated.setDiskBatch({nulKey}, {nulValue});
        assert(migrated.getDiskBatch({nulKey})[0].value() == nulValue);
        migrated.deleteDiskBatch({nulKey});
        assert([[standard stringForKey:nsKey(kHostKey)] isEqualToString:@"host-value"]);

        // Legacy suite migration and enumeration preserve full UTF-8 strings.
        NSString* fullKey = [[NSString alloc] initWithBytes:nulKey.data()
            length:nulKey.size() encoding:NSUTF8StringEncoding];
        NSString* fullValue = [[NSString alloc] initWithBytes:nulValue.data()
            length:nulValue.size() encoding:NSUTF8StringEncoding];
        [suite setObject:fullValue forKey:fullKey];
        assert(containsKey(migrated.getAllKeysDisk(), nulKey));
        IOSStorageAdapterCpp nulMigrated;
        assert(nulMigrated.getDisk(nulKey).value() == nulValue);
        nulMigrated.deleteDisk(nulKey);
        assert([[standard stringForKey:nsKey(kHostKey)] isEqualToString:@"host-value"]);

        testCorruptDiskIsReportedOnEveryCallAndRecoveredOnlyByClear();
        testClearOnAFullDatabaseRecreatesItAndFreesSpace();
        testInvalidUtf8KeysAreRejectedBeforeTheDatabaseIsTouched();
        testSizeAndPrefixQueriesMatchFullEnumerationInEveryLegacyState();
        testFullDiskErrorsKeepTheirTagAndLegacyReadsStillWork();

        cleanupState();
        std::cout << "IOSStorageAdapterCpp disk-scoping tests passed." << std::endl;
    }
    return 0;
}
