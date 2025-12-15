#include "NativeStorageAdapter.hpp"
#include <cassert>
#include <iostream>
#include <memory>
#include <vector>
#include <thread>
#include <map>
#include <mutex>

using namespace ::NitroStorage;

class MockNativeAdapter : public NativeStorageAdapter {
private:
    std::map<std::string, std::string> diskStore_;
    std::map<std::string, std::string> secureStore_;
    std::mutex diskMutex_;
    std::mutex secureMutex_;

public:
    void setDisk(const std::string& key, const std::string& value) override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        diskStore_[key] = value;
    }

    std::optional<std::string> getDisk(const std::string& key) override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        auto it = diskStore_.find(key);
        if (it != diskStore_.end()) {
            return it->second;
        }
        return std::nullopt;
    }

    void deleteDisk(const std::string& key) override {
        std::lock_guard<std::mutex> lock(diskMutex_);
        diskStore_.erase(key);
    }

    void setSecure(const std::string& key, const std::string& value) override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        secureStore_[key] = value;
    }

    std::optional<std::string> getSecure(const std::string& key) override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        auto it = secureStore_.find(key);
        if (it != secureStore_.end()) {
            return it->second;
        }
        return std::nullopt;
    }

    void deleteSecure(const std::string& key) override {
        std::lock_guard<std::mutex> lock(secureMutex_);
        secureStore_.erase(key);
    }
};

void testDiskStorage() {
    std::cout << "Testing Disk Storage..." << std::endl;
    
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

    std::cout << "✓ Disk Storage tests passed" << std::endl;
}

void testSecureStorage() {
    std::cout << "Testing Secure Storage..." << std::endl;
    
    auto adapter = std::make_shared<MockNativeAdapter>();

    adapter->setSecure("secure-key", "secure-value");
    auto result = adapter->getSecure("secure-key");
    assert(result.has_value() && result.value() == "secure-value");

    adapter->deleteSecure("secure-key");
    result = adapter->getSecure("secure-key");
    assert(!result.has_value());

    std::cout << "✓ Secure Storage tests passed" << std::endl;
}

void testThreadSafety() {
    std::cout << "Testing Thread Safety..." << std::endl;
    
    auto adapter = std::make_shared<MockNativeAdapter>();

    const int numThreads = 10;
    const int opsPerThread = 100;
    std::vector<std::thread> threads;

    for (int t = 0; t < numThreads; ++t) {
        threads.emplace_back([&adapter, t, opsPerThread]() {
            for (int i = 0; i < opsPerThread; ++i) {
                std::string key = "key-" + std::to_string(t) + "-" + std::to_string(i);
                std::string value = "value-" + std::to_string(i);
                
                adapter->setDisk(key, value);
                auto result = adapter->getDisk(key);
                assert(result.has_value());
                adapter->deleteDisk(key);
            }
        });
    }

    for (auto& thread : threads) {
        thread.join();
    }

    std::cout << "✓ Thread Safety tests passed" << std::endl;
}

void testMultipleKeys() {
    std::cout << "Testing Multiple Keys..." << std::endl;
    
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

    std::cout << "✓ Multiple Keys tests passed" << std::endl;
}

int main() {
    std::cout << "Running C++ Storage Tests..." << std::endl << std::endl;

    testDiskStorage();
    testSecureStorage();
    testThreadSafety();
    testMultipleKeys();

    std::cout << std::endl << "✅ All C++ tests passed!" << std::endl;
    return 0;
}
