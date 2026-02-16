#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <algorithm>

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
        default: return kSecAttrAccessibleWhenUnlocked;
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
    [[NSUserDefaults standardUserDefaults] removeObjectForKey:nsKey];
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
    [[NSUserDefaults standardUserDefaults] removeObjectForKey:nsKey];
}

bool IOSStorageAdapterCpp::hasDisk(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    return [NitroDiskDefaults() objectForKey:nsKey] != nil;
}

std::vector<std::string> IOSStorageAdapterCpp::getAllKeysDisk() {
    NSDictionary<NSString*, id>* entries = [NitroDiskDefaults() dictionaryRepresentation];
    std::vector<std::string> keys;
    keys.reserve(entries.count);
    for (NSString* key in entries) {
        keys.push_back(std::string([key UTF8String]));
    }
    return keys;
}

size_t IOSStorageAdapterCpp::sizeDisk() {
    return [NitroDiskDefaults() dictionaryRepresentation].count;
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
        [[NSUserDefaults standardUserDefaults] removeObjectForKey:nsKey];
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
    NSDictionary<NSString*, id>* entries = [defaults dictionaryRepresentation];
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
    CFTypeRef result = NULL;
    std::vector<std::string> keys;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)query, &result) == errSecSuccess && result) {
        NSArray* items = (__bridge_transfer NSArray*)result;
        keys.reserve(items.count);
        for (NSDictionary* item in items) {
            NSString* account = item[(__bridge id)kSecAttrAccount];
            if (account) {
                keys.push_back(std::string([account UTF8String]));
            }
        }
    }
    return keys;
}

void IOSStorageAdapterCpp::setSecure(const std::string& key, const std::string& value) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSData* data = [[NSString stringWithUTF8String:value.c_str()] dataUsingEncoding:NSUTF8StringEncoding];
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kKeychainService, group);

    NSDictionary* updateAttributes = @{
        (__bridge id)kSecValueData: data
    };

    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)updateAttributes);

    if (status == errSecItemNotFound) {
        query[(__bridge id)kSecValueData] = data;
        query[(__bridge id)kSecAttrAccessible] = (__bridge id)accessControlAttr(accessControlLevel_);
        SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    }
}

std::optional<std::string> IOSStorageAdapterCpp::getSecure(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kKeychainService, group);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

    CFTypeRef result = NULL;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)query, &result) == errSecSuccess && result) {
        NSData* data = (__bridge_transfer NSData*)result;
        NSString* str = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (str) return std::string([str UTF8String]);
    }
    return std::nullopt;
}

void IOSStorageAdapterCpp::deleteSecure(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];
    NSMutableDictionary* secureQuery = baseKeychainQuery(nsKey, kKeychainService, group);
    SecItemDelete((__bridge CFDictionaryRef)secureQuery);
    NSMutableDictionary* biometricQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    SecItemDelete((__bridge CFDictionaryRef)biometricQuery);
}

bool IOSStorageAdapterCpp::hasSecure(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];
    NSMutableDictionary* secureQuery = baseKeychainQuery(nsKey, kKeychainService, group);
    if (SecItemCopyMatching((__bridge CFDictionaryRef)secureQuery, NULL) == errSecSuccess) {
        return true;
    }
    NSMutableDictionary* biometricQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    return SecItemCopyMatching((__bridge CFDictionaryRef)biometricQuery, NULL) == errSecSuccess;
}

std::vector<std::string> IOSStorageAdapterCpp::getAllKeysSecure() {
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];
    std::vector<std::string> keys = keychainAccountsForService(kKeychainService, group);
    const std::vector<std::string> biometricKeys = keychainAccountsForService(kBiometricKeychainService, group);
    for (const auto& key : biometricKeys) {
        if (std::find(keys.begin(), keys.end(), key) == keys.end()) {
            keys.push_back(key);
        }
    }
    return keys;
}

size_t IOSStorageAdapterCpp::sizeSecure() {
    return getAllKeysSecure().size();
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
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];
    NSMutableDictionary* secureQuery = [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kKeychainService
    } mutableCopy];
    if (group && group.length > 0) {
        secureQuery[(__bridge id)kSecAttrAccessGroup] = group;
    }
    SecItemDelete((__bridge CFDictionaryRef)secureQuery);

    NSMutableDictionary* biometricQuery = [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kBiometricKeychainService
    } mutableCopy];
    if (group && group.length > 0) {
        biometricQuery[(__bridge id)kSecAttrAccessGroup] = group;
    }
    SecItemDelete((__bridge CFDictionaryRef)biometricQuery);
}

// --- Configuration ---

void IOSStorageAdapterCpp::setSecureAccessControl(int level) {
    accessControlLevel_ = level;
}

void IOSStorageAdapterCpp::setKeychainAccessGroup(const std::string& group) {
    keychainAccessGroup_ = group;
}

// --- Biometric (separate Keychain service with biometric ACL) ---

void IOSStorageAdapterCpp::setSecureBiometric(const std::string& key, const std::string& value) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSData* data = [[NSString stringWithUTF8String:value.c_str()] dataUsingEncoding:NSUTF8StringEncoding];
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];

    // Delete existing item first (access control can't be updated in place)
    NSMutableDictionary* deleteQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    SecItemDelete((__bridge CFDictionaryRef)deleteQuery);

    CFErrorRef error = NULL;
    SecAccessControlRef access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
        kSecAccessControlBiometryCurrentSet,
        &error
    );

    if (error || !access) {
        if (access) CFRelease(access);
        throw std::runtime_error("NitroStorage: Failed to create biometric access control");
    }

    NSMutableDictionary* attrs = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    attrs[(__bridge id)kSecValueData] = data;
    attrs[(__bridge id)kSecAttrAccessControl] = (__bridge_transfer id)access;

    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)attrs, NULL);
    if (status != errSecSuccess) {
        throw std::runtime_error("NitroStorage: Biometric set failed with status " + std::to_string(status));
    }
}

std::optional<std::string> IOSStorageAdapterCpp::getSecureBiometric(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];
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
    if (status == errSecUserCanceled || status == errSecAuthFailed) {
        throw std::runtime_error("NitroStorage: Biometric authentication failed");
    }
    return std::nullopt;
}

void IOSStorageAdapterCpp::deleteSecureBiometric(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    SecItemDelete((__bridge CFDictionaryRef)query);
}

bool IOSStorageAdapterCpp::hasSecureBiometric(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    return SecItemCopyMatching((__bridge CFDictionaryRef)query, NULL) == errSecSuccess;
}

void IOSStorageAdapterCpp::clearSecureBiometric() {
    NSString* group = keychainAccessGroup_.empty() ? nil : [NSString stringWithUTF8String:keychainAccessGroup_.c_str()];
    NSMutableDictionary* query = [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kBiometricKeychainService
    } mutableCopy];
    if (group && group.length > 0) {
        query[(__bridge id)kSecAttrAccessGroup] = group;
    }
    SecItemDelete((__bridge CFDictionaryRef)query);
}

} // namespace NitroStorage
