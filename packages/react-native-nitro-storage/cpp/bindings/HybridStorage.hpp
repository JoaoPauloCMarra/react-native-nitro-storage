#pragma once

#include "HybridStorageSpec.hpp"
#include "../core/NativeStorageAdapter.hpp"
#include <unordered_map>
#include <mutex>
#include <functional>
#include <memory>
#include <vector>

namespace margelo::nitro::NitroStorage {

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
    double size(double scope) override;
    void setBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values, double scope) override;
    std::vector<std::string> getBatch(const std::vector<std::string>& keys, double scope) override;
    void removeBatch(const std::vector<std::string>& keys, double scope) override;
    std::function<void()> addOnChange(
        double scope,
        const std::function<void(const std::string&, const std::optional<std::string>&)>& callback
    ) override;
    void setSecureAccessControl(double level) override;
    void setKeychainAccessGroup(const std::string& group) override;
    void setSecureBiometric(const std::string& key, const std::string& value) override;
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

    std::unordered_map<std::string, std::string> memoryStore_;
    std::mutex memoryMutex_;
    
    std::shared_ptr<::NitroStorage::NativeStorageAdapter> nativeAdapter_;
    
    std::unordered_map<int, std::vector<Listener>> listeners_;
    std::mutex listenersMutex_;
    size_t nextListenerId_ = 0;

    void notifyListeners(int scope, const std::string& key, const std::optional<std::string>& value);
    void ensureAdapter() const;
    Scope toScope(double scopeValue);
};

} // namespace margelo::nitro::NitroStorage
