#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#import <Security/Security.h>

namespace NitroStorage {

IOSStorageAdapterCpp::IOSStorageAdapterCpp() {}

IOSStorageAdapterCpp::~IOSStorageAdapterCpp() {}

void IOSStorageAdapterCpp::setDisk(const std::string& key, const std::string& value) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* nsValue = [NSString stringWithUTF8String:value.c_str()];
    [[NSUserDefaults standardUserDefaults] setObject:nsValue forKey:nsKey];
}

std::optional<std::string> IOSStorageAdapterCpp::getDisk(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* result = [[NSUserDefaults standardUserDefaults] stringForKey:nsKey];
    
    if (result) {
        const char* utf8String = [result UTF8String];
        if (utf8String) {
            std::string value;
            value.reserve([result lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
            value.assign(utf8String);
            return value;
        }
    }
    return std::nullopt;
}

void IOSStorageAdapterCpp::deleteDisk(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    [[NSUserDefaults standardUserDefaults] removeObjectForKey:nsKey];
}

void IOSStorageAdapterCpp::setSecure(const std::string& key, const std::string& value) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* nsValue = [NSString stringWithUTF8String:value.c_str()];
    NSData* data = [nsValue dataUsingEncoding:NSUTF8StringEncoding];
    
    NSString* service = @"com.nitrostorage.keychain";
    
    NSDictionary* query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: service,
        (__bridge id)kSecAttrAccount: nsKey
    };
    
    NSDictionary* updateAttributes = @{
        (__bridge id)kSecValueData: data
    };
    
    // Try to update first (atomic operation)
    OSStatus updateStatus = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)updateAttributes);
    
    if (updateStatus == errSecItemNotFound) {
        // Item doesn't exist, add it
        NSDictionary* addQuery = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: service,
            (__bridge id)kSecAttrAccount: nsKey,
            (__bridge id)kSecValueData: data,
            (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleWhenUnlocked
        };
        
        OSStatus addStatus = SecItemAdd((__bridge CFDictionaryRef)addQuery, NULL);
        if (addStatus != errSecSuccess) {
            NSLog(@"NitroStorage: Failed to add to Keychain for key '%@'. Error: %d", nsKey, (int)addStatus);
        }
    } else if (updateStatus != errSecSuccess) {
        NSLog(@"NitroStorage: Failed to update Keychain item '%@'. Error: %d", nsKey, (int)updateStatus);
    }
}

std::optional<std::string> IOSStorageAdapterCpp::getSecure(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* service = @"com.nitrostorage.keychain";
    
    NSDictionary* query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: service,
        (__bridge id)kSecAttrAccount: nsKey,
        (__bridge id)kSecReturnData: @YES,
        (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne
    };
    
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    
    if (status == errSecSuccess && result) {
        NSData* data = (__bridge_transfer NSData*)result;
        NSString* nsValue = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (nsValue) {
            const char* utf8String = [nsValue UTF8String];
            if (utf8String) {
                std::string value;
                value.reserve([nsValue lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
                value.assign(utf8String);
                return value;
            }
        }
    } else if (status != errSecItemNotFound) {
        NSLog(@"NitroStorage: Failed to read from Keychain for key '%@'. Error: %d", nsKey, (int)status);
    }
    
    return std::nullopt;
}

void IOSStorageAdapterCpp::deleteSecure(const std::string& key) {
    NSString* nsKey = [NSString stringWithUTF8String:key.c_str()];
    NSString* service = @"com.nitrostorage.keychain";
    
    NSDictionary* query = @{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: service,
        (__bridge id)kSecAttrAccount: nsKey
    };
    
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    if (status != errSecSuccess && status != errSecItemNotFound) {
        NSLog(@"NitroStorage: Failed to delete from Keychain for key '%@'. Error: %d", nsKey, (int)status);
    }
}

} // namespace NitroStorage
