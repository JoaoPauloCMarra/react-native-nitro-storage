#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#endif

#include "SqliteDiskStore.hpp"

#include <chrono>
#include <future>
#include <unordered_set>
#include <utility>
#include <vector>

#import <objc/message.h>

namespace NitroStorage {

// Storage strings are length-delimited; C-string conversion aliases keys at NUL.
static NSString* nsStringFromStdString(const std::string& value) {
    NSString* result = [[NSString alloc] initWithBytes:value.data()
        length:value.size() encoding:NSUTF8StringEncoding];
    if (!result) {
        throw std::runtime_error("NitroStorage: String is not valid UTF-8");
    }
    return result;
}

static std::string stdStringFromNSString(NSString* value) {
    const char* bytes = [value UTF8String];
    if (!bytes) {
        throw std::runtime_error("NitroStorage: String cannot be encoded as UTF-8");
    }
    return std::string(bytes, [value lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
}

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

static NSSet<NSString*>* registeredLegacyDiskKeys() {
    NSArray* stored = [NitroDiskDefaults() stringArrayForKey:kLegacyDiskKeysRegistryKey];
    return stored ? [NSSet setWithArray:stored] : [NSSet set];
}

static void persistLegacyDiskKeys(NSSet<NSString*>* keys) {
    NSUserDefaults* defaults = NitroDiskDefaults();
    if (keys.count == 0) {
        [defaults removeObjectForKey:kLegacyDiskKeysRegistryKey];
        return;
    }
    [defaults setObject:[keys allObjects] forKey:kLegacyDiskKeysRegistryKey];
}

static void registerLegacyDiskKey(NSString* key) {
    NSMutableSet* keys = [registeredLegacyDiskKeys() mutableCopy];
    [keys addObject:key];
    persistLegacyDiskKeys(keys);
}

static void unregisterLegacyDiskKeys(NSArray<NSString*>* keys) {
    if (keys.count == 0) {
        return;
    }
    NSMutableSet* registered = [registeredLegacyDiskKeys() mutableCopy];
    BOOL changed = NO;
    for (NSString* key in keys) {
        if ([registered containsObject:key]) {
            [registered removeObject:key];
            changed = YES;
        }
    }
    if (changed) {
        persistLegacyDiskKeys(registered);
    }
}

// --- Legacy disk key migration ---
// Versions before the suite domain stored Disk values in standardUserDefaults.
// A conservative, retryable cutover runs before the first Disk operation. A valid
// registry is copied into the suite domain and each source is removed only
// after a target readback confirms the copy. Malformed registries, fallback
// domains, and persistence failures remain untouched for a later retry.

static NSString* const kLegacyDiskMigrationMarkerKey =
    @"__nitro_storage_legacy_disk_migration_v1__";

static std::string ResolveNitroDiskStorePath() {
    NSArray<NSURL*>* urls = [[NSFileManager defaultManager]
        URLsForDirectory:NSApplicationSupportDirectory
               inDomains:NSUserDomainMask];
    NSURL* directory = urls.firstObject;
    if (directory == nil) {
        return NitroStorage::SqliteDiskStore::defaultPath();
    }
    [[NSFileManager defaultManager]
        createDirectoryAtURL:directory
 withIntermediateDirectories:YES
                  attributes:nil
                       error:nil];
    NSString* path = [[directory URLByAppendingPathComponent:@"nitro-storage-disk.sqlite"] path];
    return stdStringFromNSString(path);
}

static const std::string& NitroDiskStorePath() {
    static const std::string path = ResolveNitroDiskStorePath();
    return path;
}

static NitroStorage::SqliteDiskStore& NitroSqliteDiskStore() {
    return NitroStorage::SqliteDiskStore::shared(NitroDiskStorePath());
}

static bool isInternalDiskKey(NSString* key) {
    return [key isEqualToString:kLegacyDiskKeysRegistryKey] ||
        [key isEqualToString:kLegacyDiskMigrationMarkerKey];
}

static NSString* const kSuiteSqliteMigrationMarker = @"suite_v1";

static void migrateSuiteIntoSqlite() {
    auto& store = NitroSqliteDiskStore();
    const std::string marker = stdStringFromNSString(kSuiteSqliteMigrationMarker);
    if (store.hasMigrationMarker(marker)) {
        return;
    }
    NSDictionary<NSString*, id>* entries =
        [NitroDiskDefaults() persistentDomainForName:kDiskSuiteName] ?: @{};
    std::vector<std::pair<std::string, std::string>> pairs;
    pairs.reserve(entries.count);
    for (NSString* key in entries) {
        if (isInternalDiskKey(key)) {
            continue;
        }
        id value = entries[key];
        if (![value isKindOfClass:[NSString class]]) {
            continue;
        }
        pairs.emplace_back(stdStringFromNSString(key), stdStringFromNSString((NSString*)value));
    }
    store.migrateOnce(marker, pairs);
}

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

static NSString* migrateLegacyDiskValue(NSString* key) {
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSString* result = [defaults stringForKey:key];
    if (result) {
        return result;
    }

    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    NSString* legacyValue = [standard stringForKey:key];
    if (!legacyValue) {
        return nil;
    }

    registerLegacyDiskKey(key);
    if (defaults == standard) {
        return legacyValue;
    }

    [defaults setObject:legacyValue forKey:key];
    if (![defaults synchronize] ||
        ![[defaults stringForKey:key] isEqualToString:legacyValue]) {
        return legacyValue;
    }

    [standard removeObjectForKey:key];
    if ([standard synchronize] && [standard objectForKey:key] == nil) {
        unregisterLegacyDiskKeys(@[key]);
    }
    return [defaults stringForKey:key] ?: legacyValue;
}

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

#if TARGET_OS_IPHONE
static NSNotificationName const kProtectedDataBecameAvailable = UIApplicationProtectedDataDidBecomeAvailable;
static NSNotificationName const kProtectedDataWillBecomeUnavailable = UIApplicationProtectedDataWillBecomeUnavailable;
#else
static NSNotificationName const kProtectedDataBecameAvailable = @"UIApplicationProtectedDataDidBecomeAvailable";
static NSNotificationName const kProtectedDataWillBecomeUnavailable = @"UIApplicationProtectedDataWillBecomeUnavailable";
#endif
static constexpr std::chrono::milliseconds kProtectedDataSeedTimeout{25};

struct IOSStorageAdapterCpp::ProtectedDataState {
    struct Listener {
        size_t id;
        std::function<void()> callback;
    };

    std::atomic<bool> available{true};
    std::mutex mutex;
    std::vector<Listener> listeners;
    size_t nextListenerId = 0;
    NSArray<id>* observers = nil;

    void update(bool value) {
        const bool wasAvailable = available.exchange(value, std::memory_order_acq_rel);
        if (!value || wasAvailable) {
            return;
        }
        std::vector<Listener> snapshot;
        {
            std::lock_guard<std::mutex> lock(mutex);
            snapshot = listeners;
        }
        for (const auto& listener : snapshot) {
            listener.callback();
        }
    }
};

static bool readApplicationProtectedDataAvailability() {
    if ([[[NSBundle mainBundle] bundlePath] hasSuffix:@".appex"]) {
        return true;
    }
    Class applicationClass = NSClassFromString(@"UIApplication");
    if (applicationClass == nil || ![applicationClass respondsToSelector:@selector(sharedApplication)]) {
        return true;
    }
    id application = ((id (*)(Class, SEL))objc_msgSend)(applicationClass, @selector(sharedApplication));
    if (application == nil || ![application respondsToSelector:@selector(isProtectedDataAvailable)]) {
        return true;
    }
    return ((BOOL (*)(id, SEL))objc_msgSend)(application, @selector(isProtectedDataAvailable));
}

IOSStorageAdapterCpp::IOSStorageAdapterCpp()
    : IOSStorageAdapterCpp(&readApplicationProtectedDataAvailability) {}

IOSStorageAdapterCpp::IOSStorageAdapterCpp(ProtectedDataReader protectedDataReader)
    : protectedData_(std::make_shared<ProtectedDataState>()) {
    std::weak_ptr<ProtectedDataState> weakState = protectedData_;
    NSNotificationCenter* center = [NSNotificationCenter defaultCenter];
    id available = [center addObserverForName:kProtectedDataBecameAvailable
                                       object:nil
                                        queue:nil
                                   usingBlock:^(NSNotification*) {
        if (auto state = weakState.lock()) {
            state->update(true);
        }
    }];
    id unavailable = [center addObserverForName:kProtectedDataWillBecomeUnavailable
                                          object:nil
                                           queue:nil
                                      usingBlock:^(NSNotification*) {
        if (auto state = weakState.lock()) {
            state->update(false);
        }
    }];
    protectedData_->observers = @[available, unavailable];

    if ([NSThread isMainThread]) {
        protectedData_->update(protectedDataReader());
        return;
    }
    auto seeded = std::make_shared<std::promise<void>>();
    auto seededFuture = seeded->get_future();
    dispatch_async(dispatch_get_main_queue(), ^{
        if (auto state = weakState.lock()) {
            state->update(protectedDataReader());
        }
        seeded->set_value();
    });
    seededFuture.wait_for(kProtectedDataSeedTimeout);
}

IOSStorageAdapterCpp::~IOSStorageAdapterCpp() {
    for (id observer in protectedData_->observers) {
        [[NSNotificationCenter defaultCenter] removeObserver:observer];
    }
}

bool IOSStorageAdapterCpp::isProtectedDataAvailable() {
    return protectedData_->available.load(std::memory_order_acquire);
}

std::function<void()> IOSStorageAdapterCpp::addProtectedDataAvailableListener(std::function<void()> listener) {
    size_t id;
    {
        std::lock_guard<std::mutex> lock(protectedData_->mutex);
        id = protectedData_->nextListenerId++;
        protectedData_->listeners.push_back({id, std::move(listener)});
    }
    std::weak_ptr<ProtectedDataState> weakState = protectedData_;
    return [weakState, id]() {
        auto state = weakState.lock();
        if (!state) return;
        std::lock_guard<std::mutex> lock(state->mutex);
        auto& listeners = state->listeners;
        for (auto it = listeners.begin(); it != listeners.end(); ++it) {
            if (it->id == id) {
                listeners.erase(it);
                return;
            }
        }
    };
}

void IOSStorageAdapterCpp::ensureDiskMigrated() {
    if (diskMigrated_.load(std::memory_order_acquire)) {
        return;
    }
    std::lock_guard<std::mutex> lock(diskMigrationMutex_);
    if (diskMigrated_.load(std::memory_order_relaxed)) {
        return;
    }
    runLegacyDiskMigrationCutover(
        NitroDiskDefaults(),
        [NSUserDefaults standardUserDefaults]
    );
    migrateSuiteIntoSqlite();
    diskMigrated_.store(true, std::memory_order_release);
}

#ifdef NITRO_STORAGE_TESTING
void resetSqliteDiskStoreForTesting() {
    SqliteDiskStore::resetShared();
    NSString* path = nsStringFromStdString(NitroDiskStorePath());
    NSFileManager* files = [NSFileManager defaultManager];
    [files removeItemAtPath:path error:nil];
    [files removeItemAtPath:[path stringByAppendingString:@"-wal"] error:nil];
    [files removeItemAtPath:[path stringByAppendingString:@"-shm"] error:nil];
}

void resetSharedSqliteDiskStoreForTesting() {
    SqliteDiskStore::resetShared();
}

bool sqliteDiskStoreHasKeyForTesting(const std::string& key) {
    return NitroSqliteDiskStore().has(key);
}

std::string diskStorePathForTesting() {
    return NitroDiskStorePath();
}
#endif

// --- Disk ---

void IOSStorageAdapterCpp::setDisk(const std::string& key, const std::string& value) {
    NSString* nsKey = nsStringFromStdString(key);
    ensureDiskMigrated();
    NitroSqliteDiskStore().set(key, value);
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    if (defaults != standard && [standard objectForKey:nsKey] != nil) {
        [standard removeObjectForKey:nsKey];
        unregisterLegacyDiskKeys(@[nsKey]);
    }
}

std::optional<std::string> IOSStorageAdapterCpp::getDisk(const std::string& key) {
    ensureDiskMigrated();
    if (auto stored = NitroSqliteDiskStore().get(key)) {
        return stored;
    }
    NSString* nsKey = nsStringFromStdString(key);
    NSString* result = migrateLegacyDiskValue(nsKey);
    if (!result) return std::nullopt;
    const std::string value = stdStringFromNSString(result);
    try {
        NitroSqliteDiskStore().set(key, value);
    } catch (const std::exception&) {
    }
    return value;
}

void IOSStorageAdapterCpp::deleteDisk(const std::string& key) {
    NSString* nsKey = nsStringFromStdString(key);
    ensureDiskMigrated();
    NitroSqliteDiskStore().remove(key);
    NSUserDefaults* defaults = NitroDiskDefaults();
    [defaults removeObjectForKey:nsKey];
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    if (defaults != standard && [standard objectForKey:nsKey] != nil) {
        [standard removeObjectForKey:nsKey];
    }
    unregisterLegacyDiskKeys(@[nsKey]);
}

bool IOSStorageAdapterCpp::hasDisk(const std::string& key) {
    ensureDiskMigrated();
    if (NitroSqliteDiskStore().has(key)) {
        return true;
    }
    NSString* nsKey = nsStringFromStdString(key);
    NSUserDefaults* defaults = NitroDiskDefaults();
    if ([defaults objectForKey:nsKey] != nil) {
        return true;
    }
    if ([[NSUserDefaults standardUserDefaults] stringForKey:nsKey] != nil) {
        registerLegacyDiskKey(nsKey);
        return true;
    }
    return false;
}

std::vector<std::string> IOSStorageAdapterCpp::getAllKeysDisk() {
    ensureDiskMigrated();
    std::unordered_set<std::string> combined;
    for (const auto& key : NitroSqliteDiskStore().getAllKeys()) {
        combined.insert(key);
    }
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSDictionary<NSString*, id>* entries = [defaults persistentDomainForName:kDiskSuiteName] ?: @{};
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    for (NSString* key in entries) {
        if (!isInternalDiskKey(key)) {
            combined.insert(stdStringFromNSString(key));
        }
    }
    for (NSString* key in [registeredLegacyDiskKeys() allObjects]) {
        if ([entries objectForKey:key] == nil &&
            [standard stringForKey:key] != nil) {
            combined.insert(stdStringFromNSString(key));
        }
    }
    std::vector<std::string> keys;
    keys.reserve(combined.size());
    for (const auto& key : combined) {
        keys.push_back(key);
    }
    return keys;
}

static std::vector<std::string> legacyDefaultsDiskKeys() {
    std::vector<std::string> keys;
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSDictionary<NSString*, id>* entries = [defaults persistentDomainForName:kDiskSuiteName] ?: @{};
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    for (NSString* key in entries) {
        if (!isInternalDiskKey(key)) {
            keys.push_back(stdStringFromNSString(key));
        }
    }
    for (NSString* key in [registeredLegacyDiskKeys() allObjects]) {
        if ([entries objectForKey:key] == nil &&
            [standard stringForKey:key] != nil) {
            keys.push_back(stdStringFromNSString(key));
        }
    }
    return keys;
}

std::vector<std::string> IOSStorageAdapterCpp::getKeysByPrefixDisk(const std::string& prefix) {
    ensureDiskMigrated();
    std::unordered_set<std::string> combined;
    for (const auto& key : NitroSqliteDiskStore().getKeysByPrefix(prefix)) {
        combined.insert(key);
    }
    const auto remaining = SqliteDiskStore::isValidUtf8(prefix) ? legacyDefaultsDiskKeys() : getAllKeysDisk();
    for (const auto& key : remaining) {
        if (key.rfind(prefix, 0) == 0) {
            combined.insert(key);
        }
    }
    std::vector<std::string> filtered;
    filtered.reserve(combined.size());
    for (const auto& key : combined) {
        filtered.push_back(key);
    }
    return filtered;
}

size_t IOSStorageAdapterCpp::sizeDisk() {
    ensureDiskMigrated();
    auto& store = NitroSqliteDiskStore();
    size_t count = store.size();
    std::unordered_set<std::string> counted;
    for (const auto& key : legacyDefaultsDiskKeys()) {
        if (counted.insert(key).second && !store.has(key)) {
            count += 1;
        }
    }
    return count;
}

void IOSStorageAdapterCpp::setDiskBatch(
    const std::vector<std::string>& keys,
    const std::vector<std::string>& values
) {
    NSMutableArray<NSString*>* nsKeys = [NSMutableArray arrayWithCapacity:keys.size()];
    for (size_t i = 0; i < keys.size() && i < values.size(); ++i) {
        [nsKeys addObject:nsStringFromStdString(keys[i])];
    }
    ensureDiskMigrated();
    NitroSqliteDiskStore().setBatch(keys, values);
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    NSMutableArray* legacyKeysToRemove = [NSMutableArray array];
    for (NSString* nsKey in nsKeys) {
        if (defaults != standard && [standard objectForKey:nsKey] != nil) {
            [legacyKeysToRemove addObject:nsKey];
        }
    }
    for (NSString* key in legacyKeysToRemove) {
        [standard removeObjectForKey:key];
    }
    unregisterLegacyDiskKeys(legacyKeysToRemove);
}

std::vector<std::optional<std::string>> IOSStorageAdapterCpp::getDiskBatch(
    const std::vector<std::string>& keys
) {
    ensureDiskMigrated();
    std::vector<std::optional<std::string>> results;
    results.reserve(keys.size());
    for (const auto& key : keys) {
        results.push_back(getDisk(key));
    }
    return results;
}

void IOSStorageAdapterCpp::deleteDiskBatch(const std::vector<std::string>& keys) {
    NSMutableArray<NSString*>* nsKeys = [NSMutableArray arrayWithCapacity:keys.size()];
    for (const auto& key : keys) {
        [nsKeys addObject:nsStringFromStdString(key)];
    }
    ensureDiskMigrated();
    NitroSqliteDiskStore().removeBatch(keys);
    for (NSString* nsKey in nsKeys) {
        NSUserDefaults* defaults = NitroDiskDefaults();
        [defaults removeObjectForKey:nsKey];
        NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
        if (defaults != standard && [standard objectForKey:nsKey] != nil) {
            [standard removeObjectForKey:nsKey];
        }
        unregisterLegacyDiskKeys(@[nsKey]);
    }
}

static bool isRecoverableByDiskClear(const std::exception& error) {
    const std::string message = error.what();
    return message.rfind("[nitro-error:storage_corruption] NitroStorage: Disk SQLite ", 0) == 0 ||
        message.rfind("[nitro-error:storage_full] NitroStorage: Disk SQLite ", 0) == 0;
}

static void clearDiskDefaults() {
    NSUserDefaults* defaults = NitroDiskDefaults();
    NSDictionary<NSString*, id>* entries = [defaults persistentDomainForName:kDiskSuiteName] ?: @{};
    NSMutableSet* legacyKeys = [registeredLegacyDiskKeys() mutableCopy];
    for (NSString* key in entries) {
        if (isInternalDiskKey(key)) {
            continue;
        }
        [defaults removeObjectForKey:key];
    }
    NSUserDefaults* standard = [NSUserDefaults standardUserDefaults];
    if (defaults != standard) {
        for (NSString* key in entries) {
            if (isInternalDiskKey(key)) {
                continue;
            }
            [standard removeObjectForKey:key];
            [legacyKeys removeObject:key];
        }
        for (NSString* key in legacyKeys) {
            [standard removeObjectForKey:key];
        }
    }
    [defaults removeObjectForKey:kLegacyDiskKeysRegistryKey];
}

void IOSStorageAdapterCpp::clearDisk() {
    bool recreate = false;
    try {
        ensureDiskMigrated();
        NitroSqliteDiskStore().clear();
    } catch (const std::exception& error) {
        if (!isRecoverableByDiskClear(error)) {
            throw;
        }
        recreate = true;
    }
    clearDiskDefaults();
    if (recreate) {
        SqliteDiskStore::recreateShared(NitroDiskStorePath());
        std::lock_guard<std::mutex> lock(diskMigrationMutex_);
        diskMigrated_.store(false, std::memory_order_release);
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

static void throwIfLookupFailed(OSStatus status, const std::string& operation) {
    if (status == errSecSuccess || status == errSecItemNotFound) {
        return;
    }
    if (status == errSecInteractionNotAllowed) {
        throw taggedStorageError(
            "keychain_locked",
            "NitroStorage: Keychain is locked (errSecInteractionNotAllowed) during " + operation
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
    snapshot.value = stdStringFromNSString(stringValue);
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
        (__bridge id)kSecValueData: data,
        (__bridge id)kSecAttrAccessible: (__bridge id)accessControlAttr(accessControlLevel)
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

static std::string decodeKeychainText(CFTypeRef result, const std::string& operation) {
    NSData* data = (__bridge_transfer NSData*)result;
    NSString* text = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
    if (!text) {
        throw taggedStorageError(
            "storage_corruption",
            "NitroStorage: " + operation + " failed: the Keychain item has no data or is not valid UTF-8 text."
        );
    }
    return stdStringFromNSString(text);
}

static std::optional<std::string> getSecureValue(NSString* nsKey, NSString* group) {
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kKeychainService, group);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    disableKeychainInteraction(query);

    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecSuccess) {
        return decodeKeychainText(result, "Secure get");
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
    if (status != errSecSuccess && status != errSecItemNotFound) {
        if (result) CFRelease(result);
        throw keychainStatusError(status, "Secure key enumeration");
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
                    keys.push_back(stdStringFromNSString(account));
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
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
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
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
    return getSecureValue(nsKey, group);
}

void IOSStorageAdapterCpp::deleteSecure(const std::string& key) {
    NSString* nsKey = nsStringFromStdString(key);
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
    deleteSecureValue(nsKey, group);
    markSecureKeyRemoved(key);
    markBiometricKeyRemoved(key);
}

bool IOSStorageAdapterCpp::hasSecure(const std::string& key) {
    NSString* nsKey = nsStringFromStdString(key);
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
    NSMutableDictionary* secureQuery = baseKeychainQuery(nsKey, kKeychainService, group);
    disableKeychainInteraction(secureQuery);
    const OSStatus secureStatus = SecItemCopyMatching((__bridge CFDictionaryRef)secureQuery, NULL);
    if (secureStatus == errSecSuccess) {
        return true;
    }
    throwIfLookupFailed(secureStatus, "Secure has");
    NSMutableDictionary* biometricQuery = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    disableKeychainInteraction(biometricQuery);
    const OSStatus biometricStatus = SecItemCopyMatching((__bridge CFDictionaryRef)biometricQuery, NULL);
    if (biometricStatus == errSecSuccess || biometricStatus == errSecInteractionNotAllowed) {
        return true;
    }
    throwIfLookupFailed(biometricStatus, "Secure has");
    return false;
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
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
    for (size_t i = 0; i < keys.size() && i < values.size(); ++i) {
        try {
            setSecureValue(
                nsStringFromStdString(keys[i]),
                nsDataFromStdString(values[i]),
                group,
                accessControlLevel
            );
        } catch (const std::exception& error) {
            throw PartialBatchError(i, error.what());
        }
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
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
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
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
    for (size_t i = 0; i < keys.size(); ++i) {
        try {
            deleteSecureValue(nsStringFromStdString(keys[i]), group);
        } catch (const std::exception& error) {
            throw PartialBatchError(i, error.what());
        }
        markSecureKeyRemoved(keys[i]);
        markBiometricKeyRemoved(keys[i]);
    }
}

void IOSStorageAdapterCpp::clearSecure() {
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
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
    NSString* nsKey = nsStringFromStdString(key);
    NSData* data = nsDataFromStdString(value);
    std::string groupStr;
    int accessControlLevel;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
        accessControlLevel = accessControlLevel_;
    }
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);

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
    NSString* nsKey = nsStringFromStdString(key);
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecSuccess) {
        return decodeKeychainText(result, "Biometric get");
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
    NSString* nsKey = nsStringFromStdString(key);
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
    NSMutableDictionary* query = baseKeychainQuery(nsKey, kBiometricKeychainService, group);
    const OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    throwIfDeleteFailed(status, "Biometric delete");
    markBiometricKeyRemoved(key);
}

bool IOSStorageAdapterCpp::hasSecureBiometric(const std::string& key) {
    NSString* nsKey = nsStringFromStdString(key);
    std::string groupStr;
    {
        std::lock_guard<std::mutex> lock(accessGroupMutex_);
        groupStr = keychainAccessGroup_;
    }
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
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
    NSString* group = groupStr.empty() ? nil : nsStringFromStdString(groupStr);
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
        throw keychainStatusError(status, "clearSecureBiometric");
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
    NSString* nsGroup = groupStr.empty() ? nil : nsStringFromStdString(groupStr);

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
