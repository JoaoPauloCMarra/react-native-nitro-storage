#include "HybridStorage.hpp"
#include "../core/NativeStorageAdapter.hpp"
#include "../../android/src/main/cpp/JniSize.hpp"

#include <cfloat>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

using namespace margelo::nitro::NitroStorage;

namespace {

void require(bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "HybridStorage failure test assertion failed: " << message << std::endl;
        std::abort();
    }
}

enum class FailureMode { None, Tagged, Unknown, Partial };

class FailingAdapter final : public ::NitroStorage::NativeStorageAdapter {
public:
    FailureMode mode = FailureMode::None;
    size_t partialAppliedCount = 0;
    size_t reportedSize = 0;
    int calls = 0;
    std::vector<std::string> log;

    static std::string taggedMessage(const std::string& method) {
        const bool disk = method.find("Disk") != std::string::npos;
        return std::string(disk ? "[nitro-error:storage_full]" : "[nitro-error:keychain_locked]") +
            " NitroStorage: " + method + " failed";
    }

    void setDisk(const std::string&, const std::string&) override { enter("setDisk"); }
    std::optional<std::string> getDisk(const std::string&) override {
        enter("getDisk");
        return std::nullopt;
    }
    void deleteDisk(const std::string&) override { enter("deleteDisk"); }
    bool hasDisk(const std::string&) override {
        enter("hasDisk");
        return false;
    }
    std::vector<std::string> getAllKeysDisk() override {
        enter("getAllKeysDisk");
        return {};
    }
    std::vector<std::string> getKeysByPrefixDisk(const std::string&) override {
        enter("getKeysByPrefixDisk");
        return prefixKeys;
    }
    size_t sizeDisk() override {
        enter("sizeDisk");
        return reportedSize;
    }
    void setDiskBatch(const std::vector<std::string>&, const std::vector<std::string>&) override {
        enter("setDiskBatch");
    }
    std::vector<std::optional<std::string>> getDiskBatch(const std::vector<std::string>& keys) override {
        enter("getDiskBatch");
        return std::vector<std::optional<std::string>>(keys.size());
    }
    void deleteDiskBatch(const std::vector<std::string>&) override { enter("deleteDiskBatch"); }

    void setSecure(const std::string&, const std::string&) override { enter("setSecure"); }
    std::optional<std::string> getSecure(const std::string&) override {
        enter("getSecure");
        return std::nullopt;
    }
    void deleteSecure(const std::string&) override { enter("deleteSecure"); }
    bool hasSecure(const std::string&) override {
        enter("hasSecure");
        return false;
    }
    std::vector<std::string> getAllKeysSecure() override {
        enter("getAllKeysSecure");
        return {};
    }
    std::vector<std::string> getKeysByPrefixSecure(const std::string&) override {
        enter("getKeysByPrefixSecure");
        return prefixKeys;
    }
    size_t sizeSecure() override {
        enter("sizeSecure");
        return reportedSize;
    }
    void setSecureBatch(const std::vector<std::string>&, const std::vector<std::string>&) override {
        enter("setSecureBatch");
    }
    std::vector<std::optional<std::string>> getSecureBatch(const std::vector<std::string>& keys) override {
        enter("getSecureBatch");
        return std::vector<std::optional<std::string>>(keys.size());
    }
    void deleteSecureBatch(const std::vector<std::string>&) override { enter("deleteSecureBatch"); }

    void clearDisk() override { enter("clearDisk"); }
    void clearSecure() override { enter("clearSecure"); }

    void setSecureAccessControl(int level) override {
        enter("setSecureAccessControl");
        accessControl = level;
    }
    void setSecureWritesAsync(bool) override { enter("setSecureWritesAsync"); }
    void setKeychainAccessGroup(const std::string&) override { enter("setKeychainAccessGroup"); }

    void setSecureBiometric(const std::string&, const std::string&) override { enter("setSecureBiometric"); }
    void setSecureBiometricWithLevel(const std::string&, const std::string&, int level) override {
        enter("setSecureBiometricWithLevel");
        biometricLevel = level;
    }
    std::optional<std::string> getSecureBiometric(const std::string&) override {
        enter("getSecureBiometric");
        return std::nullopt;
    }
    void deleteSecureBiometric(const std::string&) override { enter("deleteSecureBiometric"); }
    bool hasSecureBiometric(const std::string&) override {
        enter("hasSecureBiometric");
        return false;
    }
    void clearSecureBiometric() override { enter("clearSecureBiometric"); }

    std::vector<std::string> prefixKeys;
    int accessControl = -1;
    int biometricLevel = -1;

private:
    void enter(const std::string& method) {
        calls += 1;
        log.push_back(method);
        switch (mode) {
            case FailureMode::None:
                return;
            case FailureMode::Tagged:
                throw std::runtime_error(taggedMessage(method));
            case FailureMode::Unknown:
                throw 1;
            case FailureMode::Partial:
                throw ::NitroStorage::PartialBatchError(partialAppliedCount, taggedMessage(method));
        }
    }
};

struct Operation {
    std::string adapterMethod;
    std::function<void(HybridStorage&)> run;
};

std::vector<Operation> adapterOperations() {
    return {
        {"setDisk", [](HybridStorage& s) { s.set("k", "v", 1.0); }},
        {"getDisk", [](HybridStorage& s) { (void)s.get("k", 1.0); }},
        {"deleteDisk", [](HybridStorage& s) { s.remove("k", 1.0); }},
        {"hasDisk", [](HybridStorage& s) { (void)s.has("k", 1.0); }},
        {"getAllKeysDisk", [](HybridStorage& s) { (void)s.getAllKeys(1.0); }},
        {"getAllKeysDisk", [](HybridStorage& s) { (void)s.getKeysByPrefix("", 1.0); }},
        {"getKeysByPrefixDisk", [](HybridStorage& s) { (void)s.getKeysByPrefix("p", 1.0); }},
        {"getKeysByPrefixDisk", [](HybridStorage& s) { s.removeByPrefix("p", 1.0); }},
        {"sizeDisk", [](HybridStorage& s) { (void)s.size(1.0); }},
        {"setDiskBatch", [](HybridStorage& s) { s.setBatch({"a", "b"}, {"1", "2"}, 1.0); }},
        {"getDiskBatch", [](HybridStorage& s) { (void)s.getBatch({"a"}, 1.0); }},
        {"deleteDiskBatch", [](HybridStorage& s) { s.removeBatch({"a", "b"}, 1.0); }},
        {"clearDisk", [](HybridStorage& s) { s.clear(1.0); }},
        {"setSecure", [](HybridStorage& s) { s.set("k", "v", 2.0); }},
        {"getSecure", [](HybridStorage& s) { (void)s.get("k", 2.0); }},
        {"deleteSecure", [](HybridStorage& s) { s.remove("k", 2.0); }},
        {"hasSecure", [](HybridStorage& s) { (void)s.has("k", 2.0); }},
        {"getAllKeysSecure", [](HybridStorage& s) { (void)s.getAllKeys(2.0); }},
        {"getKeysByPrefixSecure", [](HybridStorage& s) { (void)s.getKeysByPrefix("p", 2.0); }},
        {"getKeysByPrefixSecure", [](HybridStorage& s) { s.removeByPrefix("p", 2.0); }},
        {"sizeSecure", [](HybridStorage& s) { (void)s.size(2.0); }},
        {"setSecureBatch", [](HybridStorage& s) { s.setBatch({"a", "b"}, {"1", "2"}, 2.0); }},
        {"getSecureBatch", [](HybridStorage& s) { (void)s.getBatch({"a"}, 2.0); }},
        {"deleteSecureBatch", [](HybridStorage& s) { s.removeBatch({"a", "b"}, 2.0); }},
        {"clearSecure", [](HybridStorage& s) { s.clear(2.0); }},
        {"setSecureAccessControl", [](HybridStorage& s) { s.setSecureAccessControl(1.0); }},
        {"setSecureWritesAsync", [](HybridStorage& s) { s.setSecureWritesAsync(true); }},
        {"setKeychainAccessGroup", [](HybridStorage& s) { s.setKeychainAccessGroup("group"); }},
        {"setSecureBiometricWithLevel", [](HybridStorage& s) { s.setSecureBiometric("k", "v"); }},
        {"setSecureBiometricWithLevel", [](HybridStorage& s) { s.setSecureBiometricWithLevel("k", "v", 1.0); }},
        {"getSecureBiometric", [](HybridStorage& s) { (void)s.getSecureBiometric("k"); }},
        {"deleteSecureBiometric", [](HybridStorage& s) { s.deleteSecureBiometric("k"); }},
        {"hasSecureBiometric", [](HybridStorage& s) { (void)s.hasSecureBiometric("k"); }},
        {"clearSecureBiometric", [](HybridStorage& s) { s.clearSecureBiometric(); }},
    };
}

struct Outcome {
    bool threw = false;
    bool stdException = false;
    std::string message;
};

Outcome outcomeOf(const std::function<void()>& operation) {
    Outcome outcome;
    try {
        operation();
    } catch (const std::exception& error) {
        outcome.threw = true;
        outcome.stdException = true;
        outcome.message = error.what();
    } catch (...) {
        outcome.threw = true;
    }
    return outcome;
}

void testEveryAdapterFailureKeepsItsTagAndNotifiesNobody() {
    for (const auto& operation : adapterOperations()) {
        auto adapter = std::make_shared<FailingAdapter>();
        auto storage = std::make_shared<HybridStorage>(adapter);
        int notifications = 0;
        auto unsubscribeDisk = storage->addOnChange(1.0, [&](const std::string&, const std::optional<std::string>&) {
            notifications += 1;
        });
        auto unsubscribeSecure = storage->addOnChange(2.0, [&](const std::string&, const std::optional<std::string>&) {
            notifications += 1;
        });
        adapter->mode = FailureMode::Tagged;
        const Outcome outcome = outcomeOf([&] { operation.run(*storage); });
        require(outcome.stdException, operation.adapterMethod + " failure must reach the caller");
        require(
            outcome.message == FailingAdapter::taggedMessage(operation.adapterMethod),
            operation.adapterMethod + " must keep the native message, got: " + outcome.message
        );
        require(notifications == 0, operation.adapterMethod + " failure must not notify listeners");
        require(adapter->calls == 1, operation.adapterMethod + " must stop at the first native failure");
        unsubscribeDisk();
        unsubscribeSecure();
    }
}

void testUnknownAdapterFailuresBecomeStdExceptions() {
    for (const auto& operation : adapterOperations()) {
        auto adapter = std::make_shared<FailingAdapter>();
        HybridStorage storage(adapter);
        adapter->mode = FailureMode::Unknown;
        const Outcome outcome = outcomeOf([&] { operation.run(storage); });
        require(outcome.threw, operation.adapterMethod + " unknown failure must throw");
        require(
            outcome.stdException,
            operation.adapterMethod + " unknown failure must be converted to std::exception"
        );
        require(
            outcome.message.rfind("NitroStorage: ", 0) == 0 &&
                outcome.message.find("failed (unknown error)") != std::string::npos,
            operation.adapterMethod + " unknown failure message, got: " + outcome.message
        );
    }
}

void testMissingAdapterIsReportedByEveryNativeOperation() {
    for (const auto& operation : adapterOperations()) {
        HybridStorage storage(nullptr);
        const Outcome outcome = outcomeOf([&] { operation.run(storage); });
        require(
            outcome.message == "NitroStorage: Native adapter not initialized",
            operation.adapterMethod + " without adapter, got: " + outcome.message
        );
    }
    HybridStorage memoryOnly(nullptr);
    memoryOnly.set("k", "v", 0.0);
    memoryOnly.setBatch({"a"}, {"1"}, 0.0);
    memoryOnly.removeByPrefix("a", 0.0);
    require(memoryOnly.get("k", 0.0).value() == "v" && memoryOnly.size(0.0) == 1.0, "memory scope needs no adapter");
}

std::vector<double> invalidNumbers(double maxValid) {
    const double nan = std::numeric_limits<double>::quiet_NaN();
    const double inf = std::numeric_limits<double>::infinity();
    return {
        nan,
        -nan,
        std::numeric_limits<double>::signaling_NaN(),
        inf,
        -inf,
        -1.0,
        -0.5,
        -DBL_MIN,
        -std::numeric_limits<double>::denorm_min(),
        std::numeric_limits<double>::denorm_min(),
        DBL_MIN,
        0.5,
        1.5,
        maxValid + 0.0000001,
        maxValid + 1.0,
        255.0,
        256.0,
        65536.0,
        2147483647.0,
        2147483648.0,
        4294967296.0,
        4294967297.0,
        -2147483648.0,
        -2147483649.0,
        9007199254740993.0,
        1e300,
        -1e300,
        DBL_MAX,
        -DBL_MAX,
    };
}

void testEveryScopeArgumentRejectsInvalidNumbers() {
    const std::vector<std::pair<std::string, std::function<void(HybridStorage&, double)>>> scoped = {
        {"set", [](HybridStorage& s, double scope) { s.set("k", "v", scope); }},
        {"get", [](HybridStorage& s, double scope) { (void)s.get("k", scope); }},
        {"remove", [](HybridStorage& s, double scope) { s.remove("k", scope); }},
        {"clear", [](HybridStorage& s, double scope) { s.clear(scope); }},
        {"has", [](HybridStorage& s, double scope) { (void)s.has("k", scope); }},
        {"getAllKeys", [](HybridStorage& s, double scope) { (void)s.getAllKeys(scope); }},
        {"getKeysByPrefix", [](HybridStorage& s, double scope) { (void)s.getKeysByPrefix("p", scope); }},
        {"getKeysByPrefix-empty", [](HybridStorage& s, double scope) { (void)s.getKeysByPrefix("", scope); }},
        {"size", [](HybridStorage& s, double scope) { (void)s.size(scope); }},
        {"setBatch", [](HybridStorage& s, double scope) { s.setBatch({"a"}, {"1"}, scope); }},
        {"getBatch", [](HybridStorage& s, double scope) { (void)s.getBatch({"a"}, scope); }},
        {"removeBatch", [](HybridStorage& s, double scope) { s.removeBatch({"a"}, scope); }},
        {"removeByPrefix", [](HybridStorage& s, double scope) { s.removeByPrefix("p", scope); }},
        {"removeByPrefix-empty", [](HybridStorage& s, double scope) { s.removeByPrefix("", scope); }},
        {"addOnChange", [](HybridStorage& s, double scope) {
            (void)s.addOnChange(scope, [](const std::string&, const std::optional<std::string>&) {});
        }},
    };
    for (const auto& [name, run] : scoped) {
        for (const double value : invalidNumbers(2.0)) {
            auto adapter = std::make_shared<FailingAdapter>();
            auto storage = std::make_shared<HybridStorage>(adapter);
            const Outcome outcome = outcomeOf([&] { run(*storage, value); });
            require(
                outcome.message == "NitroStorage: Invalid scope value",
                name + " must reject scope " + std::to_string(value) + ", got: " + outcome.message
            );
            require(adapter->calls == 0, name + " must not reach the adapter with an invalid scope");
            require(storage->size(0.0) == 0.0, name + " must not write memory with an invalid scope");
        }
    }

    auto adapter = std::make_shared<FailingAdapter>();
    HybridStorage storage(adapter);
    storage.set("zero", "v", -0.0);
    require(storage.get("zero", 0.0).value() == "v", "negative zero is the Memory scope");
    storage.set("disk", "v", 1.0);
    storage.set("secure", "v", 2.0);
    require((adapter->log == std::vector<std::string>{"setDisk", "setSecure"}), "valid scopes reach the adapter");
}

void testAccessControlAndBiometricLevelRejectInvalidNumbers() {
    for (const double value : invalidNumbers(4.0)) {
        auto adapter = std::make_shared<FailingAdapter>();
        HybridStorage storage(adapter);
        const Outcome outcome = outcomeOf([&] { storage.setSecureAccessControl(value); });
        require(
            outcome.message.rfind("NitroStorage: Invalid access control level", 0) == 0,
            "access control must reject " + std::to_string(value) + ", got: " + outcome.message
        );
        require(adapter->calls == 0, "invalid access control must not reach the adapter");
    }
    for (const double value : invalidNumbers(2.0)) {
        auto adapter = std::make_shared<FailingAdapter>();
        auto storage = std::make_shared<HybridStorage>(adapter);
        int notifications = 0;
        auto unsubscribe = storage->addOnChange(2.0, [&](const std::string&, const std::optional<std::string>&) {
            notifications += 1;
        });
        const Outcome outcome = outcomeOf([&] { storage->setSecureBiometricWithLevel("k", "v", value); });
        require(
            outcome.message.rfind("NitroStorage: Invalid biometric level", 0) == 0,
            "biometric level must reject " + std::to_string(value) + ", got: " + outcome.message
        );
        require(adapter->calls == 0 && notifications == 0, "invalid biometric level must have no effect");
        unsubscribe();
    }
    for (int level = 0; level <= 4; ++level) {
        auto adapter = std::make_shared<FailingAdapter>();
        HybridStorage storage(adapter);
        storage.setSecureAccessControl(static_cast<double>(level));
        require(adapter->accessControl == level, "valid access control level must pass through");
    }
    for (int level = 0; level <= 2; ++level) {
        auto adapter = std::make_shared<FailingAdapter>();
        HybridStorage storage(adapter);
        storage.setSecureBiometricWithLevel("k", "v", static_cast<double>(level));
        require(adapter->biometricLevel == level, "valid biometric level must pass through");
    }
}

void testBatchLengthMismatchIsRejectedBeforeAnyEffect() {
    const std::string expected = "NitroStorage: Keys and values size mismatch in setBatch";
    for (const double scope : {0.0, 1.0, 2.0, 7.0, std::numeric_limits<double>::quiet_NaN()}) {
        auto adapter = std::make_shared<FailingAdapter>();
        auto storage = std::make_shared<HybridStorage>(adapter);
        int notifications = 0;
        std::vector<std::function<void()>> unsubscribers;
        for (const double listenerScope : {0.0, 1.0, 2.0}) {
            unsubscribers.push_back(storage->addOnChange(
                listenerScope,
                [&](const std::string&, const std::optional<std::string>&) { notifications += 1; }
            ));
        }
        require(outcomeOf([&] { storage->setBatch({"a", "b"}, {"1"}, scope); }).message == expected, "more keys");
        require(outcomeOf([&] { storage->setBatch({"a"}, {"1", "2"}, scope); }).message == expected, "more values");
        require(outcomeOf([&] { storage->setBatch({}, {"1"}, scope); }).message == expected, "no keys");
        require(adapter->calls == 0 && notifications == 0, "mismatched batch must have no effect");
        require(storage->size(0.0) == 0.0, "mismatched batch must not write memory");
        for (auto& unsubscribe : unsubscribers) {
            unsubscribe();
        }
    }
}

void testPartialBatchFailureNotifiesOnlyAppliedKeys() {
    for (const size_t applied : {size_t{0}, size_t{1}, size_t{3}, size_t{99}, std::numeric_limits<size_t>::max()}) {
        auto adapter = std::make_shared<FailingAdapter>();
        auto storage = std::make_shared<HybridStorage>(adapter);
        std::vector<std::string> notified;
        auto unsubscribe = storage->addOnChange(2.0, [&](const std::string& key, const std::optional<std::string>&) {
            notified.push_back(key);
        });
        adapter->mode = FailureMode::Partial;
        adapter->partialAppliedCount = applied;
        const size_t expected = applied < 3 ? applied : 3;

        bool partial = false;
        try {
            storage->setBatch({"a", "b", "c"}, {"1", "2", "3"}, 2.0);
        } catch (const ::NitroStorage::PartialBatchError& error) {
            partial = error.appliedCount() == applied &&
                std::string(error.what()) == FailingAdapter::taggedMessage("setSecureBatch");
        }
        require(partial, "setBatch must rethrow the original PartialBatchError");
        require(notified.size() == expected, "setBatch must notify only applied keys");

        notified.clear();
        partial = false;
        try {
            storage->removeBatch({"a", "b", "c"}, 2.0);
        } catch (const ::NitroStorage::PartialBatchError& error) {
            partial = error.appliedCount() == applied;
        }
        require(partial, "removeBatch must rethrow the original PartialBatchError");
        require(notified.size() == expected, "removeBatch must notify only applied keys");
        unsubscribe();
    }
}

void testListenersMayThrowAnythingAndMutateListenersDuringNotify() {
    auto adapter = std::make_shared<FailingAdapter>();
    auto storage = std::make_shared<HybridStorage>(adapter);
    std::vector<std::string> events;
    std::function<void()> unsubscribeSelf;
    std::function<void()> unsubscribeLate;
    std::function<void()> unsubscribeVictim;

    auto unsubscribeThrowsInt = storage->addOnChange(0.0, [&](const std::string&, const std::optional<std::string>&) {
        events.push_back("throws-int");
        throw 42;
    });
    auto unsubscribeThrowsStd = storage->addOnChange(0.0, [&](const std::string&, const std::optional<std::string>&) {
        events.push_back("throws-std");
        throw std::runtime_error("listener failed");
    });
    unsubscribeSelf = storage->addOnChange(0.0, [&](const std::string&, const std::optional<std::string>&) {
        events.push_back("self-removing");
        unsubscribeSelf();
        unsubscribeSelf();
        if (unsubscribeVictim) {
            unsubscribeVictim();
        }
        if (!unsubscribeLate) {
            unsubscribeLate = storage->addOnChange(0.0, [&](const std::string&, const std::optional<std::string>&) {
                events.push_back("late");
            });
        }
    });
    unsubscribeVictim = storage->addOnChange(0.0, [&](const std::string&, const std::optional<std::string>&) {
        events.push_back("victim");
    });
    auto unsubscribeReentrant = storage->addOnChange(0.0, [&](const std::string& key, const std::optional<std::string>&) {
        events.push_back("reentrant");
        if (key == "first") {
            storage->set("nested", "value", 0.0);
            (void)storage->getAllKeys(0.0);
            (void)storage->getExternalMemorySize();
        }
    });

    storage->set("first", "value", 0.0);
    require(storage->get("nested", 0.0).value() == "value", "re-entrant set from a listener must not deadlock");
    const std::vector<std::string> expectedFirst = {
        "throws-int", "throws-std", "self-removing", "victim", "reentrant",
        "throws-int", "throws-std", "reentrant", "late",
    };
    require(events == expectedFirst, "first notification must use the listener snapshot taken before notify");

    events.clear();
    storage->set("second", "value", 0.0);
    const std::vector<std::string> expectedSecond = {"throws-int", "throws-std", "reentrant", "late"};
    require(events == expectedSecond, "listener changes made during notify apply to the next notification");

    unsubscribeThrowsInt();
    unsubscribeThrowsStd();
    unsubscribeReentrant();
    unsubscribeLate();
    events.clear();
    storage->clear(0.0);
    require(events.empty(), "no listener may run after every unsubscribe");

    auto unsubscribeAfterDestroy = storage->addOnChange(1.0, [](const std::string&, const std::optional<std::string>&) {});
    storage.reset();
    unsubscribeAfterDestroy();
    unsubscribeAfterDestroy();
}

void testMemoryScopeHostileInputs() {
    HybridStorage storage(nullptr);
    const std::string nulKey("a\0b", 3);
    const std::string nulValue("x\0y", 3);
    const std::string invalidUtf8("\xff\xfe\xc3\x28", 4);
    const std::string large(4 * 1024 * 1024, 'L');

    storage.set("", "empty-key", 0.0);
    storage.set(nulKey, nulValue, 0.0);
    storage.set(invalidUtf8, invalidUtf8, 0.0);
    storage.set("large", large, 0.0);
    storage.set("a", "plain", 0.0);

    require(storage.get("", 0.0).value() == "empty-key", "empty key round trip");
    require(storage.get(nulKey, 0.0).value() == nulValue, "NUL key and value round trip");
    require(storage.get("a", 0.0).value() == "plain", "NUL key must not alias its C-string prefix");
    require(storage.get(invalidUtf8, 0.0).value() == invalidUtf8, "invalid UTF-8 round trip");
    require(storage.get("large", 0.0).value() == large, "large value round trip");
    require(storage.getKeysByPrefix(std::string("a\0", 2), 0.0) == std::vector<std::string>{nulKey}, "NUL prefix");
    require(storage.getKeysByPrefix("a", 0.0).size() == 2, "prefix must match byte-wise");
    require(storage.getExternalMemorySize() >= large.size(), "memory size must count large values");

    storage.removeByPrefix(std::string("a\0", 2), 0.0);
    require(!storage.has(nulKey, 0.0) && storage.has("a", 0.0), "removeByPrefix with NUL prefix");
    storage.setBatch({"dup", "dup"}, {"1", "2"}, 0.0);
    require(storage.get("dup", 0.0).value() == "2", "duplicate batch keys keep the last value");
    storage.setBatch({}, {}, 0.0);
    storage.removeBatch({}, 0.0);
    require(storage.getBatch({}, 0.0).empty(), "empty batches are no-ops");
}

void testAdapterResultsAreForwardedUnchanged() {
    auto adapter = std::make_shared<FailingAdapter>();
    HybridStorage storage(adapter);
    adapter->reportedSize = static_cast<size_t>(1) << 31;
    require(storage.size(1.0) == 2147483648.0, "size above INT_MAX must not be narrowed");
    adapter->reportedSize = std::numeric_limits<size_t>::max();
    require(storage.size(2.0) == static_cast<double>(std::numeric_limits<size_t>::max()), "SIZE_MAX size");

    adapter->prefixKeys = {};
    adapter->log.clear();
    storage.removeByPrefix("none", 1.0);
    require((adapter->log == std::vector<std::string>{"getKeysByPrefixDisk"}), "empty prefix match must not delete");
    adapter->prefixKeys = {"p1", "p2"};
    adapter->log.clear();
    storage.removeByPrefix("p", 1.0);
    require(
        (adapter->log == std::vector<std::string>{"getKeysByPrefixDisk", "deleteDiskBatch"}),
        "removeByPrefix must delete the matched keys in one batch"
    );
    adapter->log.clear();
    storage.removeByPrefix("", 1.0);
    require(adapter->log.empty(), "empty prefix must never delete");
}

void testJniSizeConversionsAreChecked() {
    using ::NitroStorage::fromJniSize;
    using ::NitroStorage::toJniSize;
    const auto max = static_cast<size_t>(std::numeric_limits<int32_t>::max());
    require(toJniSize(0, "limit") == 0, "zero size");
    require(toJniSize(max, "limit") == std::numeric_limits<int32_t>::max(), "INT32_MAX size");
    for (const size_t size : {max + 1, static_cast<size_t>(std::numeric_limits<uint32_t>::max()),
             std::numeric_limits<size_t>::max()}) {
        bool threw = false;
        try {
            (void)toJniSize(size, "Storage string exceeds the Java array limit");
        } catch (const std::length_error& error) {
            threw = std::string(error.what()) == "Storage string exceeds the Java array limit";
        }
        require(threw, "size above INT32_MAX must be rejected");
    }
    require(fromJniSize(0) == 0 && fromJniSize(7) == 7, "non-negative Java sizes");
    require(fromJniSize(std::numeric_limits<int32_t>::max()) == max, "INT32_MAX Java size");
    require(fromJniSize(-1) == 0 && fromJniSize(std::numeric_limits<int32_t>::min()) == 0, "negative Java sizes");
}

} // namespace

int main() {
    testJniSizeConversionsAreChecked();
    testEveryAdapterFailureKeepsItsTagAndNotifiesNobody();
    testUnknownAdapterFailuresBecomeStdExceptions();
    testMissingAdapterIsReportedByEveryNativeOperation();
    testEveryScopeArgumentRejectsInvalidNumbers();
    testAccessControlAndBiometricLevelRejectInvalidNumbers();
    testBatchLengthMismatchIsRejectedBeforeAnyEffect();
    testPartialBatchFailureNotifiesOnlyAppliedKeys();
    testListenersMayThrowAnythingAndMutateListenersDuringNotify();
    testMemoryScopeHostileInputs();
    testAdapterResultsAreForwardedUnchanged();
    std::cout << "HybridStorage failure tests passed." << std::endl;
    return 0;
}
