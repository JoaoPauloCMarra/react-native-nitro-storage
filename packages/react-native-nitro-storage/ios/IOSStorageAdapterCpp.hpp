#pragma once

#include "../core/NativeStorageAdapter.hpp"
#include <atomic>
#include <functional>
#include <optional>
#include <memory>
#include <mutex>
#include <unordered_set>

namespace NitroStorage {

class IOSStorageAdapterCpp : public NativeStorageAdapter {
public:
    using ProtectedDataReader = std::function<std::optional<bool>()>;

    IOSStorageAdapterCpp();
    explicit IOSStorageAdapterCpp(ProtectedDataReader protectedDataReader);
    ~IOSStorageAdapterCpp() override;
    
    void setDisk(const std::string& key, const std::string& value) override;
    std::optional<std::string> getDisk(const std::string& key) override;
    void deleteDisk(const std::string& key) override;
    bool hasDisk(const std::string& key) override;
    std::vector<std::string> getAllKeysDisk() override;
    std::vector<std::string> getKeysByPrefixDisk(const std::string& prefix) override;
    size_t sizeDisk() override;
    void setDiskBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values) override;
    std::vector<std::optional<std::string>> getDiskBatch(const std::vector<std::string>& keys) override;
    void deleteDiskBatch(const std::vector<std::string>& keys) override;
    
    void setSecure(const std::string& key, const std::string& value) override;
    std::optional<std::string> getSecure(const std::string& key) override;
    void deleteSecure(const std::string& key) override;
    bool hasSecure(const std::string& key) override;
    std::vector<std::string> getAllKeysSecure() override;
    std::vector<std::string> getKeysByPrefixSecure(const std::string& prefix) override;
    size_t sizeSecure() override;
    void setSecureBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values) override;
    std::vector<std::optional<std::string>> getSecureBatch(const std::vector<std::string>& keys) override;
    void deleteSecureBatch(const std::vector<std::string>& keys) override;
    
    void clearDisk() override;
    void clearSecure() override;

    void setSecureAccessControl(int level) override;
    void setSecureWritesAsync(bool enabled) override;
    void setKeychainAccessGroup(const std::string& group) override;

    void setSecureBiometric(const std::string& key, const std::string& value) override;
    void setSecureBiometricWithLevel(const std::string& key, const std::string& value, int level) override;
    std::optional<std::string> getSecureBiometric(const std::string& key) override;
    void deleteSecureBiometric(const std::string& key) override;
    bool hasSecureBiometric(const std::string& key) override;
    void clearSecureBiometric() override;

    bool isProtectedDataAvailable() override;
    std::function<void()> addProtectedDataAvailableListener(std::function<void()> listener) override;

private:
    struct ProtectedDataState;
    std::shared_ptr<ProtectedDataState> protectedData_;

    int accessControlLevel_ = 0;
    std::string keychainAccessGroup_;
    mutable std::mutex secureKeysMutex_;
    mutable std::mutex accessGroupMutex_;
    std::unordered_set<std::string> secureKeysCache_;
    std::unordered_set<std::string> biometricKeysCache_;
    bool secureKeyCacheHydrated_{false};
    std::mutex diskMigrationMutex_;
    std::atomic<bool> diskMigrated_{false};

    void ensureDiskMigrated();
    void ensureSecureKeyCacheHydrated();
    void markSecureKeySet(const std::string& key);
    void markSecureKeyRemoved(const std::string& key);
    void markBiometricKeySet(const std::string& key);
    void markBiometricKeyRemoved(const std::string& key);
    void clearSecureKeyCache();
};

} // namespace NitroStorage
