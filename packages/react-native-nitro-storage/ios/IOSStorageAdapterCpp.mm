#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#import <Security/Security.h>

namespace NitroStorage {

static NSString* const kKeychainService = @"com.nitrostorage.keychain";

IOSStorageAdapterCpp::IOSStorageAdapterCpp() {}
IOSStorageAdapterCpp::~IOSStorageAdapterCpp() {}

void IOSStorageAdapterCpp::setDisk(const std::string& key, const std::string& value) {
    [[NSUserDefaults standardUserDefaults] setObject:[NSString stringWithUTF8String:value.c_str()]
                                              forKey:[NSString stringWithUTF8String:key.c_str()]];
}

std::optional<std::string> IOSStorageAdapterCpp::getDisk(const std::string& key) {
    NSString* result = [[NSUserDefaults standardUserDefaults] stringForKey:[NSString stringWithUTF8String:key.c_str()]];
    if (!result) return std::nullopt;
    return std::string([result UTF8String]);
}

void IOSStorageAdapterCpp::deleteDisk(const std::string& key) {
    [[NSUserDefaults standardUserDefaults] removeObjectForKey:[NSString stringWithUTF8String:key.c_str()]];
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

void IOSStorageAdapterCpp::clearDisk() {
    NSString* appDomain = [[NSBundle mainBundle] bundleIdentifier];
    if (appDomain) {
        [[NSUserDefaults standardUserDefaults] removePersistentDomainForName:appDomain];
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
