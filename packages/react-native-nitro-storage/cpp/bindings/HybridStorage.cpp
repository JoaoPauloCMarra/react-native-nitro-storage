#include "HybridStorage.hpp"
#include <cmath>
#include <stdexcept>

#ifndef NITRO_STORAGE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
#include "../../ios/IOSStorageAdapterCpp.hpp"
#elif __ANDROID__
#include "../../android/src/main/cpp/AndroidStorageAdapterCpp.hpp"
#include <fbjni/fbjni.h>
#endif
#endif

namespace margelo::nitro::NitroStorage {

namespace {
constexpr int kDefaultBiometricLevel = 2;

template <typename Map>
size_t mapMemorySize(const Map& map) noexcept {
    size_t total = map.size() * sizeof(typename Map::value_type);
    if constexpr (requires { map.bucket_count(); }) {
        total += map.bucket_count() * sizeof(void*);
    }
    return total;
}
} // namespace

HybridStorage::HybridStorage()
    : HybridObject(TAG), HybridStorageSpec() {
#ifndef NITRO_STORAGE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
    nativeAdapter_ = std::make_shared<::NitroStorage::IOSStorageAdapterCpp>();
#elif __ANDROID__
    auto context = ::NitroStorage::AndroidStorageAdapterJava::getContext();
    nativeAdapter_ = std::make_shared<::NitroStorage::AndroidStorageAdapterCpp>(context);
#endif
#endif
}

HybridStorage::HybridStorage(std::shared_ptr<::NitroStorage::NativeStorageAdapter> adapter)
    : HybridObject(TAG), HybridStorageSpec(), nativeAdapter_(std::move(adapter)) {}

HybridStorage::Scope HybridStorage::toScope(double scopeValue) {
    if (std::isnan(scopeValue) || scopeValue < 0.0 || scopeValue > 2.0) {
        throw std::runtime_error("NitroStorage: Invalid scope value");
    }

    int intValue = static_cast<int>(scopeValue);
    if (scopeValue != static_cast<double>(intValue)) {
        throw std::runtime_error("NitroStorage: Invalid scope value");
    }

    return static_cast<Scope>(intValue);
}

void HybridStorage::set(const std::string& key, const std::string& value, double scope) {
    Scope s = toScope(scope);

    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            memoryStore_[key] = value;
            break;
        }
        case Scope::Disk:
            ensureAdapter();
            runAdapterOperation(
                [&] { nativeAdapter_->setDisk(key, value); }, "Disk set");
            break;
        case Scope::Secure:
            ensureAdapter();
            runAdapterOperation(
                [&] { nativeAdapter_->setSecure(key, value); }, "Secure set");
            break;
    }

    notifyListeners(static_cast<int>(s), key, value);
}

std::optional<std::string> HybridStorage::get(const std::string& key, double scope) {
    Scope s = toScope(scope);
    
    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            auto it = memoryStore_.find(key);
            if (it != memoryStore_.end()) {
                return it->second;
            }
            return std::nullopt;
        }
        case Scope::Disk:
            ensureAdapter();
            return runAdapterOperation(
                [&] { return nativeAdapter_->getDisk(key); }, "Disk get");
        case Scope::Secure:
            ensureAdapter();
            return runAdapterOperation(
                [&] { return nativeAdapter_->getSecure(key); }, "Secure get");
    }
    
    return std::nullopt;
}

void HybridStorage::remove(const std::string& key, double scope) {
    Scope s = toScope(scope);
    
    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            memoryStore_.erase(key);
            break;
        }
        case Scope::Disk:
            ensureAdapter();
            runAdapterOperation(
                [&] { nativeAdapter_->deleteDisk(key); }, "Disk delete");
            break;
        case Scope::Secure:
            ensureAdapter();
            runAdapterOperation(
                [&] { nativeAdapter_->deleteSecure(key); }, "Secure delete");
            break;
    }

    notifyListeners(static_cast<int>(s), key, std::nullopt);
}

bool HybridStorage::has(const std::string& key, double scope) {
    Scope s = toScope(scope);

    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            return memoryStore_.find(key) != memoryStore_.end();
        }
        case Scope::Disk:
            ensureAdapter();
            return runAdapterOperation(
                [&] { return nativeAdapter_->hasDisk(key); }, "Disk has");
        case Scope::Secure:
            ensureAdapter();
            return runAdapterOperation(
                [&] { return nativeAdapter_->hasSecure(key); }, "Secure has");
    }
    return false;
}

std::vector<std::string> HybridStorage::getAllKeys(double scope) {
    Scope s = toScope(scope);

    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            std::vector<std::string> keys;
            keys.reserve(memoryStore_.size());
            for (const auto& pair : memoryStore_) {
                keys.push_back(pair.first);
            }
            return keys;
        }
        case Scope::Disk:
            ensureAdapter();
            return runAdapterOperation(
                [&] { return nativeAdapter_->getAllKeysDisk(); }, "Disk getAllKeys");
        case Scope::Secure:
            ensureAdapter();
            return runAdapterOperation(
                [&] { return nativeAdapter_->getAllKeysSecure(); }, "Secure getAllKeys");
    }
    return {};
}

std::vector<std::string> HybridStorage::getKeysByPrefix(const std::string& prefix, double scope) {
    Scope s = toScope(scope);
    if (prefix.empty()) {
        return getAllKeys(scope);
    }

    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            std::vector<std::string> keys;
            keys.reserve(memoryStore_.size());
            for (const auto& [key, _] : memoryStore_) {
                if (key.rfind(prefix, 0) == 0) {
                    keys.push_back(key);
                }
            }
            return keys;
        }
        case Scope::Disk:
            ensureAdapter();
            return runAdapterOperation(
                [&] { return nativeAdapter_->getKeysByPrefixDisk(prefix); }, "Disk getKeysByPrefix");
        case Scope::Secure:
            ensureAdapter();
            return runAdapterOperation(
                [&] { return nativeAdapter_->getKeysByPrefixSecure(prefix); }, "Secure getKeysByPrefix");
    }
    return {};
}

double HybridStorage::size(double scope) {
    Scope s = toScope(scope);

    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            return static_cast<double>(memoryStore_.size());
        }
        case Scope::Disk:
            ensureAdapter();
            return static_cast<double>(runAdapterOperation(
                [&] { return nativeAdapter_->sizeDisk(); }, "Disk size"));
        case Scope::Secure:
            ensureAdapter();
            return static_cast<double>(runAdapterOperation(
                [&] { return nativeAdapter_->sizeSecure(); }, "Secure size"));
    }
    return 0.0;
}

size_t HybridStorage::getExternalMemorySize() noexcept {
    return memorySize();
}

size_t HybridStorage::memorySize() noexcept {
    size_t total = 0;
    {
        std::lock_guard<std::mutex> lock(memoryMutex_);
        total += mapMemorySize(memoryStore_);
        for (const auto& [key, value] : memoryStore_) {
            total += key.capacity() * sizeof(std::string::value_type);
            total += value.capacity() * sizeof(std::string::value_type);
        }
    }
    {
        std::lock_guard<std::mutex> lock(listenersMutex_);
        total += mapMemorySize(listeners_);
        for (const auto& [scope, listeners] : listeners_) {
            (void)scope;
            total += listeners.capacity() * sizeof(Listener);
        }
    }
    // The adapter interface exposes no memory-sizing contract, so platform
    // preference/keychain caches are intentionally outside this bounded
    // HybridStorage-owned estimate. std::function target allocations are also
    // opaque; the retained Listener wrapper itself is counted above.
    return total;
}

std::function<void()> HybridStorage::addOnChange(
    double scope,
    const std::function<void(const std::string&, const std::optional<std::string>&)>& callback
) {
    int intScope = static_cast<int>(toScope(scope)); // validates scope, throws on invalid
    size_t listenerId;

    {
        std::lock_guard<std::mutex> lock(listenersMutex_);
        listenerId = nextListenerId_++;
        listeners_[intScope].push_back({listenerId, callback});
    }
    // Publish the count after the vector mutation so a zero count seen by the
    // lock-free reader always means "vector has no listeners for this scope".
    if (intScope >= 0 && intScope < 3) {
        listenerScopeCounts_[static_cast<size_t>(intScope)].fetch_add(1, std::memory_order_release);
    }

    std::weak_ptr<HybridStorage> weakSelf = std::dynamic_pointer_cast<HybridStorage>(shared_from_this());
    return [weakSelf, intScope, listenerId]() {
        auto self = weakSelf.lock();
        if (!self) return;  // HybridStorage was destroyed — safe no-op
        bool found = false;
        {
            std::lock_guard<std::mutex> lock(self->listenersMutex_);
            auto& scopeListeners = self->listeners_[intScope];
            for (auto it = scopeListeners.begin(); it != scopeListeners.end(); ++it) {
                if (it->id == listenerId) {
                    scopeListeners.erase(it);
                    found = true;
                    break;
                }
            }
        }
        // Silently ignore double-unsubscribe (listener already removed)
        if (found && intScope >= 0 && intScope < 3) {
            self->listenerScopeCounts_[static_cast<size_t>(intScope)].fetch_sub(1, std::memory_order_release);
        }
    };
}

void HybridStorage::clear(double scope) {
    Scope s = toScope(scope);
    
    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            memoryStore_.clear();
            break;
        }
        case Scope::Disk:
            ensureAdapter();
            runAdapterOperation(
                [&] { nativeAdapter_->clearDisk(); }, "Disk clear");
            break;
        case Scope::Secure:
            ensureAdapter();
            runAdapterOperation(
                [&] { nativeAdapter_->clearSecure(); }, "Secure clear");
            break;
    }

    notifyListeners(static_cast<int>(s), kClearSentinelKey, std::nullopt);
}

void HybridStorage::setBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values, double scope) {
    if (keys.size() != values.size()) {
        throw std::runtime_error("NitroStorage: Keys and values size mismatch in setBatch");
    }

    Scope s = toScope(scope);

    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            for (size_t i = 0; i < keys.size(); ++i) {
                memoryStore_[keys[i]] = values[i];
            }
            break;
        }
        case Scope::Disk:
            ensureAdapter();
            runAdapterOperation(
                [&] { nativeAdapter_->setDiskBatch(keys, values); }, "Disk setBatch");
            break;
        case Scope::Secure:
            ensureAdapter();
            runAdapterOperation(
                [&] { nativeAdapter_->setSecureBatch(keys, values); }, "Secure setBatch");
            break;
    }

    const auto scopeValue = static_cast<int>(s);
    const auto listeners = copyListenersForScope(scopeValue);
    for (size_t i = 0; i < keys.size(); ++i) {
        notifyListeners(listeners, keys[i], values[i]);
    }
}

std::vector<std::optional<std::string>> HybridStorage::getBatch(const std::vector<std::string>& keys, double scope) {
    std::vector<std::optional<std::string>> results;
    results.reserve(keys.size());

    Scope s = toScope(scope);

    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            for (const auto& key : keys) {
                auto it = memoryStore_.find(key);
                if (it != memoryStore_.end()) {
                    results.push_back(it->second);
                } else {
                    results.push_back(std::nullopt);
                }
            }
            return results;
        }
        case Scope::Disk: {
            ensureAdapter();
            return runAdapterOperation(
                [&] { return nativeAdapter_->getDiskBatch(keys); }, "Disk getBatch");
        }
        case Scope::Secure: {
            ensureAdapter();
            return runAdapterOperation(
                [&] { return nativeAdapter_->getSecureBatch(keys); }, "Secure getBatch");
        }
    }

    return results;
}

void HybridStorage::removeBatch(const std::vector<std::string>& keys, double scope) {
    Scope s = toScope(scope);

    switch (s) {
        case Scope::Memory: {
            std::lock_guard<std::mutex> lock(memoryMutex_);
            for (const auto& key : keys) {
                memoryStore_.erase(key);
            }
            break;
        }
        case Scope::Disk:
            ensureAdapter();
            runAdapterOperation(
                [&] { nativeAdapter_->deleteDiskBatch(keys); }, "Disk removeBatch");
            break;
        case Scope::Secure:
            ensureAdapter();
            runAdapterOperation(
                [&] { nativeAdapter_->deleteSecureBatch(keys); }, "Secure removeBatch");
            break;
    }

    const auto scopeValue = static_cast<int>(s);
    const auto listeners = copyListenersForScope(scopeValue);
    for (const auto& key : keys) {
        notifyListeners(listeners, key, std::nullopt);
    }
}

void HybridStorage::removeByPrefix(const std::string& prefix, double scope) {
    if (prefix.empty()) {
        return;
    }

    const auto prefixedKeys = getKeysByPrefix(prefix, scope);

    if (prefixedKeys.empty()) {
        return;
    }

    removeBatch(prefixedKeys, scope);
}

// --- Configuration ---

void HybridStorage::setSecureAccessControl(double level) {
    if (std::isnan(level) || std::isinf(level)) {
        throw std::runtime_error("NitroStorage: Invalid access control level");
    }
    if (level < 0.0 || level > 4.0) {
        throw std::runtime_error(
            "NitroStorage: Invalid access control level. Expected 0-4.");
    }
    int intLevel = static_cast<int>(level);
    if (level != static_cast<double>(intLevel)) {
        throw std::runtime_error("NitroStorage: Invalid access control level");
    }
    ensureAdapter();
    nativeAdapter_->setSecureAccessControl(intLevel);
}

void HybridStorage::setSecureWritesAsync(bool enabled) {
    ensureAdapter();
    nativeAdapter_->setSecureWritesAsync(enabled);
}

void HybridStorage::setKeychainAccessGroup(const std::string& group) {
    ensureAdapter();
    nativeAdapter_->setKeychainAccessGroup(group);
}

// --- Biometric ---

void HybridStorage::setSecureBiometric(const std::string& key, const std::string& value) {
    setSecureBiometricWithLevel(key, value, kDefaultBiometricLevel);
}

void HybridStorage::setSecureBiometricWithLevel(const std::string& key, const std::string& value, double level) {
    if (std::isnan(level) || std::isinf(level)) {
        throw std::runtime_error(
            "NitroStorage: Invalid biometric level");
    }
    if (level < 0.0 || level > 2.0) {
        throw std::runtime_error(
            "NitroStorage: Invalid biometric level. Expected 0 (none), 1 (user presence), or 2 (biometric only).");
    }
    int intLevel = static_cast<int>(level);
    if (level != static_cast<double>(intLevel)) {
        throw std::runtime_error(
            "NitroStorage: Invalid biometric level");
    }
    ensureAdapter();
    runAdapterOperation(
        [&] { nativeAdapter_->setSecureBiometricWithLevel(key, value, intLevel); },
        "Biometric set");
    notifyListeners(static_cast<int>(Scope::Secure), key, value);
}

std::optional<std::string> HybridStorage::getSecureBiometric(const std::string& key) {
    ensureAdapter();
    return runAdapterOperation(
        [&] { return nativeAdapter_->getSecureBiometric(key); }, "Biometric get");
}

void HybridStorage::deleteSecureBiometric(const std::string& key) {
    ensureAdapter();
    runAdapterOperation(
        [&] { nativeAdapter_->deleteSecureBiometric(key); }, "Biometric delete");
    notifyListeners(static_cast<int>(Scope::Secure), key, std::nullopt);
}

bool HybridStorage::hasSecureBiometric(const std::string& key) {
    ensureAdapter();
    return nativeAdapter_->hasSecureBiometric(key);
}

void HybridStorage::clearSecureBiometric() {
    ensureAdapter();
    runAdapterOperation(
        [&] { nativeAdapter_->clearSecureBiometric(); }, "Biometric clear");
    notifyListeners(static_cast<int>(Scope::Secure), kClearSentinelKey, std::nullopt);
}

// --- Internal ---

std::vector<HybridStorage::Listener> HybridStorage::copyListenersForScope(int scope) {
    // Lock-free fast path: when no listeners are registered for this scope,
    // avoid taking the mutex and copying the (empty) vector on every write.
    if (scope >= 0 && scope < 3 &&
        listenerScopeCounts_[static_cast<size_t>(scope)].load(std::memory_order_acquire) == 0) {
        return {};
    }

    std::vector<Listener> listenersCopy;
    {
        std::lock_guard<std::mutex> lock(listenersMutex_);
        auto it = listeners_.find(scope);
        if (it != listeners_.end()) {
            listenersCopy = it->second;
        }
    }
    return listenersCopy;
}

void HybridStorage::notifyListeners(
    const std::vector<Listener>& listeners,
    const std::string& key,
    const std::optional<std::string>& value
) {
    for (const auto& listener : listeners) {
        try {
            listener.callback(key, value);
        } catch (...) {
            // Ignore listener failures to avoid crashing the caller.
        }
    }
}

void HybridStorage::notifyListeners(
    int scope,
    const std::string& key,
    const std::optional<std::string>& value
) {
    const auto listeners = copyListenersForScope(scope);
    notifyListeners(listeners, key, value);
}

void HybridStorage::ensureAdapter() const {
    if (!nativeAdapter_) {
        throw std::runtime_error("NitroStorage: Native adapter not initialized");
    }
}

} // namespace margelo::nitro::NitroStorage
