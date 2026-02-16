#include "NativeStorageAdapter.hpp"
#include <cassert>
#include <iostream>
#include <memory>
#include <vector>
#include <thread>
#include <map>
#include <mutex>
#include <algorithm>

using namespace ::NitroStorage;

class MockNativeAdapter : public NativeStorageAdapter {
private:
    std::map<std::string, std::string> diskStore_;
    std::map<std::string, std::string> secureStore_;
    std::map<std::string, std::string> biometricStore_;
    std::mutex diskMutex_;
    std::mutex secureMutex_;
    std::mutex biometricMutex_;
    int accessControlLevel_ = 0;
    std::string keychainGroup_;

public:
    // --- Disk ---

    void setDisk(const std::string& key, const std::string& value) override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        diskStore_[key] = value;
    }

    std::optional<std::string> getDisk(const std::string& key) override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        auto it = diskStore_.find(key);
        return it != diskStore_.end() ? std::optional(it->second) : std::nullopt;
    }

    void deleteDisk(const std::string& key) override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        diskStore_.erase(key);
    }

    bool hasDisk(const std::string& key) override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        return diskStore_.count(key) > 0;
    }

    std::vector<std::string> getAllKeysDisk() override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        std::vector<std::string> keys;
        keys.reserve(diskStore_.size());
        for (const auto& [k, _] : diskStore_) keys.push_back(k);
        return keys;
    }

    size_t sizeDisk() override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        return diskStore_.size();
    }

    void setDiskBatch(
        const std::vector<std::string>& keys,
        const std::vector<std::string>& values
    ) override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        const size_t count = std::min(keys.size(), values.size());
        for (size_t i = 0; i < count; ++i) {
            diskStore_[keys[i]] = values[i];
        }
    }

    std::vector<std::optional<std::string>> getDiskBatch(
        const std::vector<std::string>& keys
    ) override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        std::vector<std::optional<std::string>> values;
        values.reserve(keys.size());
        for (const auto& key : keys) {
            auto it = diskStore_.find(key);
            values.push_back(it != diskStore_.end() ? std::optional(it->second) : std::nullopt);
        }
        return values;
    }

    void deleteDiskBatch(const std::vector<std::string>& keys) override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        for (const auto& key : keys) diskStore_.erase(key);
    }

    void clearDisk() override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        diskStore_.clear();
    }

    // --- Secure ---

    void setSecure(const std::string& key, const std::string& value) override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        secureStore_[key] = value;
    }

    std::optional<std::string> getSecure(const std::string& key) override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        auto it = secureStore_.find(key);
        return it != secureStore_.end() ? std::optional(it->second) : std::nullopt;
    }

    void deleteSecure(const std::string& key) override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        secureStore_.erase(key);
    }

    bool hasSecure(const std::string& key) override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        return secureStore_.count(key) > 0;
    }

    std::vector<std::string> getAllKeysSecure() override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        std::vector<std::string> keys;
        keys.reserve(secureStore_.size());
        for (const auto& [k, _] : secureStore_) keys.push_back(k);
        return keys;
    }

    size_t sizeSecure() override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        return secureStore_.size();
    }

    void setSecureBatch(
        const std::vector<std::string>& keys,
        const std::vector<std::string>& values
    ) override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        const size_t count = std::min(keys.size(), values.size());
        for (size_t i = 0; i < count; ++i) {
            secureStore_[keys[i]] = values[i];
        }
    }

    std::vector<std::optional<std::string>> getSecureBatch(
        const std::vector<std::string>& keys
    ) override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        std::vector<std::optional<std::string>> values;
        values.reserve(keys.size());
        for (const auto& key : keys) {
            auto it = secureStore_.find(key);
            values.push_back(it != secureStore_.end() ? std::optional(it->second) : std::nullopt);
        }
        return values;
    }

    void deleteSecureBatch(const std::vector<std::string>& keys) override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        for (const auto& key : keys) secureStore_.erase(key);
    }

    void clearSecure() override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        secureStore_.clear();
    }

    // --- Access Control ---

    void setSecureAccessControl(int level) override {
        accessControlLevel_ = level;
    }

    void setKeychainAccessGroup(const std::string& group) override {
        keychainGroup_ = group;
    }

    // --- Biometric ---

    void setSecureBiometric(const std::string& key, const std::string& value) override {
        std::lock_guard<std::mutex> lock(biometricMutex_);
        biometricStore_[key] = value;
    }

    std::optional<std::string> getSecureBiometric(const std::string& key) override {
        std::lock_guard<std::mutex> lock(biometricMutex_);
        auto it = biometricStore_.find(key);
        return it != biometricStore_.end() ? std::optional(it->second) : std::nullopt;
    }

    void deleteSecureBiometric(const std::string& key) override {
        std::lock_guard<std::mutex> lock(biometricMutex_);
        biometricStore_.erase(key);
    }

    bool hasSecureBiometric(const std::string& key) override {
        std::lock_guard<std::mutex> lock(biometricMutex_);
        return biometricStore_.count(key) > 0;
    }

    void clearSecureBiometric() override {
        std::lock_guard<std::mutex> lock(biometricMutex_);
        biometricStore_.clear();
    }
};

void testDiskStorage() {
    auto adapter = std::make_shared<MockNativeAdapter>();

    adapter->setDisk("disk-key", "disk-value");
    auto result = adapter->getDisk("disk-key");
    assert(result.has_value() && result.value() == "disk-value");

    adapter->setDisk("disk-key", "updated-value");
    result = adapter->getDisk("disk-key");
    assert(result.has_value() && result.value() == "updated-value");

    adapter->deleteDisk("disk-key");
    result = adapter->getDisk("disk-key");
    assert(!result.has_value());

}

void testSecureStorage() {
    auto adapter = std::make_shared<MockNativeAdapter>();

    adapter->setSecure("secure-key", "secure-value");
    auto result = adapter->getSecure("secure-key");
    assert(result.has_value() && result.value() == "secure-value");

    adapter->deleteSecure("secure-key");
    result = adapter->getSecure("secure-key");
    assert(!result.has_value());

}

void testThreadSafety() {
    auto adapter = std::make_shared<MockNativeAdapter>();
    const int numThreads = 10;
    const int opsPerThread = 100;
    std::vector<std::thread> threads;

    for (int t = 0; t < numThreads; ++t) {
        threads.emplace_back([&adapter, t]() {
            for (int i = 0; i < opsPerThread; ++i) {
                std::string key = "key-" + std::to_string(t) + "-" + std::to_string(i);
                std::string value = "value-" + std::to_string(i);
                adapter->setDisk(key, value);
                assert(adapter->getDisk(key).has_value());
                adapter->deleteDisk(key);
            }
        });
    }

    for (auto& thread : threads) {
        thread.join();
    }
}

void testMultipleKeys() {
    auto adapter = std::make_shared<MockNativeAdapter>();

    adapter->setDisk("key1", "value1");
    adapter->setDisk("key2", "value2");
    adapter->setDisk("key3", "value3");

    assert(adapter->getDisk("key1").value() == "value1");
    assert(adapter->getDisk("key2").value() == "value2");
    assert(adapter->getDisk("key3").value() == "value3");

    adapter->deleteDisk("key2");
    assert(adapter->getDisk("key1").has_value());
    assert(!adapter->getDisk("key2").has_value());
    assert(adapter->getDisk("key3").has_value());

}

void testHasAndSize() {
    auto adapter = std::make_shared<MockNativeAdapter>();

    assert(!adapter->hasDisk("missing"));
    assert(adapter->sizeDisk() == 0);

    adapter->setDisk("k1", "v1");
    adapter->setDisk("k2", "v2");
    assert(adapter->hasDisk("k1"));
    assert(adapter->sizeDisk() == 2);

    auto keys = adapter->getAllKeysDisk();
    assert(keys.size() == 2);

    adapter->clearDisk();
    assert(adapter->sizeDisk() == 0);
}

void testBiometricStorage() {
    auto adapter = std::make_shared<MockNativeAdapter>();

    assert(!adapter->hasSecureBiometric("bio-key"));

    adapter->setSecureBiometric("bio-key", "bio-value");
    assert(adapter->hasSecureBiometric("bio-key"));
    assert(adapter->getSecureBiometric("bio-key").value() == "bio-value");

    adapter->deleteSecureBiometric("bio-key");
    assert(!adapter->hasSecureBiometric("bio-key"));

    adapter->setSecureBiometric("a", "1");
    adapter->setSecureBiometric("b", "2");
    adapter->clearSecureBiometric();
    assert(!adapter->hasSecureBiometric("a"));
    assert(!adapter->hasSecureBiometric("b"));
}

int main() {
    std::cout << "Running C++ Storage Tests..." << std::endl << std::endl;

    testDiskStorage();
    testSecureStorage();
    testThreadSafety();
    testMultipleKeys();
    testHasAndSize();
    testBiometricStorage();

    std::cout << std::endl << "✅ All C++ tests passed!" << std::endl;
    return 0;
}
