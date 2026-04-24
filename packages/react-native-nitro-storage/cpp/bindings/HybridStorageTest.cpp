#include "HybridStorage.hpp"
#include "../core/NativeStorageAdapter.hpp"
#include <algorithm>
#include <cassert>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

using namespace margelo::nitro::NitroStorage;

class MockAdapter final : public ::NitroStorage::NativeStorageAdapter {
public:
    void setDisk(const std::string& key, const std::string& value) override {
        disk_[key] = value;
    }

    std::optional<std::string> getDisk(const std::string& key) override {
        auto it = disk_.find(key);
        if (it == disk_.end()) return std::nullopt;
        return it->second;
    }

    void deleteDisk(const std::string& key) override {
        disk_.erase(key);
    }

    bool hasDisk(const std::string& key) override {
        return disk_.find(key) != disk_.end();
    }

    std::vector<std::string> getAllKeysDisk() override {
        std::vector<std::string> keys;
        keys.reserve(disk_.size());
        for (const auto& [key, _] : disk_) {
            keys.push_back(key);
        }
        return keys;
    }

    std::vector<std::string> getKeysByPrefixDisk(const std::string& prefix) override {
        std::vector<std::string> keys;
        for (const auto& [key, _] : disk_) {
            if (key.rfind(prefix, 0) == 0) {
                keys.push_back(key);
            }
        }
        return keys;
    }

    size_t sizeDisk() override {
        return disk_.size();
    }

    void setDiskBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values) override {
        const auto count = std::min(keys.size(), values.size());
        for (size_t index = 0; index < count; index += 1) {
            disk_[keys[index]] = values[index];
        }
    }

    std::vector<std::optional<std::string>> getDiskBatch(const std::vector<std::string>& keys) override {
        std::vector<std::optional<std::string>> values;
        values.reserve(keys.size());
        for (const auto& key : keys) {
            values.push_back(getDisk(key));
        }
        return values;
    }

    void deleteDiskBatch(const std::vector<std::string>& keys) override {
        for (const auto& key : keys) {
            disk_.erase(key);
        }
    }

    void setSecure(const std::string& key, const std::string& value) override {
        secure_[key] = value;
    }

    std::optional<std::string> getSecure(const std::string& key) override {
        auto it = secure_.find(key);
        if (it == secure_.end()) return std::nullopt;
        return it->second;
    }

    void deleteSecure(const std::string& key) override {
        secure_.erase(key);
        biometric_.erase(key);
    }

    bool hasSecure(const std::string& key) override {
        return secure_.find(key) != secure_.end() || biometric_.find(key) != biometric_.end();
    }

    std::vector<std::string> getAllKeysSecure() override {
        std::vector<std::string> keys;
        keys.reserve(secure_.size() + biometric_.size());
        for (const auto& [key, _] : secure_) {
            keys.push_back(key);
        }
        for (const auto& [key, _] : biometric_) {
            if (std::find(keys.begin(), keys.end(), key) == keys.end()) {
                keys.push_back(key);
            }
        }
        return keys;
    }

    std::vector<std::string> getKeysByPrefixSecure(const std::string& prefix) override {
        std::vector<std::string> keys;
        const auto all = getAllKeysSecure();
        keys.reserve(all.size());
        for (const auto& key : all) {
            if (key.rfind(prefix, 0) == 0) {
                keys.push_back(key);
            }
        }
        return keys;
    }

    size_t sizeSecure() override {
        return getAllKeysSecure().size();
    }

    void setSecureBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values) override {
        const auto count = std::min(keys.size(), values.size());
        for (size_t index = 0; index < count; index += 1) {
            secure_[keys[index]] = values[index];
        }
    }

    std::vector<std::optional<std::string>> getSecureBatch(const std::vector<std::string>& keys) override {
        std::vector<std::optional<std::string>> values;
        values.reserve(keys.size());
        for (const auto& key : keys) {
            values.push_back(getSecure(key));
        }
        return values;
    }

    void deleteSecureBatch(const std::vector<std::string>& keys) override {
        for (const auto& key : keys) {
            deleteSecure(key);
        }
    }

    void clearDisk() override {
        disk_.clear();
    }

    void clearSecure() override {
        secure_.clear();
        biometric_.clear();
    }

    void setSecureAccessControl(int level) override {
        secureAccessControl_ = level;
    }

    void setSecureWritesAsync(bool enabled) override {
        secureWritesAsync_ = enabled;
        secureWritesAsyncCalls_ += 1;
    }

    void setKeychainAccessGroup(const std::string& group) override {
        keychainGroup_ = group;
    }

    void setSecureBiometric(const std::string& key, const std::string& value) override {
        biometric_[key] = value;
    }

    void setSecureBiometricWithLevel(const std::string& key, const std::string& value, int level) override {
        biometric_[key] = value;
        biometricLevel_ = level;
    }

    std::optional<std::string> getSecureBiometric(const std::string& key) override {
        auto it = biometric_.find(key);
        if (it == biometric_.end()) return std::nullopt;
        return it->second;
    }

    void deleteSecureBiometric(const std::string& key) override {
        biometric_.erase(key);
    }

    bool hasSecureBiometric(const std::string& key) override {
        return biometric_.find(key) != biometric_.end();
    }

    void clearSecureBiometric() override {
        biometric_.clear();
    }

    int secureAccessControl() const { return secureAccessControl_; }
    bool secureWritesAsync() const { return secureWritesAsync_; }
    int secureWritesAsyncCalls() const { return secureWritesAsyncCalls_; }
    const std::string& keychainGroup() const { return keychainGroup_; }
    int biometricLevel() const { return biometricLevel_; }

private:
    std::map<std::string, std::string> disk_;
    std::map<std::string, std::string> secure_;
    std::map<std::string, std::string> biometric_;
    int secureAccessControl_ = 0;
    bool secureWritesAsync_ = false;
    int secureWritesAsyncCalls_ = 0;
    std::string keychainGroup_;
    int biometricLevel_ = -1;
};

class ThrowingAdapter final : public ::NitroStorage::NativeStorageAdapter {
public:
    void setDisk(const std::string&, const std::string&) override {}
    std::optional<std::string> getDisk(const std::string&) override { return std::nullopt; }
    void deleteDisk(const std::string&) override {}
    bool hasDisk(const std::string&) override { return false; }
    std::vector<std::string> getAllKeysDisk() override { return {}; }
    std::vector<std::string> getKeysByPrefixDisk(const std::string&) override { return {}; }
    size_t sizeDisk() override { return 0; }
    void setDiskBatch(const std::vector<std::string>&, const std::vector<std::string>&) override {}
    std::vector<std::optional<std::string>> getDiskBatch(const std::vector<std::string>& keys) override {
        return std::vector<std::optional<std::string>>(keys.size(), std::nullopt);
    }
    void deleteDiskBatch(const std::vector<std::string>&) override {}
    void clearDisk() override {}

    void setSecure(const std::string&, const std::string&) override {
        throw std::runtime_error(
            "[nitro-error:authentication_required] NitroStorage: auth required"
        );
    }
    std::optional<std::string> getSecure(const std::string&) override { return std::nullopt; }
    void deleteSecure(const std::string&) override {}
    bool hasSecure(const std::string&) override { return false; }
    std::vector<std::string> getAllKeysSecure() override { return {}; }
    std::vector<std::string> getKeysByPrefixSecure(const std::string&) override { return {}; }
    size_t sizeSecure() override { return 0; }
    void setSecureBatch(const std::vector<std::string>&, const std::vector<std::string>&) override {}
    std::vector<std::optional<std::string>> getSecureBatch(const std::vector<std::string>& keys) override {
        return std::vector<std::optional<std::string>>(keys.size(), std::nullopt);
    }
    void deleteSecureBatch(const std::vector<std::string>&) override {}
    void clearSecure() override {}
    void setSecureAccessControl(int) override {}
    void setSecureWritesAsync(bool) override {}
    void setKeychainAccessGroup(const std::string&) override {}

    void setSecureBiometric(const std::string&, const std::string&) override {}
    void setSecureBiometricWithLevel(const std::string&, const std::string&, int) override {}
    std::optional<std::string> getSecureBiometric(const std::string&) override { return std::nullopt; }
    void deleteSecureBiometric(const std::string&) override {}
    bool hasSecureBiometric(const std::string&) override { return false; }
    void clearSecureBiometric() override {}
};

class UnknownThrowingAdapter final : public ::NitroStorage::NativeStorageAdapter {
public:
    void setDisk(const std::string&, const std::string&) override { throw 1; }
    std::optional<std::string> getDisk(const std::string&) override { throw 1; }
    void deleteDisk(const std::string&) override { throw 1; }
    bool hasDisk(const std::string&) override { throw 1; }
    std::vector<std::string> getAllKeysDisk() override { throw 1; }
    std::vector<std::string> getKeysByPrefixDisk(const std::string&) override { throw 1; }
    size_t sizeDisk() override { throw 1; }
    void setDiskBatch(const std::vector<std::string>&, const std::vector<std::string>&) override { throw 1; }
    std::vector<std::optional<std::string>> getDiskBatch(const std::vector<std::string>&) override { throw 1; }
    void deleteDiskBatch(const std::vector<std::string>&) override { throw 1; }
    void clearDisk() override { throw 1; }

    void setSecure(const std::string&, const std::string&) override { throw 1; }
    std::optional<std::string> getSecure(const std::string&) override { throw 1; }
    void deleteSecure(const std::string&) override { throw 1; }
    bool hasSecure(const std::string&) override { throw 1; }
    std::vector<std::string> getAllKeysSecure() override { throw 1; }
    std::vector<std::string> getKeysByPrefixSecure(const std::string&) override { throw 1; }
    size_t sizeSecure() override { throw 1; }
    void setSecureBatch(const std::vector<std::string>&, const std::vector<std::string>&) override { throw 1; }
    std::vector<std::optional<std::string>> getSecureBatch(const std::vector<std::string>&) override { throw 1; }
    void deleteSecureBatch(const std::vector<std::string>&) override { throw 1; }
    void clearSecure() override { throw 1; }
    void setSecureAccessControl(int) override {}
    void setSecureWritesAsync(bool) override {}
    void setKeychainAccessGroup(const std::string&) override {}

    void setSecureBiometric(const std::string&, const std::string&) override { throw 1; }
    void setSecureBiometricWithLevel(const std::string&, const std::string&, int) override { throw 1; }
    std::optional<std::string> getSecureBiometric(const std::string&) override { throw 1; }
    void deleteSecureBiometric(const std::string&) override { throw 1; }
    bool hasSecureBiometric(const std::string&) override { throw 1; }
    void clearSecureBiometric() override { throw 1; }
};

bool contains(const std::vector<std::string>& values, const std::string& value) {
    return std::find(values.begin(), values.end(), value) != values.end();
}

void expectThrows(const std::function<void()>& fn) {
    bool threw = false;
    try {
        fn();
    } catch (...) {
        threw = true;
    }
    assert(threw);
}

void testSetGetAcrossScopes() {
    auto adapter = std::make_shared<MockAdapter>();
    HybridStorage storage(adapter);

    storage.set("memory-key", "memory-value", 0.0);
    storage.set("disk-key", "disk-value", 1.0);
    storage.set("secure-key", "secure-value", 2.0);

    assert(storage.get("memory-key", 0.0).value() == "memory-value");
    assert(storage.get("disk-key", 1.0).value() == "disk-value");
    assert(storage.get("secure-key", 2.0).value() == "secure-value");
}

void testRemoveGetAllSizeAndClearAcrossScopes() {
    auto adapter = std::make_shared<MockAdapter>();
    HybridStorage storage(adapter);

    storage.set("memory-a", "1", 0.0);
    storage.set("memory-b", "2", 0.0);
    storage.set("disk-a", "1", 1.0);
    storage.set("disk-b", "2", 1.0);
    storage.set("secure-a", "1", 2.0);

    assert(storage.has("memory-a", 0.0));
    assert(storage.size(0.0) == 2.0);
    assert(storage.size(1.0) == 2.0);
    assert(storage.size(2.0) == 1.0);

    const auto memoryKeys = storage.getAllKeys(0.0);
    const auto diskKeys = storage.getAllKeys(1.0);
    const auto secureKeys = storage.getAllKeys(2.0);
    assert(contains(memoryKeys, "memory-a"));
    assert(contains(diskKeys, "disk-a"));
    assert(contains(secureKeys, "secure-a"));

    assert(storage.getKeysByPrefix("", 0.0).size() == memoryKeys.size());
    assert(storage.getKeysByPrefix("memory-", 0.0).size() == 2);
    assert(storage.get("missing", 0.0) == std::nullopt);

    storage.remove("memory-a", 0.0);
    storage.remove("disk-a", 1.0);
    storage.remove("secure-a", 2.0);
    assert(!storage.has("memory-a", 0.0));
    assert(!storage.has("disk-a", 1.0));
    assert(!storage.has("secure-a", 2.0));

    storage.clear(0.0);
    storage.clear(1.0);
    assert(storage.size(0.0) == 0.0);
    assert(storage.size(1.0) == 0.0);
}

void testBatchMissingSentinel() {
    auto adapter = std::make_shared<MockAdapter>();
    HybridStorage storage(adapter);

    storage.set("existing", "value", 1.0);

    const auto values = storage.getBatch({"existing", "missing"}, 1.0);
    assert(values.size() == 2);
    assert(values[0] == "value");
    assert(values[1] == "__nitro_storage_batch_missing__::v1");
}

void testMemoryAndSecureBatchPaths() {
    auto adapter = std::make_shared<MockAdapter>();
    HybridStorage storage(adapter);

    storage.setBatch({"m1", "m2"}, {"one", "two"}, 0.0);
    auto memoryValues = storage.getBatch({"m1", "missing"}, 0.0);
    assert(memoryValues[0] == "one");
    assert(memoryValues[1] == "__nitro_storage_batch_missing__::v1");
    storage.removeBatch({"m1", "m2"}, 0.0);
    assert(storage.getBatch({"m1"}, 0.0)[0] == "__nitro_storage_batch_missing__::v1");

    storage.setBatch({"s1", "s2"}, {"secure-one", "secure-two"}, 2.0);
    auto secureValues = storage.getBatch({"s1", "missing"}, 2.0);
    assert(secureValues[0] == "secure-one");
    assert(secureValues[1] == "__nitro_storage_batch_missing__::v1");
    storage.removeBatch({"s1", "s2"}, 2.0);
    assert(!storage.has("s1", 2.0));

    expectThrows([&]() {
        storage.setBatch({"one"}, {"a", "b"}, 0.0);
    });
}

void testBatchListeners() {
    auto adapter = std::make_shared<MockAdapter>();
    auto storage = std::make_shared<HybridStorage>(adapter);
    std::vector<std::pair<std::string, std::optional<std::string>>> events;

    auto unsubscribe = storage->addOnChange(1.0, [&](const std::string& key, const std::optional<std::string>& value) {
        events.push_back({key, value});
    });

    storage->setBatch({"a", "b"}, {"1", "2"}, 1.0);
    storage->removeBatch({"a", "b"}, 1.0);

    assert(events.size() == 4);
    assert(events[0].first == "a" && events[0].second.has_value() && events[0].second.value() == "1");
    assert(events[1].first == "b" && events[1].second.has_value() && events[1].second.value() == "2");
    assert(events[2].first == "a" && !events[2].second.has_value());
    assert(events[3].first == "b" && !events[3].second.has_value());

    unsubscribe();
    unsubscribe();
}

void testListenerExceptionsAreIgnored() {
    auto adapter = std::make_shared<MockAdapter>();
    auto storage = std::make_shared<HybridStorage>(adapter);
    bool secondListenerCalled = false;

    auto unsubscribeThrowing = storage->addOnChange(0.0, [](const std::string&, const std::optional<std::string>&) {
        throw std::runtime_error("listener failed");
    });
    auto unsubscribeSecond = storage->addOnChange(0.0, [&](const std::string&, const std::optional<std::string>&) {
        secondListenerCalled = true;
    });

    storage->set("listener-key", "value", 0.0);

    assert(secondListenerCalled);
    unsubscribeThrowing();
    unsubscribeSecond();
}

void testSecureConfigPassThrough() {
    auto adapter = std::make_shared<MockAdapter>();
    HybridStorage storage(adapter);

    storage.setSecureAccessControl(4.0);
    storage.setSecureWritesAsync(true);
    storage.setKeychainAccessGroup("group.test");

    assert(adapter->secureAccessControl() == 4);
    assert(adapter->secureWritesAsync());
    assert(adapter->secureWritesAsyncCalls() == 1);
    assert(adapter->keychainGroup() == "group.test");
}

void testRemoveByPrefix() {
    auto adapter = std::make_shared<MockAdapter>();
    HybridStorage storage(adapter);

    storage.removeByPrefix("", 1.0);
    storage.removeByPrefix("missing:", 1.0);

    storage.set("session:token", "t1", 1.0);
    storage.set("session:user", "u1", 1.0);
    storage.set("profile:user", "p1", 1.0);

    storage.removeByPrefix("session:", 1.0);

    assert(!storage.has("session:token", 1.0));
    assert(!storage.has("session:user", 1.0));
    assert(storage.has("profile:user", 1.0));
}

void testGetKeysByPrefix() {
    auto adapter = std::make_shared<MockAdapter>();
    HybridStorage storage(adapter);

    storage.set("session:token", "a", 1.0);
    storage.set("session:user", "b", 1.0);
    storage.set("profile:name", "c", 1.0);

    const auto keys = storage.getKeysByPrefix("session:", 1.0);
    assert(keys.size() == 2);
}

void testBiometricLevelPassThrough() {
    auto adapter = std::make_shared<MockAdapter>();
    HybridStorage storage(adapter);

    storage.setSecureBiometricWithLevel("bio-key", "bio-value", 1.0);
    assert(adapter->biometricLevel() == 1);
}

void testBiometricMethods() {
    auto adapter = std::make_shared<MockAdapter>();
    auto storage = std::make_shared<HybridStorage>(adapter);
    std::vector<std::pair<std::string, std::optional<std::string>>> events;

    auto unsubscribe = storage->addOnChange(2.0, [&](const std::string& key, const std::optional<std::string>& value) {
        events.push_back({key, value});
    });

    storage->setSecureBiometric("bio-default", "default-value");
    assert(adapter->biometricLevel() == 2);
    assert(storage->hasSecureBiometric("bio-default"));
    assert(storage->getSecureBiometric("bio-default").value() == "default-value");

    storage->deleteSecureBiometric("bio-default");
    assert(!storage->hasSecureBiometric("bio-default"));

    storage->setSecureBiometricWithLevel("bio-clear", "clear-value", 0.0);
    assert(storage->has("bio-clear", 2.0));
    storage->clearSecureBiometric();
    assert(!storage->has("bio-clear", 2.0));
    assert(!events.empty());

    unsubscribe();
}

void testClearNotifiesScope() {
    auto adapter = std::make_shared<MockAdapter>();
    auto storage = std::make_shared<HybridStorage>(adapter);
    std::vector<std::string> keys;

    auto unsubscribe = storage->addOnChange(2.0, [&](const std::string& key, const std::optional<std::string>&) {
        keys.push_back(key);
    });

    storage->clear(2.0);
    assert(keys.size() == 1);
    assert(keys[0].empty());
    unsubscribe();
}

void testInvalidInputsAndMissingAdapter() {
    auto adapter = std::make_shared<MockAdapter>();
    HybridStorage storage(adapter);
    const auto nan = std::numeric_limits<double>::quiet_NaN();

    expectThrows([&]() { storage.set("bad", "value", -1.0); });
    expectThrows([&]() { storage.set("bad", "value", 1.5); });
    expectThrows([&]() { storage.set("bad", "value", nan); });
    expectThrows([&]() { storage.setSecureAccessControl(nan); });
    expectThrows([&]() { storage.setSecureAccessControl(5.0); });
    expectThrows([&]() { storage.setSecureBiometricWithLevel("bad", "value", nan); });
    expectThrows([&]() { storage.setSecureBiometricWithLevel("bad", "value", 3.0); });

    HybridStorage missingAdapter(nullptr);
    expectThrows([&]() { missingAdapter.set("disk", "value", 1.0); });
    expectThrows([&]() { missingAdapter.setSecureWritesAsync(true); });

    HybridStorage defaultStorage;
    expectThrows([&]() { defaultStorage.get("disk", 1.0); });
}

void testNativeTaggedErrorsPassThrough() {
    auto adapter = std::make_shared<ThrowingAdapter>();
    HybridStorage storage(adapter);

    try {
        storage.set("secure-key", "secure-value", 2.0);
        assert(false && "Expected secure set to throw");
    } catch (const std::runtime_error& error) {
        assert(
            std::string(error.what()) ==
            "[nitro-error:authentication_required] NitroStorage: auth required"
        );
    }
}

void testHydratedKeyIndexUpdates() {
    auto adapter = std::make_shared<MockAdapter>();
    HybridStorage storage(adapter);

    storage.set("disk-a", "1", 1.0);
    assert(storage.has("disk-a", 1.0));

    storage.set("disk-b", "2", 1.0);
    assert(storage.has("disk-b", 1.0));
    assert(storage.getKeysByPrefix("disk-", 1.0).size() == 2);

    storage.remove("disk-b", 1.0);
    assert(!storage.has("disk-b", 1.0));

    storage.clear(1.0);
    assert(storage.getAllKeys(1.0).empty());
}

void testUnknownNativeFailuresAreWrapped() {
    auto adapter = std::make_shared<UnknownThrowingAdapter>();
    HybridStorage storage(adapter);

    expectThrows([&]() { storage.set("disk", "value", 1.0); });
    expectThrows([&]() { storage.get("disk", 1.0); });
    expectThrows([&]() { storage.remove("disk", 1.0); });
    expectThrows([&]() { storage.clear(1.0); });
    expectThrows([&]() { storage.setBatch({"disk"}, {"value"}, 1.0); });
    expectThrows([&]() { storage.getBatch({"disk"}, 1.0); });
    expectThrows([&]() { storage.removeBatch({"disk"}, 1.0); });

    expectThrows([&]() { storage.set("secure", "value", 2.0); });
    expectThrows([&]() { storage.get("secure", 2.0); });
    expectThrows([&]() { storage.remove("secure", 2.0); });
    expectThrows([&]() { storage.clear(2.0); });
    expectThrows([&]() { storage.setBatch({"secure"}, {"value"}, 2.0); });
    expectThrows([&]() { storage.getBatch({"secure"}, 2.0); });
    expectThrows([&]() { storage.removeBatch({"secure"}, 2.0); });

    expectThrows([&]() { storage.has("secure", 2.0); });
    expectThrows([&]() { storage.setSecureBiometric("bio", "value"); });
    expectThrows([&]() { storage.getSecureBiometric("bio"); });
    expectThrows([&]() { storage.deleteSecureBiometric("bio"); });
    expectThrows([&]() { storage.clearSecureBiometric(); });
}

int main() {
    std::cout << "Running HybridStorage C++ Tests..." << std::endl;

    testSetGetAcrossScopes();
    testRemoveGetAllSizeAndClearAcrossScopes();
    testBatchMissingSentinel();
    testMemoryAndSecureBatchPaths();
    testBatchListeners();
    testListenerExceptionsAreIgnored();
    testSecureConfigPassThrough();
    testRemoveByPrefix();
    testGetKeysByPrefix();
    testBiometricLevelPassThrough();
    testBiometricMethods();
    testClearNotifiesScope();
    testInvalidInputsAndMissingAdapter();
    testNativeTaggedErrorsPassThrough();
    testHydratedKeyIndexUpdates();
    testUnknownNativeFailuresAreWrapped();

    std::cout << "✅ HybridStorage C++ tests passed!" << std::endl;
    return 0;
}
