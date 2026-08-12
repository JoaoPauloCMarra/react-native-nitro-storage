#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>

#include <algorithm>
#include <cassert>
#include <iostream>
#include <string>
#include <vector>

using NitroStorage::IOSStorageAdapterCpp;

namespace {

const char* kHostKey = "nitro-storage-ut-host-owned";
const char* kLegacyKey = "nitro-storage-ut-legacy";
const char* kSuiteKey = "nitro-storage-ut-suite";

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
    [standard removeObjectForKey:nsKey(kSuiteKey)];
    [standard removeObjectForKey:@"__nitro_storage_legacy_disk_keys__"];
    [standard removePersistentDomainForName:@"com.nitrostorage.disk"];
    [standard synchronize];
}

} // namespace

// Verifies the disk-scoping contract: enumeration and clear must only ever
// touch keys owned by Nitro Storage (suite domain or legacy keys observed
// through the storage API), never arbitrary host-app standard defaults keys.
int main() {
    @autoreleasepool {
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

        // 3. A legacy standard defaults value becomes visible only when
        //    observed through the storage API (hasDisk registers it).
        [[NSUserDefaults standardUserDefaults]
            setObject:@"legacy-value" forKey:nsKey(kLegacyKey)];
        assert(!containsKey(adapter.getAllKeysDisk(), kLegacyKey));
        assert(adapter.hasDisk(kLegacyKey));
        assert(containsKey(adapter.getAllKeysDisk(), kLegacyKey));

        // 4. clearDisk removes observed legacy keys from both stores.
        adapter.clearDisk();
        assert(!containsKey(adapter.getAllKeysDisk(), kLegacyKey));
        assert([[NSUserDefaults standardUserDefaults] objectForKey:nsKey(kLegacyKey)] == nil);

        // 5. Suite-domain keys are enumerated and cleared normally.
        adapter.setDisk(kSuiteKey, "suite-value");
        assert(containsKey(adapter.getAllKeysDisk(), kSuiteKey));
        adapter.clearDisk();
        assert(!containsKey(adapter.getAllKeysDisk(), kSuiteKey));

        cleanupState();
        std::cout << "IOSStorageAdapterCpp disk-scoping tests passed." << std::endl;
    }
    return 0;
}
