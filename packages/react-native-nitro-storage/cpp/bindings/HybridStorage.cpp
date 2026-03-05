#include "HybridStorage.hpp"
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
constexpr auto kBatchMissingSentinel = "__nitro_storage_batch_missing__::v1";
constexpr int kDefaultBiometricLevel = 2;
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
    if (scopeValue < 0.0 || scopeValue > 2.0) {
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
            try {
                nativeAdapter_->setDisk(key, value);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk set failed (unknown error)");
            }
            break;
        case Scope::Secure:
            ensureAdapter();
            try {
                nativeAdapter_->setSecure(key, value);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure set failed (unknown error)");
            }
            break;
    }

    onKeySet(static_cast<int>(s), key);
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
            try {
                return nativeAdapter_->getDisk(key);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk get failed (unknown error)");
            }
        case Scope::Secure:
            ensureAdapter();
            try {
                return nativeAdapter_->getSecure(key);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure get failed (unknown error)");
            }
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
            try {
                nativeAdapter_->deleteDisk(key);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk delete failed (unknown error)");
            }
            break;
        case Scope::Secure:
            ensureAdapter();
            try {
                nativeAdapter_->deleteSecure(key);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure delete failed (unknown error)");
            }
            break;
    }

    onKeyRemove(static_cast<int>(s), key);
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
        case Scope::Secure: {
            const int scopeValue = static_cast<int>(s);
            ensureKeyIndexHydrated(scopeValue);
            std::lock_guard<std::mutex> lock(keyIndexMutex_);
            auto indexIt = keyIndex_.find(scopeValue);
            if (indexIt == keyIndex_.end()) {
                return false;
            }
            return indexIt->second.count(key) > 0;
        }
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
        case Scope::Secure: {
            const int scopeValue = static_cast<int>(s);
            ensureKeyIndexHydrated(scopeValue);
            std::lock_guard<std::mutex> lock(keyIndexMutex_);
            auto indexIt = keyIndex_.find(scopeValue);
            if (indexIt == keyIndex_.end()) {
                return {};
            }
            return toVector(indexIt->second);
        }
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
        case Scope::Secure: {
            const int scopeValue = static_cast<int>(s);
            ensureKeyIndexHydrated(scopeValue);
            std::lock_guard<std::mutex> lock(keyIndexMutex_);
            std::vector<std::string> keys;
            auto indexIt = keyIndex_.find(scopeValue);
            if (indexIt == keyIndex_.end()) {
                return keys;
            }
            keys.reserve(indexIt->second.size());
            for (const auto& key : indexIt->second) {
                if (key.rfind(prefix, 0) == 0) {
                    keys.push_back(key);
                }
            }
            return keys;
        }
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
        case Scope::Secure: {
            const int scopeValue = static_cast<int>(s);
            ensureKeyIndexHydrated(scopeValue);
            std::lock_guard<std::mutex> lock(keyIndexMutex_);
            auto indexIt = keyIndex_.find(scopeValue);
            if (indexIt == keyIndex_.end()) {
                return 0.0;
            }
            return static_cast<double>(indexIt->second.size());
        }
    }
    return 0.0;
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
    
    std::weak_ptr<HybridStorage> weakSelf = std::static_pointer_cast<HybridStorage>(shared_from_this());
    return [weakSelf, intScope, listenerId]() {
        auto self = weakSelf.lock();
        if (!self) return;  // HybridStorage was destroyed — safe no-op
        std::lock_guard<std::mutex> lock(self->listenersMutex_);
        auto& scopeListeners = self->listeners_[intScope];
        bool found = false;
        for (auto it = scopeListeners.begin(); it != scopeListeners.end(); ++it) {
            if (it->id == listenerId) {
                scopeListeners.erase(it);
                found = true;
                break;
            }
        }
        // Silently ignore double-unsubscribe (listener already removed)
        (void)found;
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
            try {
                nativeAdapter_->clearDisk();
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk clear failed (unknown error)");
            }
            break;
        case Scope::Secure:
            ensureAdapter();
            try {
                nativeAdapter_->clearSecure();
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure clear failed (unknown error)");
            }
            break;
    }

    onScopeClear(static_cast<int>(s));
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
            try {
                nativeAdapter_->setDiskBatch(keys, values);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk setBatch failed (unknown error)");
            }
            break;
        case Scope::Secure:
            ensureAdapter();
            try {
                nativeAdapter_->setSecureBatch(keys, values);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure setBatch failed (unknown error)");
            }
            break;
    }

    const auto scopeValue = static_cast<int>(s);
    for (const auto& key : keys) {
        onKeySet(scopeValue, key);
    }
    const auto listeners = copyListenersForScope(scopeValue);
    for (size_t i = 0; i < keys.size(); ++i) {
        notifyListeners(listeners, keys[i], values[i]);
    }
}

std::vector<std::string> HybridStorage::getBatch(const std::vector<std::string>& keys, double scope) {
    std::vector<std::string> results;
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
                    results.push_back(kBatchMissingSentinel);
                }
            }
            return results;
        }
        case Scope::Disk: {
            ensureAdapter();
            std::vector<std::optional<std::string>> values;
            try {
                values = nativeAdapter_->getDiskBatch(keys);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk getBatch failed (unknown error)");
            }

            for (const auto& value : values) {
                results.push_back(value.has_value() ? *value : std::string(kBatchMissingSentinel));
            }
            return results;
        }
        case Scope::Secure: {
            ensureAdapter();
            std::vector<std::optional<std::string>> values;
            try {
                values = nativeAdapter_->getSecureBatch(keys);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure getBatch failed (unknown error)");
            }

            for (const auto& value : values) {
                results.push_back(value.has_value() ? *value : std::string(kBatchMissingSentinel));
            }
            return results;
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
            try {
                nativeAdapter_->deleteDiskBatch(keys);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk removeBatch failed (unknown error)");
            }
            break;
        case Scope::Secure:
            ensureAdapter();
            try {
                nativeAdapter_->deleteSecureBatch(keys);
            } catch (const std::exception&) {
                throw;
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure removeBatch failed (unknown error)");
            }
            break;
    }

    const auto scopeValue = static_cast<int>(s);
    for (const auto& key : keys) {
        onKeyRemove(scopeValue, key);
    }
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
    int intLevel = static_cast<int>(level);
    if (intLevel < 0 || intLevel > 4) {
        throw std::runtime_error(
            "NitroStorage: Invalid access control level " + std::to_string(intLevel) +
            ". Expected 0-4.");
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
    int intLevel = static_cast<int>(level);
    if (intLevel < 0 || intLevel > 2) {
        throw std::runtime_error(
            "NitroStorage: Invalid biometric level " + std::to_string(intLevel) +
            ". Expected 0 (none), 1 (user presence), or 2 (biometric only).");
    }
    ensureAdapter();
    try {
        nativeAdapter_->setSecureBiometricWithLevel(
            key,
            value,
            intLevel
        );
        onKeySet(static_cast<int>(Scope::Secure), key);
        notifyListeners(static_cast<int>(Scope::Secure), key, value);
    } catch (const std::exception&) {
        throw;
    } catch (...) {
        throw std::runtime_error("NitroStorage: Biometric set failed (unknown error)");
    }
}

std::optional<std::string> HybridStorage::getSecureBiometric(const std::string& key) {
    ensureAdapter();
    try {
        return nativeAdapter_->getSecureBiometric(key);
    } catch (const std::exception&) {
        throw;
    } catch (...) {
        throw std::runtime_error("NitroStorage: Biometric get failed (unknown error)");
    }
}

void HybridStorage::deleteSecureBiometric(const std::string& key) {
    ensureAdapter();
    try {
        nativeAdapter_->deleteSecureBiometric(key);
        onKeyRemove(static_cast<int>(Scope::Secure), key);
        notifyListeners(static_cast<int>(Scope::Secure), key, std::nullopt);
    } catch (const std::exception&) {
        throw;
    } catch (...) {
        throw std::runtime_error("NitroStorage: Biometric delete failed (unknown error)");
    }
}

bool HybridStorage::hasSecureBiometric(const std::string& key) {
    ensureAdapter();
    return nativeAdapter_->hasSecureBiometric(key);
}

void HybridStorage::clearSecureBiometric() {
    ensureAdapter();
    try {
        nativeAdapter_->clearSecureBiometric();
        // Invalidate the secure key index so next access re-hydrates from native adapter
        // (which will now correctly exclude the cleared biometric keys).
        // We do NOT call onScopeClear() here because that would also clear the index
        // contents for regular secure keys; marking stale is sufficient.
        {
            std::lock_guard<std::mutex> lock(keyIndexMutex_);
            keyIndexHydrated_[static_cast<int>(Scope::Secure)] = false;
        }
        notifyListeners(static_cast<int>(Scope::Secure), kClearSentinelKey, std::nullopt);
    } catch (const std::exception&) {
        throw;
    } catch (...) {
        throw std::runtime_error("NitroStorage: Biometric clear failed (unknown error)");
    }
}

// --- Internal ---

std::vector<HybridStorage::Listener> HybridStorage::copyListenersForScope(int scope) {
    std::vector<Listener> listenersCopy;
    {
        std::lock_guard<std::mutex> lock(listenersMutex_);
        auto it = listeners_.find(scope);
        if (it != listeners_.end()) {
            listenersCopy.reserve(it->second.size());
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

std::vector<std::string> HybridStorage::toVector(const std::unordered_set<std::string>& keys) {
    std::vector<std::string> values;
    values.reserve(keys.size());
    for (const auto& key : keys) {
        values.push_back(key);
    }
    return values;
}

void HybridStorage::ensureKeyIndexHydrated(int scope) {
    if (scope != static_cast<int>(Scope::Disk) && scope != static_cast<int>(Scope::Secure)) {
        return;
    }

    {
        std::lock_guard<std::mutex> lock(keyIndexMutex_);
        auto hydratedIt = keyIndexHydrated_.find(scope);
        if (hydratedIt != keyIndexHydrated_.end() && hydratedIt->second) {
            return;
        }
    }

    ensureAdapter();
    std::vector<std::string> keys;
    try {
        if (scope == static_cast<int>(Scope::Disk)) {
            keys = nativeAdapter_->getAllKeysDisk();
        } else {
            keys = nativeAdapter_->getAllKeysSecure();
        }
    } catch (const std::exception&) {
        throw;
    } catch (...) {
        throw std::runtime_error("NitroStorage: Key index hydration failed (unknown error)");
    }

    std::lock_guard<std::mutex> lock(keyIndexMutex_);
    // Double-check: another thread may have hydrated while we fetched
    auto hydratedIt = keyIndexHydrated_.find(scope);
    if (hydratedIt != keyIndexHydrated_.end() && hydratedIt->second) {
        return; // discard our results
    }
    auto& index = keyIndex_[scope];
    index.clear();
    for (const auto& key : keys) {
        index.insert(key);
    }
    keyIndexHydrated_[scope] = true;
}

void HybridStorage::onKeySet(int scope, const std::string& key) {
    if (scope != static_cast<int>(Scope::Disk) && scope != static_cast<int>(Scope::Secure)) {
        return;
    }

    std::lock_guard<std::mutex> lock(keyIndexMutex_);
    auto hydratedIt = keyIndexHydrated_.find(scope);
    if (hydratedIt != keyIndexHydrated_.end() && hydratedIt->second) {
        keyIndex_[scope].insert(key);
    }
}

void HybridStorage::onKeyRemove(int scope, const std::string& key) {
    if (scope != static_cast<int>(Scope::Disk) && scope != static_cast<int>(Scope::Secure)) {
        return;
    }

    std::lock_guard<std::mutex> lock(keyIndexMutex_);
    auto hydratedIt = keyIndexHydrated_.find(scope);
    if (hydratedIt != keyIndexHydrated_.end() && hydratedIt->second) {
        keyIndex_[scope].erase(key);
    }
}

void HybridStorage::onScopeClear(int scope) {
    if (scope != static_cast<int>(Scope::Disk) && scope != static_cast<int>(Scope::Secure)) {
        return;
    }

    std::lock_guard<std::mutex> lock(keyIndexMutex_);
    auto hydratedIt = keyIndexHydrated_.find(scope);
    if (hydratedIt != keyIndexHydrated_.end() && hydratedIt->second) {
        keyIndex_[scope].clear();
    }
}

void HybridStorage::ensureAdapter() const {
    if (!nativeAdapter_) {
        throw std::runtime_error("NitroStorage: Native adapter not initialized");
    }
}

} // namespace margelo::nitro::NitroStorage
