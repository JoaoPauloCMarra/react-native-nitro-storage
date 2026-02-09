#include "HybridStorage.hpp"
#include <stdexcept>

#if __APPLE__
#include "../../ios/IOSStorageAdapterCpp.hpp"
#elif __ANDROID__
#include "../../android/src/main/cpp/AndroidStorageAdapterCpp.hpp"
#include <fbjni/fbjni.h>
#endif

namespace margelo::nitro::NitroStorage {

HybridStorage::HybridStorage()
    : HybridObject(TAG), HybridStorageSpec() {
#if __APPLE__
    nativeAdapter_ = std::make_shared<::NitroStorage::IOSStorageAdapterCpp>();
#elif __ANDROID__
    auto context = ::NitroStorage::AndroidStorageAdapterJava::getContext();
    nativeAdapter_ = std::make_shared<::NitroStorage::AndroidStorageAdapterCpp>(context);
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
            } catch (const std::exception& e) {
                throw std::runtime_error(std::string("NitroStorage: Disk set failed: ") + e.what());
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk set failed");
            }
            break;
        case Scope::Secure:
            ensureAdapter();
            try {
                nativeAdapter_->setSecure(key, value);
            } catch (const std::exception& e) {
                throw std::runtime_error(std::string("NitroStorage: Secure set failed: ") + e.what());
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure set failed");
            }
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
            try {
                return nativeAdapter_->getDisk(key);
            } catch (const std::exception& e) {
                throw std::runtime_error(std::string("NitroStorage: Disk get failed: ") + e.what());
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk get failed");
            }
        case Scope::Secure:
            ensureAdapter();
            try {
                return nativeAdapter_->getSecure(key);
            } catch (const std::exception& e) {
                throw std::runtime_error(std::string("NitroStorage: Secure get failed: ") + e.what());
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure get failed");
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
            } catch (const std::exception& e) {
                throw std::runtime_error(std::string("NitroStorage: Disk delete failed: ") + e.what());
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk delete failed");
            }
            break;
        case Scope::Secure:
            ensureAdapter();
            try {
                nativeAdapter_->deleteSecure(key);
            } catch (const std::exception& e) {
                throw std::runtime_error(std::string("NitroStorage: Secure delete failed: ") + e.what());
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure delete failed");
            }
            break;
    }
    
    notifyListeners(static_cast<int>(s), key, std::nullopt);
}

std::function<void()> HybridStorage::addOnChange(
    double scope,
    const std::function<void(const std::string&, const std::optional<std::string>&)>& callback
) {
    int intScope = static_cast<int>(scope);
    size_t listenerId;

    {
        std::lock_guard<std::mutex> lock(listenersMutex_);
        listenerId = nextListenerId_++;
        listeners_[intScope].push_back({listenerId, callback});
    }
    
    return [this, intScope, listenerId]() {
        std::lock_guard<std::mutex> lock(listenersMutex_);
        auto& scopeListeners = listeners_[intScope];
        for (auto it = scopeListeners.begin(); it != scopeListeners.end(); ++it) {
            if (it->id == listenerId) {
                scopeListeners.erase(it);
                break;
            }
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
            try {
                nativeAdapter_->clearDisk();
            } catch (const std::exception& e) {
                throw std::runtime_error(std::string("NitroStorage: Disk clear failed: ") + e.what());
            } catch (...) {
                throw std::runtime_error("NitroStorage: Disk clear failed");
            }
            break;
        case Scope::Secure:
            ensureAdapter();
            try {
                nativeAdapter_->clearSecure();
            } catch (const std::exception& e) {
                throw std::runtime_error(std::string("NitroStorage: Secure clear failed: ") + e.what());
            } catch (...) {
                throw std::runtime_error("NitroStorage: Secure clear failed");
            }
            break;
    }
    
    notifyListeners(static_cast<int>(s), "", std::nullopt);
}

void HybridStorage::setBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values, double scope) {
    if (keys.size() != values.size()) {
        throw std::runtime_error("NitroStorage: Keys and values size mismatch in setBatch");
    }
    
    for (size_t i = 0; i < keys.size(); ++i) {
        set(keys[i], values[i], scope);
    }
}


std::vector<std::string> HybridStorage::getBatch(const std::vector<std::string>& keys, double scope) {
    std::vector<std::string> results;
    results.reserve(keys.size());
    
    for (const auto& key : keys) {
        auto val = get(key, scope);
        results.push_back(val.value_or(""));
    }
    
    return results;
}


void HybridStorage::removeBatch(const std::vector<std::string>& keys, double scope) {
    for (const auto& key : keys) {
        remove(key, scope);
    }
}

void HybridStorage::notifyListeners(
    int scope,
    const std::string& key,
    const std::optional<std::string>& value
) {
    std::vector<Listener> listenersCopy;
    {
        std::lock_guard<std::mutex> lock(listenersMutex_);
        auto it = listeners_.find(scope);
        if (it != listeners_.end()) {
            listenersCopy.reserve(it->second.size());
            listenersCopy = it->second;
        }
    }
    
    for (const auto& listener : listenersCopy) {
        try {
            listener.callback(key, value);
        } catch (...) {
            // Ignore listener failures to avoid crashing the caller.
        }
    }
}

void HybridStorage::ensureAdapter() const {
    if (!nativeAdapter_) {
        throw std::runtime_error("NitroStorage: Native adapter not initialized");
    }
}

} // namespace margelo::nitro::NitroStorage
