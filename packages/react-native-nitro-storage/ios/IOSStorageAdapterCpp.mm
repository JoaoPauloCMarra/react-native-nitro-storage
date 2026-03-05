#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <algorithm>
#include <unordered_set>

namespace NitroStorage {

static NSString* const kKeychainService = @"com.nitrostorage.keychain";
static NSString* const kBiometricKeychainService = @"com.nitrostorage.biometric";
static NSString* const kDiskSuiteName = @"com.nitrostorage.disk";

static NSUserDefaults* NitroDiskDefaults() {
    static NSUserDefaults* defaults = [[NSUserDefaults alloc] initWithSuiteName:kDiskSuiteName];
    return defaults ?: [NSUserDefaults standardUserDefaults];
}

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

IOSStorageAdapterCpp::IOSStorageAdapterCpp() {}
IOSStorageAdapterCpp::~IOSStorageAdapterCpp() {}

// --- Disk ---

void IOSStorageAdapterCpp::setDisk(const std::string& key, const std::string& value) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* nsValue = [NSString stringWithUTF8String:value.c_str()];
    NSUserDefaults* defaults = NitroDiskDefaults();
    [defaults setObject:nsValue forKey:nsKey];
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    if ([standard objectForKey:nsKey] != nil) {
        [standard removeObjectForKey:nsKey];
    }
}

std::optional<std::string> IOSStorageAdapterCpp::getDisk(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSString* result = [defaults stringForKey:nsKey];

    if (!result) {
        NSUserDefaults* legacyDefaults = [NSUserDefaults standardUserDefaults];
        NSString* legacyValue = [legacyDefaults stringForKey:nsKey];
        if (legacyValue) {
            [defaults setObject:legacyValue forKey:nsKey];
            [legacyDefaults removeObjectForKey:nsKey];
            result = legacyValue;
        }
    }

    if (!result) return std::nullopt;
    return std::string([result UTF8String]);
}

void IOSStorageAdapterCpp::deleteDisk(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    [NitroDiskDefaults() removeObjectForKey:nsKey];
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    if ([standard objectForKey:nsKey] != nil) {
        [standard removeObjectForKey:nsKey];
    }
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
        keys.push_back(std::string([key UTF8String]));
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
    NSDictionary<NSString*, id>* entries = [NitroDiskDefaults() persistentDomainForName:kDiskSuiteName] ?: @{};
    return entries.count;
}

void IOSStorageAdapterCpp::setDiskBatch(
    const std::vector<std::string>& keys,
    const std::vector<std::string>& values
) {
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    NSMutableArray* legacyKeysToRemove = [NSMutableArray array];
    for (size_t i = 0; i < keys.size() && i < values.size(); ++i) {
        NSString* nsKey = [NSString stringWithUTF8String:keys[i].c_str()];
        NSString* nsValue = [NSString stringWithUTF8String:values[i].c_str()];
        [defaults setObject:nsValue forKey:nsKey];
        if ([standard objectForKey:nsKey] != nil) {
            [legacyKeysToRemove addObject:nsKey];
        }
    }
    for (NSString* key in legacyKeysToRemove) {
        [standard removeObjectForKey:key];
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

static std::vector<std::string> keychainAccountsForService(NSString* service, NSString* accessGroup) {
    NSMutableDictionary* query = allAccountsQuery(service, accessGroup);
    query[(__bridge id)kSecUseAuthenticationUI] = (__bridge id)kSecUseAuthenticationUIFail;
    CFTypeRef result = NULL;
    std::vector<std::string> keys;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecInteractionNotAllowed) {
        throw std::runtime_error(
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
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSData* data = [[NSString stringWithUTF8String:value.c_str()] dataUsingEncoding:NSUTF8StringEncoding];
    std::string groupStr;
    int accessControlLevel;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
        accessControlLevel = accessControlLevel_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kKeychainService, group);

    NSDictionary* updateAttributes = @{
        (__bridge id)kSecValueData: data
    };

    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)updateAttributes);

    if (status == errSecSuccess) {
        markSecureKeySet(key);
        return;
    }

    if (status == errSecItemNotFound) {
        query[(__bridge id)kSecValueData] = data;
        query[(__bridge id)kSecAttrAccessible] = (__bridge id)accessControlAttr(accessControlLevel);
        const OSStatus addStatus = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
        if (addStatus != errSecSuccess) {
            if (addStatus == errSecInteractionNotAllowed) {
                throw std::runtime_error(
                    "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
                    "The item is not accessible until the device is unlocked."
                );
            }
            throw std::runtime_error(
                "NitroStorage: Secure set failed with status " + std::to_string(addStatus)
            );
        }
        markSecureKeySet(key);
        return;
    }

    if (status == errSecInteractionNotAllowed) {
        throw std::runtime_error(
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
            "The item is not accessible until the device is unlocked."
        );
    }
    throw std::runtime_error(
        "NitroStorage: Secure set failed with status " + std::to_string(status)
    );
}

std::optional<std::string> IOSStorageAdapterCpp::getSecure(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kKeychainService, group);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    query[(__bridge id)kSecUseAuthenticationUI] = (__bridge id)kSecUseAuthenticationUIFail;

    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecSuccess && result) {
        NSData* data = (__bridge_transfer NSData*)result;
        NSString* str = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (str) return std::string([str UTF8String]);
    }
    if (status == errSecInteractionNotAllowed) {
        throw std::runtime_error(
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
            "The item is not accessible until the device is unlocked."
        );
    }
    return std::nullopt;
}

void IOSStorageAdapterCpp::deleteSecure(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];

    NSMutableDictionary* secureQuery = baseKeychainQuery(nsKey, kKeychainService, group);
    OSStatus secureStatus = SecItemDelete((__bridge CFDictionaryRef)secureQuery);
    if (secureStatus == errSecInteractionNotAllowed) {
        throw std::runtime_error(
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
            "The item is not accessible until the device is unlocked."
        );
    }

    NSMutableDictionary* biometricQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    OSStatus biometricStatus = SecItemDelete((__bridge CFDictionaryRef)biometricQuery);
    if (biometricStatus == errSecInteractionNotAllowed) {
        throw std::runtime_error(
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
            "The item is not accessible until the device is unlocked."
        );
    }

    // errSecItemNotFound means the item was already gone — that's fine (idempotent).
    // Only update the cache if the delete actually ran (success or item-not-found).
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
    secureQuery[(__bridge id)kSecUseAuthenticationUI] = (__bridge id)kSecUseAuthenticationUIFail;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)secureQuery, NULL) == errSecSuccess) {
        return true;
    }
    NSMutableDictionary* biometricQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    biometricQuery[(__bridge id)kSecUseAuthenticationUI] = (__bridge id)kSecUseAuthenticationUIFail;
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
    for (size_t i = 0; i < keys.size() && i < values.size(); ++i) {
        setSecure(keys[i], values[i]);
    }
}

std::vector<std::optional<std::string>> IOSStorageAdapterCpp::getSecureBatch(
    const std::vector<std::string>& keys
) {
    std::vector<std::optional<std::string>> results;
    results.reserve(keys.size());
    for (const auto& key : keys) {
        results.push_back(getSecure(key));
    }
    return results;
}

void IOSStorageAdapterCpp::deleteSecureBatch(const std::vector<std::string>& keys) {
    for (const auto& key : keys) {
        deleteSecure(key);
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
            throw std::runtime_error("NitroStorage: Cannot clear secure storage: keychain is locked (errSecInteractionNotAllowed)");
        }
        throw std::runtime_error(
            std::string("NitroStorage: clearSecure failed with status ") + std::to_string(secStatus));
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
            throw std::runtime_error("NitroStorage: Cannot clear biometric storage: keychain is locked (errSecInteractionNotAllowed)");
        }
        throw std::runtime_error(
            std::string("NitroStorage: clearSecureBiometric failed with status ") + std::to_string(bioStatus));
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
    if (level == 0) {
        setSecure(key, value);
        return;
    }

    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSData* data = [[NSString stringWithUTF8String:value.c_str()] dataUsingEncoding:NSUTF8StringEncoding];
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : [NSString stringWithUTF8String:groupStr.c_str()];

    // Capture backup before delete — use kSecUseAuthenticationUIFail to avoid prompting
    std::optional<std::string> backup = std::nullopt;
    {
        NSMutableDictionary* backupQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
        backupQuery[(__bridge id)kSecReturnData] = @YES;
        backupQuery[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
        backupQuery[(__bridge id)kSecUseAuthenticationUI] = (__bridge id)kSecUseAuthenticationUIFail;
        CFTypeRef backupResult = NULL;
        if (SecItemCopyMatching((__bridge CFDictionaryRef)backupQuery, &backupResult) == errSecSuccess && backupResult) {
            NSData* bData = (__bridge_transfer NSData*)backupResult;
            NSString* str = [[NSString alloc] initWithData:bData encoding:NSUTF8StringEncoding];
            if (str) backup = std::string([str UTF8String]);
        } else if (backupResult) {
            CFRelease(backupResult);
        }
    }

    // Delete existing item first (access control can't be updated in place)
    NSMutableDictionary* deleteQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    SecItemDelete((__bridge CFDictionaryRef)deleteQuery);

    CFErrorRef error = NULL;
    SecAccessControlCreateFlags flags = kSecAccessControlBiometryCurrentSet;
    if (level == 1) {
        flags = kSecAccessControlUserPresence;
    }
    SecAccessControlRef access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
        flags,
        &error
    );

    if (error || !access) {
        if (access) CFRelease(access);
        if (error) CFRelease(error);
        throw std::runtime_error("NitroStorage: Failed to create biometric access control");
    }

    NSMutableDictionary* attrs = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    attrs[(__bridge id)kSecValueData] = data;
    attrs[(__bridge id)kSecAttrAccessControl] = (__bridge_transfer id)access;

    OSStatus addStatus = SecItemAdd((__bridge CFDictionaryRef)attrs, NULL);
    if (addStatus != errSecSuccess) {
        if (backup.has_value()) {
            try {
                setSecure(key, *backup);
            } catch (const std::exception& restoreEx) {
                throw std::runtime_error(
                    std::string("NitroStorage: Biometric set failed with status ") +
                    std::to_string(addStatus) +
                    " and previous value restoration also failed: " + restoreEx.what());
            }
        }
        if (addStatus == errSecInteractionNotAllowed) {
            throw std::runtime_error(
                "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
                "The item is not accessible until the device is unlocked."
            );
        }
        throw std::runtime_error(
            std::string("NitroStorage: Biometric set failed with status ") +
            std::to_string(addStatus) +
            (backup.has_value() ? " (previous value restored to non-biometric keychain)" : " (no previous value)"));
    }
    markBiometricKeySet(key);
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
        throw std::runtime_error(
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed). "
            "The item is not accessible until the device is unlocked."
        );
    }
    if (status == errSecUserCanceled || status == errSecAuthFailed) {
        throw std::runtime_error("NitroStorage: Biometric authentication failed");
    }
    return std::nullopt;
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
    SecItemDelete((__bridge CFDictionaryRef)query);
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
    query[(__bridge id)kSecUseAuthenticationUI] = (__bridge id)kSecUseAuthenticationUIFail;
    return SecItemCopyMatching((__bridge CFDictionaryRef)query, NULL) == errSecSuccess;
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
            throw std::runtime_error("NitroStorage: Cannot clear biometric storage: keychain is locked (errSecInteractionNotAllowed)");
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
