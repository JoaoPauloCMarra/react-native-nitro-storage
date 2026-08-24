#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>

#include <algorithm>
#include <cassert>
#include <iostream>
#include <string>
#include <vector>

using NitroStorage::IOSStorageAdapterCpp;

namespace NitroStorage {
void runLegacyDiskMigrationCutoverForTesting(NSUserDefaults* defaults);
}

namespace {

const char* kHostKey = "nitro-storage-ut-host-owned";
const char* kLegacyKey = "nitro-storage-ut-legacy";
const char* kLegacyGetKey = "nitro-storage-ut-legacy-get";
const char* kLegacyHasKey = "nitro-storage-ut-legacy-has";
const char* kSuiteKey = "nitro-storage-ut-suite";
const char* kConflictKey = "nitro-storage-ut-conflict";

bool containsKey(const std::vector<std::string>& keys, const std::string& needle) {
    return std::find(keys.begin(), keys.end(), needle) != keys.end();
}

NSString* nsKey(const char* key) {
    return [NSString stringWithUTF8String:key];
}

void cleanupState() {
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    [standard removeObjectForKey:nsKey(kHostKey)];
    [standard removeObjectForKey:nsKey(kLegacyKey)];
    [standard removeObjectForKey:nsKey(kLegacyGetKey)];
    [standard removeObjectForKey:nsKey(kLegacyHasKey)];
    [standard removeObjectForKey:nsKey(kSuiteKey)];
    [standard removeObjectForKey:nsKey(kConflictKey)];
    [standard removeObjectForKey:@"__nitro_storage_legacy_disk_keys__"];
    [standard removeObjectForKey:@"__nitro_storage_legacy_disk_migration_v1__"];
    [standard removePersistentDomainForName:@"com.nitrostorage.disk"];
    [standard synchronize];
}

} // namespace

// Verifies the disk-scoping contract: enumeration and clear must only ever
// touch keys owned by Nitro Storage (the suite domain or legacy keys observed
// through the storage API), never arbitrary host-app standard defaults keys.
int main() {
    @autoreleasepool {
        cleanupState();

        NSUserDefaults* suite = [[NSUserDefaults alloc] initWithSuiteName:@"com.nitrostorage.disk"];

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

        cleanupState();
        std::cout << "IOSStorageAdapterCpp disk-scoping tests passed." << std::endl;
    }
    return 0;
}
