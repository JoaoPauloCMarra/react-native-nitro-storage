#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>

#include <utility>
#include <vector>

namespace NitroStorage {

static NSString* const kKeychainService = @"com.nitrostorage.keychain";
static NSString* const kBiometricKeychainService = @"com.nitrostorage.biometric";
static NSString* const kDiskSuiteName = @"com.nitrostorage.disk";
static NSString* const kLegacyDiskKeysRegistryKey =
    @"__nitro_storage_legacy_disk_keys__";

static std::runtime_error taggedStorageError(const char* code, const std::string& message) {
    return std::runtime_error(
        std::string("[nitro-error:") + code + "] " + message
    );
}

// Unknown keychain statuses are surfaced untagged (matching Android's
// cause-based wrapping), except errSecNotAvailable which means the keychain
// is unavailable until the device is first unlocked — a locked condition.
static std::runtime_error keychainStatusError(OSStatus status, const std::string& operation) {
    if (status == errSecNotAvailable) {
        return taggedStorageError(
            "keychain_locked",
            std::string("NitroStorage: ") + operation + " failed: keychain is unavailable until the device is unlocked (errSecNotAvailable)."
        );
    }
    return std::runtime_error(
        std::string("NitroStorage: ") + operation + " failed with status " + std::to_string(status)
    );
}

static NSUserDefaults* NitroDiskDefaults() {
    static NSUserDefaults* defaults = [[NSUserDefaults alloc] initWithSuiteName:kDiskSuiteName];
    return defaults ?: [NSUserDefaults standardUserDefaults];
}

// --- Legacy disk key migration ---
// Versions before the suite domain stored Disk values in standardUserDefaults.
// A conservative, retryable cutover runs at adapter initialization. A valid
// registry is copied into the suite domain and each source is removed only
// after a target readback confirms the copy. Malformed registries, fallback
// domains, and persistence failures remain untouched for a later retry.

static NSString* const kLegacyDiskMigrationMarkerKey =
    @"__nitro_storage_legacy_disk_migration_v1__";

static void runLegacyDiskMigrationCutover(
    NSUserDefaults* defaults,
    NSUserDefaults* standard
) {
    if ([defaults boolForKey:kLegacyDiskMigrationMarkerKey]) {
        return;
    }

    if (defaults == standard) {
        return;
    }

    id registryValue = [defaults objectForKey:kLegacyDiskKeysRegistryKey];
    if (registryValue == nil || ![registryValue isKindOfClass:[NSArray class]]) {
        return;
    }

    NSArray* registry = (NSArray*)registryValue;
    NSMutableArray<NSString*>* keys = [NSMutableArray arrayWithCapacity:registry.count];
    for (id rawKey in registry) {
        if (![rawKey isKindOfClass:[NSString class]]) {
            return;
        }
        NSString* key = (NSString*)rawKey;
        if (key.length == 0 ||
            [key isEqualToString:kLegacyDiskKeysRegistryKey] ||
            [key isEqualToString:kLegacyDiskMigrationMarkerKey]) {
            return;
        }
        [keys addObject:key];
    }

    for (NSString* key in keys) {
        id legacyValue = [standard objectForKey:key];
        if (legacyValue == nil) {
            continue;
        }
        if (![legacyValue isKindOfClass:[NSString class]]) {
            return;
        }

        id targetValue = [defaults objectForKey:key];
        if (targetValue == nil) {
            [defaults setObject:legacyValue forKey:key];
        }
        if (![defaults synchronize] ||
            ![[defaults objectForKey:key] isEqual:legacyValue]) {
            return;
        }

        [standard removeObjectForKey:key];
        if (![standard synchronize] || [standard objectForKey:key] != nil) {
            return;
        }
    }

    [defaults removeObjectForKey:kLegacyDiskKeysRegistryKey];
    if (![defaults synchronize] ||
        [defaults objectForKey:kLegacyDiskKeysRegistryKey] != nil) {
        return;
    }

    [defaults setBool:YES forKey:kLegacyDiskMigrationMarkerKey];
    if (![defaults synchronize] ||
        ![defaults boolForKey:kLegacyDiskMigrationMarkerKey]) {
        [defaults removeObjectForKey:kLegacyDiskMigrationMarkerKey];
        [defaults synchronize];
    }
}

#if defined(NITRO_STORAGE_TESTING)
void runLegacyDiskMigrationCutoverForTesting(NSUserDefaults* defaults) {
    runLegacyDiskMigrationCutover(defaults, [NSUserDefaults standardUserDefaults]);
}
#endif

// Prevents the Keychain from showing auth UI. On iOS 14+ kSecUseAuthenticationUIFail is
// deprecated; the correct replacement is an LAContext with interactionNotAllowed = YES.
static void disableKeychainInteraction(NSMutableDictionary* query) {
    LAContext* ctx = [[LAContext alloc] init];
    ctx.interactionNotAllowed = YES;
    query[(__bridge id)kSecUseAuthenticationContext] = ctx;
}

struct BiometricKeychainSnapshot {
    bool present{false};
    std::string value;
    SecAccessControlRef accessControl{nullptr};

    BiometricKeychainSnapshot() = default;
    BiometricKeychainSnapshot(const BiometricKeychainSnapshot&) = delete;
    BiometricKeychainSnapshot& operator=(const BiometricKeychainSnapshot&) = delete;
    BiometricKeychainSnapshot(BiometricKeychainSnapshot&& other) noexcept
        : present(other.present),
          value(std::move(other.value)),
          accessControl(other.accessControl) {
        other.accessControl = nullptr;
    }
    BiometricKeychainSnapshot& operator=(BiometricKeychainSnapshot&& other) noexcept {
        if (this == &other) return *this;
        if (accessControl) CFRelease(accessControl);
        present = other.present;
        value = std::move(other.value);
        accessControl = other.accessControl;
        other.accessControl = nullptr;
        return *this;
    }
    ~BiometricKeychainSnapshot() {
        if (accessControl) CFRelease(accessControl);
    }
};

static CFStringRef accessControlAttr(int level) {
    switch (level) {
        case 1: return kSecAttrAccessibleAfterFirstUnlock;
        case 2: return kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly;
        case 3: return kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
        case 4: return kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
        case 0: return kSecAttrAccessibleWhenUnlocked;
        default: return kSecAttrAccessibleAfterFirstUnlock;
    }
}

IOSStorageAdapterCpp::IOSStorageAdapterCpp() {
    runLegacyDiskMigrationCutover(
        NitroDiskDefaults(),
        [NSUserDefaults standardUserDefaults]
    );
}
IOSStorageAdapterCpp::~IOSStorageAdapterCpp() {}

// --- Disk ---

void IOSStorageAdapterCpp::setDisk(const std::string& key, const std::string& value) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* nsValue = [NSString stringWithUTF8String:value.c_str()];
    [NitroDiskDefaults() setObject:nsValue forKey:nsKey];
}

std::optional<std::string> IOSStorageAdapterCpp::getDisk(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* result = [NitroDiskDefaults() stringForKey:nsKey];
    if (!result) return std::nullopt;
    return std::string([result UTF8String]);
}

void IOSStorageAdapterCpp::deleteDisk(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    [NitroDiskDefaults() removeObjectForKey:nsKey];
}

bool IOSStorageAdapterCpp::hasDisk(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    return [NitroDiskDefaults() objectForKey:nsKey] != nil;
}

std::vector<std::string> IOSStorageAdapterCpp::getAllKeysDisk() {
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSDictionary<NSString*, id>* entries = [defaults persistentDomainForName:kDiskSuiteName] ?: @{};
    std::vector<std::string> keys;
    keys.reserve(entries.count);
    for (NSString* key in entries) {
        if (![key isEqualToString:kLegacyDiskKeysRegistryKey] &&
            ![key isEqualToString:kLegacyDiskMigrationMarkerKey]) {
            keys.push_back(std::string([key UTF8String]));
        }
    }
    return keys;
}

std::vector<std::string> IOSStorageAdapterCpp::getKeysByPrefixDisk(const std::string& prefix) {
    const auto keys = getAllKeysDisk();
    std::vector<std::string> filtered;
    filtered.reserve(keys.size());
    for (const auto& key : keys) {
        if (key.rfind(prefix, 0) == 0) {
            filtered.push_back(key);
        }
    }
    return filtered;
}

size_t IOSStorageAdapterCpp::sizeDisk() {
    return getAllKeysDisk().size();
}

void IOSStorageAdapterCpp::setDiskBatch(
    const std::vector<std::string>& keys,
    const std::vector<std::string>& values
) {
    NSUserDefaults* defaults = NitroDiskDefaults();
    for (size_t i = 0; i < keys.size() && i < values.size(); ++i) {
        NSString* nsKey = [NSString stringWithUTF8String:keys[i].c_str()];
        NSString* nsValue = [NSString stringWithUTF8String:values[i].c_str()];
        [defaults setObject:nsValue forKey:nsKey];
    }
}

std::vector<std::optional<std::string>> IOSStorageAdapterCpp::getDiskBatch(
    const std::vector<std::string>& keys
) {
    std::vector<std::optional<std::string>> results;
    results.reserve(keys.size());
    for (const auto& key : keys) {
        results.push_back(getDisk(key));
    }
    return results;
}

void IOSStorageAdapterCpp::deleteDiskBatch(const std::vector<std::string>& keys) {
    for (const auto& key : keys) {
        deleteDisk(key);
    }
}

void IOSStorageAdapterCpp::clearDisk() {
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSDictionary<NSString*, id>* entries = [defaults persistentDomainForName:kDiskSuiteName] ?: @{};
    for (NSString* key in entries) {
        if ([key isEqualToString:kLegacyDiskKeysRegistryKey] ||
            [key isEqualToString:kLegacyDiskMigrationMarkerKey]) {
            continue;
        }
        [defaults removeObjectForKey:key];
    }
}

// --- Secure (Keychain) ---

static NSMutableDictionary* baseKeychainQuery(NSString* key, NSString* service, NSString* accessGroup) {
    NSMutableDictionary* query = [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: service,
        (__bridge id)kSecAttrAccount: key
    } mutableCopy];
    if (accessGroup && accessGroup.length > 0) {
        query[(__bridge id)kSecAttrAccessGroup] = accessGroup;
    }
    return query;
}

static void throwIfDeleteFailed(OSStatus status, const std::string& operation) {
    if (status == errSecSuccess || status == errSecItemNotFound) {
        return;
    }
    if (status == errSecInteractionNotAllowed) {
        throw taggedStorageError(
            "keychain_locked",
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). " + operation
        );
    }
    throw keychainStatusError(status, operation);
}

static BiometricKeychainSnapshot captureBiometricValue(
    NSString* nsKey,
    NSString* group
) {
    BiometricKeychainSnapshot snapshot;
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    query[(__bridge id)kSecReturnAttributes] = @YES;
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    disableKeychainInteraction(query);

    CFTypeRef result = NULL;
    const OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecItemNotFound) {
        return snapshot;
    }
    if (status == errSecInteractionNotAllowed) {
        throw taggedStorageError(
            "keychain_locked",
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
            "The biometric item is not accessible until the device is unlocked."
        );
    }
    if (status != errSecSuccess || !result) {
        if (result) CFRelease(result);
        throw keychainStatusError(status, "Biometric snapshot");
    }

    NSDictionary* attributes = (__bridge NSDictionary*)result;
    NSData* data = attributes[(__bridge id)kSecValueData];
    id accessControl = attributes[(__bridge id)kSecAttrAccessControl];
    if (!data || !accessControl) {
        CFRelease(result);
        throw std::runtime_error(
            "NitroStorage: Biometric snapshot did not include value data and access control"
        );
    }
    NSString* stringValue = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!stringValue) {
        CFRelease(result);
        throw std::runtime_error("NitroStorage: Biometric snapshot value is not UTF-8");
    }
    snapshot.present = true;
    snapshot.value = std::string([stringValue UTF8String]);
    snapshot.accessControl = (SecAccessControlRef)CFRetain((__bridge CFTypeRef)accessControl);
    CFRelease(result);
    return snapshot;
}

static NSMutableDictionary* allAccountsQuery(NSString* service, NSString* accessGroup) {
    NSMutableDictionary* query = [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: service,
        (__bridge id)kSecReturnAttributes: @YES,
        (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitAll
    } mutableCopy];
    if (accessGroup && accessGroup.length > 0) {
        query[(__bridge id)kSecAttrAccessGroup] = accessGroup;
    }
    return query;
}

static NSString* nsStringFromStdString(const std::string& value) {
    return [NSString stringWithUTF8String:value.c_str()];
}

static NSData* nsDataFromStdString(const std::string& value) {
    return [nsStringFromStdString(value) dataUsingEncoding:NSUTF8StringEncoding];
}

static void setSecureValue(
    NSString* nsKey,
    NSData* data,
    NSString* group,
    int accessControlLevel
) {
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kKeychainService, group);
    NSDictionary* updateAttributes = @{
        (__bridge id)kSecValueData: data
    };

    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)updateAttributes);
    if (status == errSecSuccess) {
        return;
    }

    if (status == errSecItemNotFound) {
        query[(__bridge id)kSecValueData] = data;
        query[(__bridge id)kSecAttrAccessible] = (__bridge id)accessControlAttr(accessControlLevel);
        const OSStatus addStatus = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
        if (addStatus == errSecSuccess) {
            return;
        }
        if (addStatus == errSecInteractionNotAllowed) {
            throw taggedStorageError(
                "keychain_locked",
                "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
                "The item is not accessible until the device is unlocked."
            );
        }
        throw keychainStatusError(addStatus, "Secure set");
    }

    if (status == errSecInteractionNotAllowed) {
        throw taggedStorageError(
            "keychain_locked",
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
            "The item is not accessible until the device is unlocked."
        );
    }
    throw keychainStatusError(status, "Secure set");
}

static std::optional<std::string> getSecureValue(NSString* nsKey, NSString* group) {
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kKeychainService, group);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    disableKeychainInteraction(query);

    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecSuccess && result) {
        NSData* data = (__bridge_transfer NSData*)result;
        NSString* str = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (str) return std::string([str UTF8String]);
    }
    if (status == errSecInteractionNotAllowed) {
        throw taggedStorageError(
            "keychain_locked",
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
            "The item is not accessible until the device is unlocked."
        );
    }
    if (status == errSecItemNotFound) {
        return std::nullopt;
    }
    throw keychainStatusError(status, "Secure get");
}

static void deleteSecureValue(NSString* nsKey, NSString* group) {
    NSMutableDictionary* secureQuery = baseKeychainQuery(nsKey, kKeychainService, group);
    const OSStatus secureStatus = SecItemDelete((__bridge CFDictionaryRef)secureQuery);
    throwIfDeleteFailed(secureStatus, "Secure delete");

    NSMutableDictionary* biometricQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    const OSStatus biometricStatus = SecItemDelete((__bridge CFDictionaryRef)biometricQuery);
    throwIfDeleteFailed(biometricStatus, "Biometric delete");
}

// Deletes only the plain (non-biometric) keychain copy. Promotion to biometric
// storage must remove the plain copy so stale plain reads cannot resurrect it.
static void deletePlainSecureValue(NSString* nsKey, NSString* group) {
    NSMutableDictionary* secureQuery = baseKeychainQuery(nsKey, kKeychainService, group);
    OSStatus secureStatus = SecItemDelete((__bridge CFDictionaryRef)secureQuery);
    throwIfDeleteFailed(secureStatus, "Plain secure delete");
}

static void deleteBiometricValue(NSString* nsKey, NSString* group) {
    NSMutableDictionary* biometricQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    const OSStatus status = SecItemDelete((__bridge CFDictionaryRef)biometricQuery);
    throwIfDeleteFailed(status, "Biometric delete");
}

static void restoreBiometricValue(
    NSString* nsKey,
    NSString* group,
    const BiometricKeychainSnapshot& snapshot
) {
    deleteBiometricValue(nsKey, group);
    if (!snapshot.present) {
        return;
    }
    if (!snapshot.accessControl) {
        throw std::runtime_error(
            "NitroStorage: Previous biometric item has no access control"
        );
    }
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    query[(__bridge id)kSecValueData] = [nsStringFromStdString(snapshot.value) dataUsingEncoding:NSUTF8StringEncoding];
    query[(__bridge id)kSecAttrAccessControl] = (__bridge id)snapshot.accessControl;
    const OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    if (status != errSecSuccess) {
        if (status == errSecInteractionNotAllowed) {
            throw taggedStorageError(
                "keychain_locked",
                "NitroStorage: Keychain is locked (errSecInteractionNotAllowed) while restoring biometric storage"
            );
        }
        throw keychainStatusError(status, "Biometric restore");
    }
}

static std::vector<std::string> keychainAccountsForService(NSString* service, NSString* accessGroup) {
    NSMutableDictionary* query = allAccountsQuery(service, accessGroup);
    disableKeychainInteraction(query);
    CFTypeRef result = NULL;
    std::vector<std::string> keys;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecInteractionNotAllowed) {
        throw taggedStorageError(
            "keychain_locked",
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
            "The item is not accessible until the device is unlocked."
        );
    }
    if (status == errSecSuccess && result) {
        id items = (__bridge_transfer id)result;
        NSArray* itemArray = nil;
        if ([items isKindOfClass:[NSArray class]]) {
            itemArray = (NSArray*)items;
        } else if ([items isKindOfClass:[NSDictionary class]]) {
            itemArray = @[(NSDictionary*)items];
        }
        if (itemArray) {
            keys.reserve(itemArray.count);
            for (NSDictionary* item in itemArray) {
                NSString* account = item[(__bridge id)kSecAttrAccount];
                if (account) {
                    keys.push_back(std::string([account UTF8String]));
                }
            }
        }
    }
    return keys;
}

void IOSStorageAdapterCpp::setSecure(const std::string& key, const std::string& value) {
    NSString* nsKey = nsStringFromStdString(key);
    NSData* data = nsDataFromStdString(value);
    std::string groupStr;
    int accessControlLevel;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
        accessControlLevel = accessControlLevel_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    setSecureValue(nsKey, data, group, accessControlLevel);
    markSecureKeySet(key);
}

std::optional<std::string> IOSStorageAdapterCpp::getSecure(const std::string& key) {
    NSString* nsKey = nsStringFromStdString(key);
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    return getSecureValue(nsKey, group);
}

void IOSStorageAdapterCpp::deleteSecure(const std::string& key) {
    NSString* nsKey = nsStringFromStdString(key);
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    deleteSecureValue(nsKey, group);
    markSecureKeyRemoved(key);
    markBiometricKeyRemoved(key);
}

bool IOSStorageAdapterCpp::hasSecure(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    NSMutableDictionary* secureQuery = baseKeychainQuery(nsKey, kKeychainService, group);
    disableKeychainInteraction(secureQuery);
    if (SecItemCopyMatching((__bridge CFDictionaryRef)secureQuery, NULL) == errSecSuccess) {
        return true;
    }
    NSMutableDictionary* biometricQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    disableKeychainInteraction(biometricQuery);
    return SecItemCopyMatching((__bridge CFDictionaryRef)biometricQuery, NULL) == errSecSuccess;
}

std::vector<std::string> IOSStorageAdapterCpp::getAllKeysSecure() {
    ensureSecureKeyCacheHydrated();
    std::lock_guard<std::mutex> lock(secureKeysMutex_);
    std::unordered_set<std::string> combined = secureKeysCache_;
    combined.insert(biometricKeysCache_.begin(), biometricKeysCache_.end());
    std::vector<std::string> keys;
    keys.reserve(combined.size());
    for (const auto& key : combined) {
        keys.push_back(key);
    }
    return keys;
}

std::vector<std::string> IOSStorageAdapterCpp::getKeysByPrefixSecure(const std::string& prefix) {
    const auto keys = getAllKeysSecure();
    std::vector<std::string> filtered;
    filtered.reserve(keys.size());
    for (const auto& key : keys) {
        if (key.rfind(prefix, 0) == 0) {
            filtered.push_back(key);
        }
    }
    return filtered;
}

size_t IOSStorageAdapterCpp::sizeSecure() {
    ensureSecureKeyCacheHydrated();
    std::lock_guard<std::mutex> lock(secureKeysMutex_);
    std::unordered_set<std::string> combined = secureKeysCache_;
    combined.insert(biometricKeysCache_.begin(), biometricKeysCache_.end());
    return combined.size();
}

void IOSStorageAdapterCpp::setSecureBatch(
    const std::vector<std::string>& keys,
    const std::vector<std::string>& values
) {
    std::string groupStr;
    int accessControlLevel;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
        accessControlLevel = accessControlLevel_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    for (size_t i = 0; i < keys.size() && i < values.size(); ++i) {
        setSecureValue(
            nsStringFromStdString(keys[i]),
            nsDataFromStdString(values[i]),
            group,
            accessControlLevel
        );
        markSecureKeySet(keys[i]);
    }
}

std::vector<std::optional<std::string>> IOSStorageAdapterCpp::getSecureBatch(
    const std::vector<std::string>& keys
) {
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    std::vector<std::optional<std::string>> results;
    results.reserve(keys.size());
    for (const auto& key : keys) {
        results.push_back(getSecureValue(nsStringFromStdString(key), group));
    }
    return results;
}

void IOSStorageAdapterCpp::deleteSecureBatch(const std::vector<std::string>& keys) {
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    for (const auto& key : keys) {
        deleteSecureValue(nsStringFromStdString(key), group);
        markSecureKeyRemoved(key);
        markBiometricKeyRemoved(key);
    }
}

void IOSStorageAdapterCpp::clearSecure() {
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    NSMutableDictionary* secureQuery = [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kKeychainService
    } mutableCopy];
    if (group && group.length > 0) {
        secureQuery[(__bridge id)kSecAttrAccessGroup] = group;
    }
    OSStatus secStatus = SecItemDelete((__bridge CFDictionaryRef)secureQuery);
    if (secStatus != errSecSuccess && secStatus != errSecItemNotFound) {
        if (secStatus == errSecInteractionNotAllowed) {
            throw taggedStorageError(
                "keychain_locked",
                "NitroStorage: Cannot clear secure storage: keychain is locked (errSecInteractionNotAllowed)"
            );
        }
        throw keychainStatusError(secStatus, "clearSecure");
    }

    NSMutableDictionary* biometricQuery = [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kBiometricKeychainService
    } mutableCopy];
    if (group && group.length > 0) {
        biometricQuery[(__bridge id)kSecAttrAccessGroup] = group;
    }
    OSStatus bioStatus = SecItemDelete((__bridge CFDictionaryRef)biometricQuery);
    if (bioStatus != errSecSuccess && bioStatus != errSecItemNotFound) {
        if (bioStatus == errSecInteractionNotAllowed) {
            throw taggedStorageError(
                "keychain_locked",
                "NitroStorage: Cannot clear biometric storage: keychain is locked (errSecInteractionNotAllowed)"
            );
        }
        throw keychainStatusError(bioStatus, "clearSecureBiometric");
    }
    clearSecureKeyCache();  // Only clears cache AFTER confirmed deletion
}

// --- Configuration ---

void IOSStorageAdapterCpp::setSecureAccessControl(int level) {
    std::lock_guard<std::mutex> lock(accessGroupMutex_);
    accessControlLevel_ = level;
}

void IOSStorageAdapterCpp::setSecureWritesAsync(bool /*enabled*/) {
    // iOS writes are synchronous by design; keep behavior unchanged.
}

void IOSStorageAdapterCpp::setKeychainAccessGroup(const std::string& group) {
    std::lock_guard<std::mutex> lock1(accessGroupMutex_);
    std::lock_guard<std::mutex> lock2(secureKeysMutex_);
    keychainAccessGroup_ = group;
    secureKeysCache_.clear();
    biometricKeysCache_.clear();
    secureKeyCacheHydrated_ = false;
}

// --- Biometric (separate Keychain service with biometric ACL) ---

void IOSStorageAdapterCpp::setSecureBiometric(const std::string& key, const std::string& value) {
    setSecureBiometricWithLevel(key, value, 2);
}

void IOSStorageAdapterCpp::setSecureBiometricWithLevel(const std::string& key, const std::string& value, int level) {
    if (level < 0 || level > 2) {
        throw std::runtime_error("NitroStorage: Invalid biometric level");
    }
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSData* data = nsDataFromStdString(value);
    std::string groupStr;
    int accessControlLevel;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
        accessControlLevel = accessControlLevel_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];

    const BiometricKeychainSnapshot previousBiometric = captureBiometricValue(nsKey, group);
    const std::optional<std::string> previousPlain = getSecureValue(nsKey, group);
    std::vector<std::string> rollbackErrors;

    try {
        if (level == 0) {
            deleteBiometricValue(nsKey, group);
            markBiometricKeyRemoved(key);
            setSecure(key, value);
            return;
        }

        // A biometric item's access control cannot be updated in place. Delete
        // the old item only after its value and ACL have been captured.
        deleteBiometricValue(nsKey, group);

        CFErrorRef error = NULL;
        const SecAccessControlCreateFlags flags =
            level == 1 ? kSecAccessControlUserPresence : kSecAccessControlBiometryCurrentSet;
        SecAccessControlRef access = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            flags,
            &error
        );
        if (error || !access) {
            if (error) CFRelease(error);
            if (access) CFRelease(access);
            throw taggedStorageError(
                "biometric_unavailable",
                "NitroStorage: Failed to create biometric access control"
            );
        }

        NSMutableDictionary* attrs = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
        attrs[(__bridge id)kSecValueData] = data;
        attrs[(__bridge id)kSecAttrAccessControl] = (__bridge_transfer id)access;
        const OSStatus addStatus = SecItemAdd((__bridge CFDictionaryRef)attrs, NULL);
        if (addStatus != errSecSuccess) {
            if (addStatus == errSecInteractionNotAllowed) {
                throw taggedStorageError(
                    "keychain_locked",
                    "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
                    "The biometric item is not accessible until the device is unlocked."
                );
            }
            throw keychainStatusError(addStatus, "Biometric set");
        }

        // A successful promotion has exactly one representation. If this
        // delete fails, compensation restores both prior representations.
        deletePlainSecureValue(nsKey, group);
        markBiometricKeySet(key);
        markSecureKeyRemoved(key);
    } catch (const std::exception& primary) {
        try {
            restoreBiometricValue(nsKey, group, previousBiometric);
            if (previousBiometric.present) {
                markBiometricKeySet(key);
            } else {
                markBiometricKeyRemoved(key);
            }
        } catch (const std::exception& rollbackError) {
            rollbackErrors.push_back(std::string("biometric: ") + rollbackError.what());
        }

        try {
            if (previousPlain.has_value()) {
                setSecureValue(
                    nsKey,
                    nsDataFromStdString(*previousPlain),
                    group,
                    accessControlLevel
                );
                markSecureKeySet(key);
            } else {
                deletePlainSecureValue(nsKey, group);
                markSecureKeyRemoved(key);
            }
        } catch (const std::exception& rollbackError) {
            rollbackErrors.push_back(std::string("plain: ") + rollbackError.what());
        }
        clearSecureKeyCache();

        if (!rollbackErrors.empty()) {
            const std::string operation =
                level == 0 ? "Secure demotion" : "Biometric promotion";
            throw taggedStorageError(
                "storage_compensation_failed",
                "NitroStorage: " + operation +
                    " failed; rollback_error_count=" +
                    std::to_string(rollbackErrors.size())
            );
        }
        throw;
    }
}

std::optional<std::string> IOSStorageAdapterCpp::getSecureBiometric(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecSuccess && result) {
        NSData* data = (__bridge_transfer NSData*)result;
        NSString* str = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (str) return std::string([str UTF8String]);
    }
    if (status == errSecInteractionNotAllowed) {
        throw taggedStorageError(
            "keychain_locked",
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
            "The item is not accessible until the device is unlocked."
        );
    }
    if (status == errSecUserCanceled || status == errSecAuthFailed) {
        throw taggedStorageError(
            "authentication_required",
            "NitroStorage: Biometric authentication failed"
        );
    }
    if (status == errSecItemNotFound) {
        return std::nullopt;
    }
    throw keychainStatusError(status, "Biometric get");
}

void IOSStorageAdapterCpp::deleteSecureBiometric(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    const OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    throwIfDeleteFailed(status, "Biometric delete");
    markBiometricKeyRemoved(key);
}

bool IOSStorageAdapterCpp::hasSecureBiometric(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    disableKeychainInteraction(query);
    const OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, NULL);
    if (status == errSecSuccess) return true;
    if (status == errSecItemNotFound) return false;
    if (status == errSecInteractionNotAllowed) {
        throw taggedStorageError(
            "keychain_locked",
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed) while inspecting biometric storage"
        );
    }
    throw keychainStatusError(status, "Biometric has");
}

void IOSStorageAdapterCpp::clearSecureBiometric() {
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    NSMutableDictionary* query = [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kBiometricKeychainService
    } mutableCopy];
    if (group && group.length > 0) {
        query[(__bridge id)kSecAttrAccessGroup] = group;
    }
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    if (status != errSecSuccess && status != errSecItemNotFound) {
        if (status == errSecInteractionNotAllowed) {
            throw taggedStorageError(
                "keychain_locked",
                "NitroStorage: Cannot clear biometric storage: keychain is locked (errSecInteractionNotAllowed)"
            );
        }
        throw std::runtime_error(
            std::string("NitroStorage: clearSecureBiometric failed with status ") + std::to_string(status));
    }
    {
        std::lock_guard<std::mutex> lock(secureKeysMutex_);
        biometricKeysCache_.clear();
    }
}

void IOSStorageAdapterCpp::ensureSecureKeyCacheHydrated() {
    {
        std::lock_guard<std::mutex> lock(secureKeysMutex_);
        if (secureKeyCacheHydrated_) return;
    }

    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* nsGroup = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];

    // These can throw errSecInteractionNotAllowed — let the exception propagate
    // so the cache is NOT marked hydrated (will be retried on next access)
    const std::vector<std::string> secureKeys = keychainAccountsForService(kKeychainService, nsGroup);
    const std::vector<std::string> biometricKeys = keychainAccountsForService(kBiometricKeychainService, nsGroup);

    std::lock_guard<std::mutex> lock(secureKeysMutex_);
    if (secureKeyCacheHydrated_) return;
    secureKeysCache_.clear();
    biometricKeysCache_.clear();
    secureKeysCache_.insert(secureKeys.begin(), secureKeys.end());
    biometricKeysCache_.insert(biometricKeys.begin(), biometricKeys.end());
    secureKeyCacheHydrated_ = true;
}

void IOSStorageAdapterCpp::markSecureKeySet(const std::string& key) {
    std::lock_guard<std::mutex> lock(secureKeysMutex_);
    if (!secureKeyCacheHydrated_) {
        return;
    }
    secureKeysCache_.insert(key);
}

void IOSStorageAdapterCpp::markSecureKeyRemoved(const std::string& key) {
    std::lock_guard<std::mutex> lock(secureKeysMutex_);
    if (!secureKeyCacheHydrated_) {
        return;
    }
    secureKeysCache_.erase(key);
}

void IOSStorageAdapterCpp::markBiometricKeySet(const std::string& key) {
    std::lock_guard<std::mutex> lock(secureKeysMutex_);
    if (!secureKeyCacheHydrated_) {
        return;
    }
    biometricKeysCache_.insert(key);
}

void IOSStorageAdapterCpp::markBiometricKeyRemoved(const std::string& key) {
    std::lock_guard<std::mutex> lock(secureKeysMutex_);
    if (!secureKeyCacheHydrated_) {
        return;
    }
    biometricKeysCache_.erase(key);
}

void IOSStorageAdapterCpp::clearSecureKeyCache() {
    std::lock_guard<std::mutex> lock(secureKeysMutex_);
    secureKeysCache_.clear();
    biometricKeysCache_.clear();
    secureKeyCacheHydrated_ = false;
}

} // namespace NitroStorage
