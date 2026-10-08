#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#import <Security/Security.h>

#include <algorithm>
#include <atomic>
#include <cstdlib>
#include <deque>
#include <functional>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using NitroStorage::IOSStorageAdapterCpp;

namespace {

constexpr OSStatus kRunFake = 1;

struct FakeKeychain {
    std::mutex mutex;
    NSMutableDictionary<NSString*, NSMutableDictionary*>* items = [NSMutableDictionary dictionary];
    std::deque<OSStatus> copyScript;
    std::deque<OSStatus> addScript;
    std::deque<OSStatus> updateScript;
    std::deque<OSStatus> deleteScript;
    std::vector<std::string> calls;
    NSDictionary* lastAddAttributes = nil;
    NSDictionary* lastUpdateAttributes = nil;
    NSDictionary* lastQuery = nil;
    bool returnNullResult = false;
};

FakeKeychain& keychain() {
    static FakeKeychain* instance = new FakeKeychain();
    return *instance;
}

NSString* itemKey(NSString* service, NSString* account) {
    return [NSString stringWithFormat:@"%@\n%@", service, account];
}

OSStatus nextStatus(std::deque<OSStatus>& script) {
    if (script.empty()) {
        return kRunFake;
    }
    const OSStatus status = script.front();
    script.pop_front();
    return status;
}

void resetKeychain() {
    FakeKeychain& fake = keychain();
    std::lock_guard<std::mutex> lock(fake.mutex);
    [fake.items removeAllObjects];
    fake.copyScript.clear();
    fake.addScript.clear();
    fake.updateScript.clear();
    fake.deleteScript.clear();
    fake.calls.clear();
    fake.lastAddAttributes = nil;
    fake.lastUpdateAttributes = nil;
    fake.lastQuery = nil;
    fake.returnNullResult = false;
}

void require(bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "IOSStorageAdapter keychain test assertion failed: " << message << std::endl;
        std::abort();
    }
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

bool contains(const std::vector<std::string>& values, const std::string& value) {
    return std::find(values.begin(), values.end(), value) != values.end();
}

const std::string kLocked = "[nitro-error:keychain_locked] NitroStorage: ";
const std::string kAuthRequired = "[nitro-error:authentication_required] NitroStorage: ";
NSString* const kPlainService = @"com.nitrostorage.keychain";
NSString* const kBiometricService = @"com.nitrostorage.biometric";

void seed(NSString* service, const char* account, NSData* data, id accessControl) {
    FakeKeychain& fake = keychain();
    std::lock_guard<std::mutex> lock(fake.mutex);
    NSMutableDictionary* item = [NSMutableDictionary dictionary];
    item[(__bridge id)kSecAttrAccount] = @(account);
    item[(__bridge id)kSecValueData] = data;
    if (accessControl) {
        item[(__bridge id)kSecAttrAccessControl] = accessControl;
    }
    fake.items[itemKey(service, @(account))] = item;
}

bool stored(NSString* service, const char* account) {
    FakeKeychain& fake = keychain();
    std::lock_guard<std::mutex> lock(fake.mutex);
    return fake.items[itemKey(service, @(account))] != nil;
}

void script(std::deque<OSStatus>& target, std::initializer_list<OSStatus> statuses) {
    FakeKeychain& fake = keychain();
    std::lock_guard<std::mutex> lock(fake.mutex);
    target.assign(statuses);
}

} // namespace

extern "C" {

OSStatus SecItemCopyMatching(CFDictionaryRef query, CFTypeRef* result) {
    FakeKeychain& fake = keychain();
    std::lock_guard<std::mutex> lock(fake.mutex);
    NSDictionary* nsQuery = (__bridge NSDictionary*)query;
    fake.calls.push_back("copy");
    fake.lastQuery = [nsQuery copy];
    const OSStatus scripted = nextStatus(fake.copyScript);
    if (scripted != kRunFake) {
        return scripted;
    }
    NSString* service = nsQuery[(__bridge id)kSecAttrService];
    NSString* account = nsQuery[(__bridge id)kSecAttrAccount];
    if (account == nil) {
        NSMutableArray* matches = [NSMutableArray array];
        NSString* prefix = [service stringByAppendingString:@"\n"];
        for (NSString* key in fake.items) {
            if ([key hasPrefix:prefix]) {
                [matches addObject:@{
                    (__bridge id)kSecAttrAccount: fake.items[key][(__bridge id)kSecAttrAccount]
                }];
            }
        }
        if (matches.count == 0) {
            return errSecItemNotFound;
        }
        if (result != NULL) {
            *result = CFBridgingRetain(matches.count == 1 ? matches[0] : matches);
        }
        return errSecSuccess;
    }
    NSDictionary* item = fake.items[itemKey(service, account)];
    if (item == nil) {
        return errSecItemNotFound;
    }
    if (result == NULL) {
        return errSecSuccess;
    }
    if (fake.returnNullResult) {
        *result = NULL;
        return errSecSuccess;
    }
    if ([nsQuery[(__bridge id)kSecReturnAttributes] boolValue]) {
        *result = CFBridgingRetain([item copy]);
    } else {
        *result = CFBridgingRetain(item[(__bridge id)kSecValueData]);
    }
    return errSecSuccess;
}

OSStatus SecItemAdd(CFDictionaryRef attributes, CFTypeRef*) {
    FakeKeychain& fake = keychain();
    std::lock_guard<std::mutex> lock(fake.mutex);
    NSDictionary* nsAttributes = (__bridge NSDictionary*)attributes;
    fake.calls.push_back("add");
    fake.lastAddAttributes = [nsAttributes copy];
    const OSStatus scripted = nextStatus(fake.addScript);
    if (scripted != kRunFake) {
        return scripted;
    }
    NSString* key = itemKey(
        nsAttributes[(__bridge id)kSecAttrService],
        nsAttributes[(__bridge id)kSecAttrAccount]
    );
    if (fake.items[key] != nil) {
        return errSecDuplicateItem;
    }
    fake.items[key] = [nsAttributes mutableCopy];
    return errSecSuccess;
}

OSStatus SecItemUpdate(CFDictionaryRef query, CFDictionaryRef attributesToUpdate) {
    FakeKeychain& fake = keychain();
    std::lock_guard<std::mutex> lock(fake.mutex);
    NSDictionary* nsQuery = (__bridge NSDictionary*)query;
    fake.calls.push_back("update");
    fake.lastQuery = [nsQuery copy];
    fake.lastUpdateAttributes = [(__bridge NSDictionary*)attributesToUpdate copy];
    const OSStatus scripted = nextStatus(fake.updateScript);
    if (scripted != kRunFake) {
        return scripted;
    }
    NSMutableDictionary* item = fake.items[itemKey(
        nsQuery[(__bridge id)kSecAttrService],
        nsQuery[(__bridge id)kSecAttrAccount]
    )];
    if (item == nil) {
        return errSecItemNotFound;
    }
    [item addEntriesFromDictionary:(__bridge NSDictionary*)attributesToUpdate];
    return errSecSuccess;
}

OSStatus SecItemDelete(CFDictionaryRef query) {
    FakeKeychain& fake = keychain();
    std::lock_guard<std::mutex> lock(fake.mutex);
    NSDictionary* nsQuery = (__bridge NSDictionary*)query;
    fake.calls.push_back("delete");
    fake.lastQuery = [nsQuery copy];
    const OSStatus scripted = nextStatus(fake.deleteScript);
    if (scripted != kRunFake) {
        return scripted;
    }
    NSString* service = nsQuery[(__bridge id)kSecAttrService];
    NSString* account = nsQuery[(__bridge id)kSecAttrAccount];
    if (account != nil) {
        NSString* key = itemKey(service, account);
        if (fake.items[key] == nil) {
            return errSecItemNotFound;
        }
        [fake.items removeObjectForKey:key];
        return errSecSuccess;
    }
    NSString* prefix = [service stringByAppendingString:@"\n"];
    NSMutableArray* doomed = [NSMutableArray array];
    for (NSString* key in fake.items) {
        if ([key hasPrefix:prefix]) {
            [doomed addObject:key];
        }
    }
    if (doomed.count == 0) {
        return errSecItemNotFound;
    }
    [fake.items removeObjectsForKeys:doomed];
    return errSecSuccess;
}

} // extern "C"

namespace {

struct KeychainOperation {
    std::string name;
    std::string statusLabel;
    std::deque<OSStatus>* script;
    size_t failingCallIndex;
    std::function<void(IOSStorageAdapterCpp&)> run;
    bool interactionNotAllowedMeansPresent;
};

std::vector<KeychainOperation> keychainOperations() {
    FakeKeychain& fake = keychain();
    return {
        {"setSecure update", "Secure set", &fake.updateScript, 0,
            [](IOSStorageAdapterCpp& a) { a.setSecure("k", "v"); }, false},
        {"setSecure add", "Secure set", &fake.addScript, 0,
            [](IOSStorageAdapterCpp& a) { a.setSecure("missing", "v"); }, false},
        {"getSecure", "Secure get", &fake.copyScript, 0,
            [](IOSStorageAdapterCpp& a) { (void)a.getSecure("k"); }, false},
        {"deleteSecure plain", "Secure delete", &fake.deleteScript, 0,
            [](IOSStorageAdapterCpp& a) { a.deleteSecure("k"); }, false},
        {"deleteSecure biometric", "Biometric delete", &fake.deleteScript, 1,
            [](IOSStorageAdapterCpp& a) { a.deleteSecure("k"); }, false},
        {"hasSecure plain", "Secure has", &fake.copyScript, 0,
            [](IOSStorageAdapterCpp& a) { (void)a.hasSecure("missing"); }, false},
        {"hasSecure biometric", "Secure has", &fake.copyScript, 1,
            [](IOSStorageAdapterCpp& a) {
                if (!a.hasSecure("missing")) {
                    throw std::runtime_error("unexpected absent");
                }
            }, true},
        {"getAllKeysSecure plain", "Secure key enumeration", &fake.copyScript, 0,
            [](IOSStorageAdapterCpp& a) { (void)a.getAllKeysSecure(); }, false},
        {"getAllKeysSecure biometric", "Secure key enumeration", &fake.copyScript, 1,
            [](IOSStorageAdapterCpp& a) { (void)a.getAllKeysSecure(); }, false},
        {"sizeSecure", "Secure key enumeration", &fake.copyScript, 0,
            [](IOSStorageAdapterCpp& a) { (void)a.sizeSecure(); }, false},
        {"getKeysByPrefixSecure", "Secure key enumeration", &fake.copyScript, 0,
            [](IOSStorageAdapterCpp& a) { (void)a.getKeysByPrefixSecure("k"); }, false},
        {"clearSecure plain", "clearSecure", &fake.deleteScript, 0,
            [](IOSStorageAdapterCpp& a) { a.clearSecure(); }, false},
        {"clearSecure biometric", "clearSecureBiometric", &fake.deleteScript, 1,
            [](IOSStorageAdapterCpp& a) { a.clearSecure(); }, false},
        {"getSecureBatch", "Secure get", &fake.copyScript, 1,
            [](IOSStorageAdapterCpp& a) { (void)a.getSecureBatch({"k", "k2"}); }, false},
        {"getSecureBiometric", "Biometric get", &fake.copyScript, 0,
            [](IOSStorageAdapterCpp& a) { (void)a.getSecureBiometric("k"); }, false},
        {"hasSecureBiometric", "Biometric has", &fake.copyScript, 0,
            [](IOSStorageAdapterCpp& a) { (void)a.hasSecureBiometric("k"); }, false},
        {"deleteSecureBiometric", "Biometric delete", &fake.deleteScript, 0,
            [](IOSStorageAdapterCpp& a) { a.deleteSecureBiometric("k"); }, false},
        {"clearSecureBiometric", "clearSecureBiometric", &fake.deleteScript, 0,
            [](IOSStorageAdapterCpp& a) { a.clearSecureBiometric(); }, false},
        {"setSecureBiometricWithLevel snapshot", "Biometric snapshot", &fake.copyScript, 0,
            [](IOSStorageAdapterCpp& a) { a.setSecureBiometricWithLevel("k", "v", 2); }, false},
        {"setSecureBiometricWithLevel plain read", "Secure get", &fake.copyScript, 1,
            [](IOSStorageAdapterCpp& a) { a.setSecureBiometricWithLevel("k", "v", 2); }, false},
    };
}

void armFailure(const KeychainOperation& operation, OSStatus status) {
    FakeKeychain& fake = keychain();
    std::lock_guard<std::mutex> lock(fake.mutex);
    operation.script->clear();
    for (size_t index = 0; index < operation.failingCallIndex; ++index) {
        operation.script->push_back(kRunFake);
    }
    operation.script->push_back(status);
}

void testKeychainStatusMappingForEveryOperation() {
    const std::vector<OSStatus> untagged = {
        errSecDuplicateItem,
        errSecDecode,
        errSecParam,
        errSecAllocate,
        errSecMissingEntitlement,
        errSecIO,
        errSecUnimplemented,
        -1,
    };
    NSData* value = [@"value" dataUsingEncoding:NSUTF8StringEncoding];
    for (const auto& operation : keychainOperations()) {
        const bool biometricGet = operation.name == "getSecureBiometric";

        for (const OSStatus status : {errSecInteractionNotAllowed, errSecNotAvailable}) {
            resetKeychain();
            seed(kPlainService, "k", value, nil);
            IOSStorageAdapterCpp adapter;
            armFailure(operation, status);
            const std::string message = failureMessage([&] { operation.run(adapter); });
            if (status == errSecInteractionNotAllowed && operation.interactionNotAllowedMeansPresent) {
                require(message.empty(), operation.name + " treats a locked biometric item as present: " + message);
                continue;
            }
            require(
                startsWith(message, kLocked),
                operation.name + " must map status " + std::to_string(status) + " to keychain_locked, got: " + message
            );
        }

        for (const OSStatus status : {errSecUserCanceled, errSecAuthFailed}) {
            resetKeychain();
            seed(kPlainService, "k", value, nil);
            IOSStorageAdapterCpp adapter;
            armFailure(operation, status);
            const std::string message = failureMessage([&] { operation.run(adapter); });
            if (biometricGet) {
                require(
                    message == kAuthRequired + "Biometric authentication failed",
                    "biometric get must map status " + std::to_string(status) + ", got: " + message
                );
            } else {
                require(
                    message == "NitroStorage: " + operation.statusLabel + " failed with status " + std::to_string(status),
                    operation.name + " must keep status " + std::to_string(status) + " untagged, got: " + message
                );
            }
        }

        for (const OSStatus status : untagged) {
            resetKeychain();
            seed(kPlainService, "k", value, nil);
            IOSStorageAdapterCpp adapter;
            armFailure(operation, status);
            const std::string message = failureMessage([&] { operation.run(adapter); });
            require(
                message == "NitroStorage: " + operation.statusLabel + " failed with status " + std::to_string(status),
                operation.name + " must report status " + std::to_string(status) + ", got: " + message
            );
        }
    }
}

void testSecureRoundTripAgainstFakeKeychain() {
    resetKeychain();
    IOSStorageAdapterCpp adapter;
    require(!adapter.getSecure("missing").has_value(), "missing item reads as null");
    require(!adapter.hasSecure("missing"), "missing item is absent");
    adapter.deleteSecure("missing");
    require(adapter.sizeSecure() == 0 && adapter.getAllKeysSecure().empty(), "empty keychain enumerates empty");

    const std::string nulValue("a\0b", 3);
    adapter.setSecure("token", "one");
    adapter.setSecure("token", "two");
    adapter.setSecure("nul", nulValue);
    adapter.setSecure("", "empty-key");
    adapter.setSecure("empty-value", "");
    require(adapter.getSecure("token").value() == "two", "update replaces the value");
    require(adapter.getSecure("nul").value() == nulValue, "NUL value round trip");
    require(adapter.getSecure("").value() == "empty-key", "empty key round trip");
    require(adapter.getSecure("empty-value").value().empty(), "empty value is present");
    require(adapter.hasSecure("empty-value"), "empty value counts as present");
    require(adapter.sizeSecure() == 4, "cache follows writes");
    require(adapter.getKeysByPrefixSecure("to") == std::vector<std::string>{"token"}, "prefix query");

    const auto batch = adapter.getSecureBatch({"token", "missing", "nul"});
    require(batch[0].value() == "two" && !batch[1] && batch[2].value() == nulValue, "batch read");
    adapter.setSecureBatch({"b1", "b2"}, {"1", "2"});
    adapter.deleteSecureBatch({"b1", "missing"});
    require(!adapter.hasSecure("b1") && adapter.hasSecure("b2"), "batch delete tolerates missing keys");

    IOSStorageAdapterCpp second;
    require(second.sizeSecure() == 5, "a new adapter hydrates from the keychain");
    adapter.clearSecure();
    require(adapter.sizeSecure() == 0, "clear empties the cache");
    require(!stored(kPlainService, "token"), "clear deletes keychain items");

    const std::string invalidUtf8("\xff\xfe", 2);
    const size_t callsBefore = keychain().calls.size();
    for (const auto& operation : std::vector<std::function<void()>>{
        [&] { adapter.setSecure(invalidUtf8, "v"); },
        [&] { adapter.setSecure("k", invalidUtf8); },
        [&] { (void)adapter.getSecure(invalidUtf8); },
        [&] { adapter.deleteSecure(invalidUtf8); },
        [&] { (void)adapter.hasSecure(invalidUtf8); },
        [&] { (void)adapter.getSecureBiometric(invalidUtf8); },
        [&] { adapter.setSecureBiometricWithLevel(invalidUtf8, "v", 2); },
        [&] { adapter.setKeychainAccessGroup("ok"); adapter.setKeychainAccessGroup(invalidUtf8); (void)adapter.getSecure("k"); },
    }) {
        require(
            failureMessage(operation) == "NitroStorage: String is not valid UTF-8",
            "invalid UTF-8 must be rejected before the keychain"
        );
    }
    require(keychain().calls.size() == callsBefore, "invalid UTF-8 must not reach the keychain");
}

void testUndecodableKeychainDataIsReportedAsCorruption() {
    resetKeychain();
    const unsigned char bytes[] = {0xff, 0xfe, 0xfd};
    seed(kPlainService, "binary", [NSData dataWithBytes:bytes length:3], nil);
    seed(kBiometricService, "binary", [NSData dataWithBytes:bytes length:3], nil);
    IOSStorageAdapterCpp adapter;
    const std::string secure =
        "[nitro-error:storage_corruption] NitroStorage: Secure get failed: "
        "the Keychain item has no data or is not valid UTF-8 text.";
    const std::string biometric =
        "[nitro-error:storage_corruption] NitroStorage: Biometric get failed: "
        "the Keychain item has no data or is not valid UTF-8 text.";
    require(failureMessage([&] { (void)adapter.getSecure("binary"); }) == secure, "non UTF-8 keychain data");
    require(failureMessage([&] { (void)adapter.getSecureBatch({"binary"}); }) == secure, "non UTF-8 batch data");
    require(
        failureMessage([&] { (void)adapter.getSecureBiometric("binary"); }) == biometric,
        "non UTF-8 biometric data"
    );
    keychain().returnNullResult = true;
    require(failureMessage([&] { (void)adapter.getSecure("binary"); }) == secure, "success without data");
    require(
        failureMessage([&] { (void)adapter.getSecureBiometric("binary"); }) == biometric,
        "biometric success without data"
    );
    keychain().returnNullResult = false;
    require(adapter.hasSecure("binary"), "undecodable item is still present");
    adapter.deleteSecure("binary");
    require(!adapter.hasSecure("binary"), "undecodable item can be deleted");
    adapter.setSecure("binary", "text");
    require(adapter.getSecure("binary").value() == "text", "undecodable item can be replaced");
}

void testLockedEnumerationIsRetriedAndPartialBatchesReportProgress() {
    resetKeychain();
    NSData* value = [@"value" dataUsingEncoding:NSUTF8StringEncoding];
    seed(kPlainService, "a", value, nil);
    seed(kBiometricService, "b", value, nil);
    IOSStorageAdapterCpp adapter;
    script(keychain().copyScript, {errSecInteractionNotAllowed});
    require(startsWith(failureMessage([&] { (void)adapter.getAllKeysSecure(); }), kLocked), "locked enumeration");
    const auto keys = adapter.getAllKeysSecure();
    require(keys.size() == 2 && contains(keys, "a") && contains(keys, "b"), "enumeration retries after unlock");

    script(keychain().updateScript, {kRunFake, kRunFake, errSecInteractionNotAllowed});
    bool partial = false;
    try {
        adapter.setSecureBatch({"s1", "s2", "s3", "s4"}, {"1", "2", "3", "4"});
    } catch (const NitroStorage::PartialBatchError& error) {
        partial = error.appliedCount() == 2 && startsWith(error.what(), kLocked);
    }
    require(partial, "setSecureBatch must report the applied count with the tag");
    require(stored(kPlainService, "s1") && stored(kPlainService, "s2"), "applied keys stay written");
    require(!stored(kPlainService, "s3") && !stored(kPlainService, "s4"), "remaining keys are not written");
    require(adapter.sizeSecure() == 4, "cache tracks only applied keys");

    script(keychain().deleteScript, {kRunFake, kRunFake, errSecNotAvailable});
    partial = false;
    try {
        adapter.deleteSecureBatch({"s1", "s2"});
    } catch (const NitroStorage::PartialBatchError& error) {
        partial = error.appliedCount() == 1 && startsWith(error.what(), kLocked);
    }
    require(partial, "deleteSecureBatch must report the applied count with the tag");
    require(!stored(kPlainService, "s1") && stored(kPlainService, "s2"), "only applied deletes happen");

    script(keychain().deleteScript, {errSecInteractionNotAllowed});
    require(startsWith(failureMessage([&] { adapter.clearSecure(); }), kLocked), "locked clear");
    require(adapter.sizeSecure() == 3, "failed clear must keep the key cache");
}

void testAccessibilityAndAccessGroupReachTheKeychain() {
    const std::vector<std::pair<int, CFStringRef>> levels = {
        {0, kSecAttrAccessibleWhenUnlocked},
        {1, kSecAttrAccessibleAfterFirstUnlock},
        {2, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly},
        {3, kSecAttrAccessibleWhenUnlockedThisDeviceOnly},
        {4, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly},
        {99, kSecAttrAccessibleAfterFirstUnlock},
        {-1, kSecAttrAccessibleAfterFirstUnlock},
    };
    for (const auto& [level, expected] : levels) {
        resetKeychain();
        IOSStorageAdapterCpp adapter;
        adapter.setSecureAccessControl(level);
        adapter.setSecure("k", "v");
        id accessible = keychain().lastAddAttributes[(__bridge id)kSecAttrAccessible];
        require(
            [accessible isEqual:(__bridge id)expected],
            "access control level " + std::to_string(level) + " must select its accessibility class"
        );
        require(keychain().lastAddAttributes[(__bridge id)kSecAttrAccessGroup] == nil, "no group by default");
    }

    resetKeychain();
    IOSStorageAdapterCpp adapter;
    adapter.setSecure("before", "v");
    require(adapter.sizeSecure() == 1, "cache hydrated before the group change");
    adapter.setKeychainAccessGroup("group.example");
    adapter.setSecure("k", "v");
    require(
        [keychain().lastAddAttributes[(__bridge id)kSecAttrAccessGroup] isEqual:@"group.example"],
        "access group must be sent with writes"
    );
    (void)adapter.getSecure("k");
    require(
        [keychain().lastQuery[(__bridge id)kSecAttrAccessGroup] isEqual:@"group.example"],
        "access group must be sent with reads"
    );
    adapter.setSecureWritesAsync(true);
    adapter.setKeychainAccessGroup("");
    (void)adapter.getSecure("k");
    require(keychain().lastQuery[(__bridge id)kSecAttrAccessGroup] == nil, "empty group removes the attribute");
}

void testRewritingAnExistingItemMigratesItsAccessibilityClass() {
    const std::vector<std::pair<int, CFStringRef>> levels = {
        {0, kSecAttrAccessibleWhenUnlocked},
        {1, kSecAttrAccessibleAfterFirstUnlock},
        {2, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly},
        {3, kSecAttrAccessibleWhenUnlockedThisDeviceOnly},
        {4, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly},
        {99, kSecAttrAccessibleAfterFirstUnlock},
        {-1, kSecAttrAccessibleAfterFirstUnlock},
    };
    for (const auto& [level, expected] : levels) {
        const std::string label = "access control level " + std::to_string(level);
        resetKeychain();
        IOSStorageAdapterCpp adapter;
        adapter.setSecure("k", "first");
        adapter.setSecureAccessControl(level);
        keychain().lastAddAttributes = nil;

        adapter.setSecure("k", "second");

        require(keychain().lastAddAttributes == nil, label + ": rewrite must update, not add");
        require(keychain().lastUpdateAttributes != nil, label + ": rewrite must call SecItemUpdate");
        id accessible = keychain().lastUpdateAttributes[(__bridge id)kSecAttrAccessible];
        require(
            [accessible isEqual:(__bridge id)expected],
            label + ": SecItemUpdate must carry the accessibility class"
        );
        NSData* data = keychain().lastUpdateAttributes[(__bridge id)kSecValueData];
        require(
            [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] isEqualToString:@"second"],
            label + ": SecItemUpdate must carry the value"
        );
        FakeKeychain& fake = keychain();
        id storedClass = fake.items[itemKey(kPlainService, @"k")][(__bridge id)kSecAttrAccessible];
        require([storedClass isEqual:(__bridge id)expected], label + ": stored item migrates to the class");
        require(adapter.getSecure("k").value() == "second", label + ": value survives the rewrite");
    }

    resetKeychain();
    IOSStorageAdapterCpp adapter;
    adapter.setSecureAccessControl(0);
    adapter.setSecureBatch({"a", "b"}, {"1", "2"});
    adapter.setSecureAccessControl(4);
    keychain().lastUpdateAttributes = nil;
    adapter.setSecureBatch({"a", "b"}, {"1", "2"});
    require(
        [keychain().lastUpdateAttributes[(__bridge id)kSecAttrAccessible]
            isEqual:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly],
        "batch rewrites must carry the accessibility class"
    );
}

void testLockedRewriteKeepsTheExistingItemUntouched() {
    resetKeychain();
    IOSStorageAdapterCpp adapter;
    adapter.setSecure("k", "first");
    adapter.setSecureAccessControl(1);
    script(keychain().updateScript, {errSecInteractionNotAllowed});

    require(startsWith(failureMessage([&] { adapter.setSecure("k", "first"); }), kLocked), "locked rewrite is tagged");

    FakeKeychain& fake = keychain();
    id storedClass = fake.items[itemKey(kPlainService, @"k")][(__bridge id)kSecAttrAccessible];
    require([storedClass isEqual:(__bridge id)kSecAttrAccessibleWhenUnlocked], "locked rewrite keeps the old class");
    require(adapter.getSecure("k").value() == "first", "locked rewrite keeps the value");
    require(std::count(fake.calls.begin(), fake.calls.end(), std::string("delete")) == 0, "locked rewrite never deletes");
}

void testBiometricPromotionCompensatesOnFailure() {
    resetKeychain();
    IOSStorageAdapterCpp adapter;
    for (const int level : {-1, 3, 100}) {
        require(
            failureMessage([&] { adapter.setSecureBiometricWithLevel("k", "v", level); }) ==
                "NitroStorage: Invalid biometric level",
            "invalid biometric level must be rejected"
        );
    }
    require(keychain().calls.empty(), "invalid biometric level must not reach the keychain");

    adapter.setSecure("token", "plain");
    adapter.setSecureBiometric("token", "secret");
    require(!stored(kPlainService, "token"), "promotion removes the plain copy");
    require(stored(kBiometricService, "token"), "promotion writes the biometric copy");
    require(keychain().lastAddAttributes[(__bridge id)kSecAttrAccessControl] != nil, "biometric item has an ACL");
    require(adapter.getSecureBiometric("token").value() == "secret", "biometric read");
    require(adapter.hasSecureBiometric("token") && adapter.hasSecure("token"), "biometric item is present");
    require(contains(adapter.getAllKeysSecure(), "token") && adapter.sizeSecure() == 1, "enumerated once");

    adapter.setSecureBiometricWithLevel("token", "user-presence", 1);
    require(adapter.getSecureBiometric("token").value() == "user-presence", "level 1 replaces the item");

    script(keychain().addScript, {errSecInteractionNotAllowed});
    const std::string locked = failureMessage([&] { adapter.setSecureBiometricWithLevel("token", "next", 2); });
    require(startsWith(locked, kLocked), "locked biometric add keeps its tag: " + locked);
    require(adapter.getSecureBiometric("token").value() == "user-presence", "failed promotion restores the old item");

    script(keychain().addScript, {errSecAuthFailed, errSecAuthFailed});
    const std::string compensation = failureMessage([&] {
        adapter.setSecureBiometricWithLevel("token", "next", 2);
    });
    require(
        compensation ==
            "[nitro-error:storage_compensation_failed] NitroStorage: Biometric promotion failed; rollback_error_count=1",
        "failed rollback must be reported: " + compensation
    );

    resetKeychain();
    IOSStorageAdapterCpp demoting;
    demoting.setSecureBiometric("token", "secret");
    demoting.setSecureBiometricWithLevel("token", "plain", 0);
    require(!stored(kBiometricService, "token") && stored(kPlainService, "token"), "level 0 demotes to plain");
    require(demoting.getSecure("token").value() == "plain", "demoted value is readable");

    demoting.setSecureBiometric("token", "secret");
    script(keychain().updateScript, {errSecDecode});
    const std::string demotion = failureMessage([&] { demoting.setSecureBiometricWithLevel("token", "plain", 0); });
    require(
        demotion == "NitroStorage: Secure set failed with status " + std::to_string(errSecDecode),
        "failed demotion reports the primary error: " + demotion
    );
    require(demoting.getSecureBiometric("token").value() == "secret", "failed demotion restores the biometric item");

    demoting.deleteSecure("token");
    require(!demoting.hasSecure("token") && !demoting.hasSecureBiometric("token"), "delete removes both copies");
    demoting.setSecureBiometric("a", "1");
    demoting.setSecureBiometric("b", "2");
    demoting.deleteSecureBiometric("a");
    demoting.clearSecureBiometric();
    require(!stored(kBiometricService, "b") && demoting.sizeSecure() == 0, "biometric clear removes every item");
}

void testConcurrentSecureAccess() {
    resetKeychain();
    IOSStorageAdapterCpp adapter;
    std::atomic<int> failures{0};
    std::vector<std::thread> threads;
    for (int thread = 0; thread < 6; ++thread) {
        threads.emplace_back([&adapter, &failures, thread] {
            for (int iteration = 0; iteration < 40; ++iteration) {
                const std::string key = "t" + std::to_string(thread) + "-" + std::to_string(iteration % 4);
                try {
                    adapter.setSecure(key, std::to_string(iteration));
                    if (adapter.getSecure(key).value() != std::to_string(iteration)) {
                        failures.fetch_add(1);
                    }
                    (void)adapter.getAllKeysSecure();
                    (void)adapter.sizeSecure();
                    if (iteration % 5 == 0) {
                        adapter.setKeychainAccessGroup("");
                        adapter.setSecureAccessControl(iteration % 5);
                    }
                    if (iteration % 3 == 0) {
                        adapter.deleteSecure(key);
                    }
                } catch (const std::exception&) {
                    failures.fetch_add(1);
                }
            }
        });
    }
    for (auto& thread : threads) {
        thread.join();
    }
    require(failures.load() == 0, "concurrent secure access must not fail");
}

} // namespace

int main() {
    @autoreleasepool {
        testSecureRoundTripAgainstFakeKeychain();
        testKeychainStatusMappingForEveryOperation();
        testUndecodableKeychainDataIsReportedAsCorruption();
        testLockedEnumerationIsRetriedAndPartialBatchesReportProgress();
        testAccessibilityAndAccessGroupReachTheKeychain();
        testRewritingAnExistingItemMigratesItsAccessibilityClass();
        testLockedRewriteKeepsTheExistingItemUntouched();
        testBiometricPromotionCompensatesOnFailure();
        testConcurrentSecureAccess();
        std::cout << "IOSStorageAdapterCpp keychain tests passed." << std::endl;
    }
    return 0;
}
