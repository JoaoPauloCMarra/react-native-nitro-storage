#pragma once

#include "HybridStorageSpec.hpp"
#include "../core/NativeStorageAdapter.hpp"
#include <unordered_map>
#ifdef NITRO_STORAGE_USE_ORDERED_MAP_FOR_TESTS
#include <map>
#endif
#include <mutex>
#include <functional>
#include <memory>
#include <vector>
#include <atomic>
#include <array>
#include <stdexcept>

namespace margelo::nitro::NitroStorage {

#ifdef NITRO_STORAGE_USE_ORDERED_MAP_FOR_TESTS
template <typename Key, typename Value>
using HybridStorageMap = std::map<Key, Value>;
#else
template <typename Key, typename Value>
using HybridStorageMap = std::unordered_map<Key, Value>;
#endif

class HybridStorage : public HybridStorageSpec {
public:
    HybridStorage();
    explicit HybridStorage(std::shared_ptr<::NitroStorage::NativeStorageAdapter> adapter);
    ~HybridStorage() override = default;

    void set(const std::string& key, const std::string& value, double scope) override;
    std::optional<std::string> get(const std::string& key, double scope) override;
    void remove(const std::string& key, double scope) override;
    void clear(double scope) override;
    bool has(const std::string& key, double scope) override;
    std::vector<std::string> getAllKeys(double scope) override;
    std::vector<std::string> getKeysByPrefix(const std::string& prefix, double scope) override;
    double size(double scope) override;
    size_t getExternalMemorySize() noexcept override;
    void setBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values, double scope) override;
    std::vector<std::optional<std::string>> getBatch(const std::vector<std::string>& keys, double scope) override;
    void removeBatch(const std::vector<std::string>& keys, double scope) override;
    void removeByPrefix(const std::string& prefix, double scope) override;
    std::function<void()> addOnChange(
        double scope,
        const std::function<void(const std::string&, const std::optional<std::string>&)>& callback
    ) override;
    void setSecureAccessControl(double level) override;
    void setSecureWritesAsync(bool enabled) override;
    void setKeychainAccessGroup(const std::string& group) override;
    void setSecureBiometric(const std::string& key, const std::string& value) override;
    void setSecureBiometricWithLevel(const std::string& key, const std::string& value, double level) override;
    std::optional<std::string> getSecureBiometric(const std::string& key) override;
    void deleteSecureBiometric(const std::string& key) override;
    bool hasSecureBiometric(const std::string& key) override;
    void clearSecureBiometric() override;

private:
    enum class Scope {
        Memory = 0,
        Disk = 1,
        Secure = 2
    };

    struct Listener {
        size_t id;
        std::function<void(const std::string&, const std::optional<std::string>&)> callback;
    };

    HybridStorageMap<std::string, std::string> memoryStore_;
    std::mutex memoryMutex_;
    
    std::shared_ptr<::NitroStorage::NativeStorageAdapter> nativeAdapter_;

    HybridStorageMap<int, std::vector<Listener>> listeners_;
    std::mutex listenersMutex_;
    size_t nextListenerId_ = 0;
    // Lock-free fast path: skip locking/copying the listener vector on the
    // write/notify path when no listeners are registered for a scope.
    std::array<std::atomic<size_t>, 3> listenerScopeCounts_{};

    std::vector<Listener> copyListenersForScope(int scope);
    void notifyListeners(
        const std::vector<Listener>& listeners,
        const std::string& key,
        const std::optional<std::string>& value
    );
    void notifyListeners(int scope, const std::string& key, const std::optional<std::string>& value);
    void ensureAdapter() const;
    Scope toScope(double scopeValue);
    size_t memorySize() noexcept;

    template <typename TOperation>
    auto runAdapterOperation(TOperation&& operation, const char* description) -> decltype(operation()) {
        try {
            return operation();
        } catch (const std::exception&) {
            throw;
        } catch (...) {
            throw std::runtime_error(
                std::string("NitroStorage: ") + description + " failed (unknown error)"
            );
        }
    }

    static constexpr const char* kClearSentinelKey = "";
};

} // namespace margelo::nitro::NitroStorage
