#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#import <Security/Security.h>

namespace NitroStorage {

static NSString* const kKeychainService = @"com.nitrostorage.keychain";
static NSString* const kDiskSuiteName = @"com.nitrostorage.disk";

static NSUserDefaults* NitroDiskDefaults() {
    static NSUserDefaults* defaults = [[NSUserDefaults alloc] initWithSuiteName:kDiskSuiteName];
    return defaults ?: [NSUserDefaults standardUserDefaults];
}

IOSStorageAdapterCpp::IOSStorageAdapterCpp() {}
IOSStorageAdapterCpp::~IOSStorageAdapterCpp() {}

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

void IOSStorageAdapterCpp::setSecure(const std::string& key, const std::string& value) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSData* data = [[NSString stringWithUTF8String:value.c_str()] dataUsingEncoding:NSUTF8StringEncoding];

    NSDictionary* query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kKeychainService,
        (__bridge id)kSecAttrAccount: nsKey
    };

    NSDictionary* updateAttributes = @{
        (__bridge id)kSecValueData: data
    };

    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)updateAttributes);

    if (status == errSecItemNotFound) {
        NSMutableDictionary* addQuery = [query mutableCopy];
        addQuery[(__bridge id)kSecValueData] = data;
        addQuery[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlocked;
        SecItemAdd((__bridge CFDictionaryRef)addQuery, NULL);
    }
}

std::optional<std::string> IOSStorageAdapterCpp::getSecure(const std::string& key) {
    NSDictionary* query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kKeychainService,
        (__bridge id)kSecAttrAccount: [NSString stringWithUTF8String:key.c_str()],
        (__bridge id)kSecReturnData: @YES,
        (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne
    };

    CFTypeRef result = NULL;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)query, &result) == errSecSuccess && result) {
        NSData* data = (__bridge_transfer NSData*)result;
        NSString* str = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (str) return std::string([str UTF8String]);
    }
    return std::nullopt;
}

void IOSStorageAdapterCpp::deleteSecure(const std::string& key) {
    NSDictionary* query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kKeychainService,
        (__bridge id)kSecAttrAccount: [NSString stringWithUTF8String:key.c_str()]
    };
    SecItemDelete((__bridge CFDictionaryRef)query);
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

void IOSStorageAdapterCpp::clearDisk() {
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSDictionary<NSString*, id>* entries = [defaults dictionaryRepresentation];
    for (NSString* key in entries) {
        [defaults removeObjectForKey:key];
    }
}

void IOSStorageAdapterCpp::clearSecure() {
    NSDictionary* query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: kKeychainService
    };
    SecItemDelete((__bridge CFDictionaryRef)query);
}

} // namespace NitroStorage
