#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>

#include <atomic>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <memory>
#include <optional>
#include <string>
#include <thread>

using NitroStorage::IOSStorageAdapterCpp;

namespace {

NSString* const kBecameAvailable = @"UIApplicationProtectedDataDidBecomeAvailable";
NSString* const kWillBecomeUnavailable = @"UIApplicationProtectedDataWillBecomeUnavailable";
NSString* const kDidBecomeActive = @"UIApplicationDidBecomeActiveNotification";
NSString* const kWillEnterForeground = @"UIApplicationWillEnterForegroundNotification";

void require(bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "IOSStorageAdapter protected data test assertion failed: " << message << std::endl;
        std::abort();
    }
}

void post(NSString* name) {
    [[NSNotificationCenter defaultCenter] postNotificationName:name object:nil];
}

void spinMainRunLoop(const std::function<bool()>& done, NSTimeInterval limit) {
    NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:limit];
    while (!done() && [deadline timeIntervalSinceNow] > 0) {
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                 beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.005]];
    }
}

void testSeedComesFromTheReaderOnce() {
    std::atomic<int> reads{0};
    IOSStorageAdapterCpp locked([&] { reads.fetch_add(1); return false; });
    require(!locked.isProtectedDataAvailable(), "locked seed");
    require(!locked.isProtectedDataAvailable(), "locked seed is stable");
    require(reads.load() == 1, "getter must not call the reader again");

    IOSStorageAdapterCpp open([] { return true; });
    require(open.isProtectedDataAvailable(), "available seed");
}

void testHostWithoutUIKitReportsAvailable() {
    IOSStorageAdapterCpp adapter;
    require(adapter.isProtectedDataAvailable(), "no UIApplication means available");
}

void testNotificationsDriveAvailabilityAndListeners() {
    IOSStorageAdapterCpp adapter([] { return false; });
    int calls = 0;
    auto unsubscribe = adapter.addProtectedDataAvailableListener([&] { calls += 1; });

    post(kBecameAvailable);
    require(adapter.isProtectedDataAvailable(), "became available");
    require(calls == 1, "listener fires when data becomes available");

    post(kWillBecomeUnavailable);
    require(!adapter.isProtectedDataAvailable(), "became unavailable");
    require(calls == 1, "listener does not fire when data becomes unavailable");

    post(kBecameAvailable);
    require(calls == 2, "listener fires on every availability transition");

    post(kBecameAvailable);
    require(calls == 2, "a repeated available notification is not a transition");

    unsubscribe();
    unsubscribe();
    post(kWillBecomeUnavailable);
    post(kBecameAvailable);
    require(calls == 2, "unsubscribed listener stays silent");
}

void testListenersMayUnsubscribeWhileNotified() {
    IOSStorageAdapterCpp adapter([] { return false; });
    int first = 0;
    int second = 0;
    std::function<void()> unsubscribeFirst;
    unsubscribeFirst = adapter.addProtectedDataAvailableListener([&] {
        first += 1;
        unsubscribeFirst();
    });
    auto unsubscribeSecond = adapter.addProtectedDataAvailableListener([&] { second += 1; });

    post(kBecameAvailable);
    post(kWillBecomeUnavailable);
    post(kBecameAvailable);

    require(first == 1, "self-unsubscribing listener runs once");
    require(second == 2, "other listeners keep running");
    unsubscribeSecond();
}

void testDestroyedAdapterIgnoresNotificationsAndLateUnsubscribe() {
    int calls = 0;
    std::function<void()> unsubscribe;
    {
        IOSStorageAdapterCpp adapter([] { return false; });
        unsubscribe = adapter.addProtectedDataAvailableListener([&] { calls += 1; });
    }
    post(kBecameAvailable);
    unsubscribe();
    require(calls == 0, "destroyed adapter must not notify");
}

void testOffMainSeedingReadsOnTheMainThread() {
    std::atomic<bool> readOnMain{false};
    std::atomic<int> reads{0};
    std::unique_ptr<IOSStorageAdapterCpp> adapter;
    std::thread worker([&] {
        adapter = std::make_unique<IOSStorageAdapterCpp>([&] {
            readOnMain.store([NSThread isMainThread]);
            reads.fetch_add(1);
            return true;
        });
    });
    worker.join();
    require(reads.load() == 0, "construction off the main thread must not read UIApplication itself");

    spinMainRunLoop([&] { return reads.load() > 0; }, 5.0);
    require(reads.load() == 1, "the seed reads once");
    require(readOnMain.load(), "UIApplication state is read on the main thread");
    require(adapter->isProtectedDataAvailable(), "seed is applied when main serves the read");
}

void testOffMainConstructionReportsUnknownAsUnavailable() {
    std::unique_ptr<IOSStorageAdapterCpp> adapter;
    std::thread worker([&] {
        adapter = std::make_unique<IOSStorageAdapterCpp>([] { return true; });
    });
    worker.join();
    require(!adapter->isProtectedDataAvailable(), "unknown state is reported unavailable");

    spinMainRunLoop([&] { return adapter->isProtectedDataAvailable(); }, 5.0);
    require(adapter->isProtectedDataAvailable(), "seed lands once main runs");
}

void testQueuedSeedNeverOverwritesANewerNotification() {
    std::atomic<int> reads{0};
    int calls = 0;
    std::unique_ptr<IOSStorageAdapterCpp> adapter;
    std::thread worker([&] {
        adapter = std::make_unique<IOSStorageAdapterCpp>([&] { reads.fetch_add(1); return true; });
    });
    worker.join();
    auto unsubscribe = adapter->addProtectedDataAvailableListener([&] { calls += 1; });

    post(kWillBecomeUnavailable);
    require(!adapter->isProtectedDataAvailable(), "unavailable notification applied");

    spinMainRunLoop([&] { return reads.load() > 0; }, 5.0);
    require(reads.load() == 1, "the queued seed still ran");
    require(!adapter->isProtectedDataAvailable(), "a stale seed must not overwrite Unavailable");
    require(calls == 0, "a stale seed must not fire listeners");
    unsubscribe();
}

void testNilApplicationKeepsUnknownUntilForeground() {
    std::atomic<bool> applicationReady{false};
    IOSStorageAdapterCpp adapter([&]() -> std::optional<bool> {
        if (!applicationReady.load()) {
            return std::nullopt;
        }
        return true;
    });
    int calls = 0;
    auto unsubscribe = adapter.addProtectedDataAvailableListener([&] { calls += 1; });
    require(!adapter.isProtectedDataAvailable(), "no application yet reports unavailable");
    require(calls == 0, "an unresolved read never fires");

    applicationReady.store(true);
    post(kDidBecomeActive);
    require(adapter.isProtectedDataAvailable(), "foreground heals an unresolved seed");
    require(calls == 1, "unknown to available fires once");
    unsubscribe();
}

void testUnknownToAvailableFiresListeners() {
    int calls = 0;
    std::unique_ptr<IOSStorageAdapterCpp> adapter;
    std::thread worker([&] {
        adapter = std::make_unique<IOSStorageAdapterCpp>([] { return true; });
    });
    worker.join();
    auto unsubscribe = adapter->addProtectedDataAvailableListener([&] { calls += 1; });
    require(calls == 0, "subscribing never fires");

    spinMainRunLoop([&] { return calls > 0; }, 5.0);
    require(calls == 1, "unknown to available is a transition");
    require(adapter->isProtectedDataAvailable(), "available after the seed");
    unsubscribe();
}

void testUnknownToUnavailableDoesNotFireListeners() {
    int calls = 0;
    std::atomic<int> reads{0};
    std::unique_ptr<IOSStorageAdapterCpp> adapter;
    std::thread worker([&] {
        adapter = std::make_unique<IOSStorageAdapterCpp>([&] { reads.fetch_add(1); return false; });
    });
    worker.join();
    auto unsubscribe = adapter->addProtectedDataAvailableListener([&] { calls += 1; });

    spinMainRunLoop([&] { return reads.load() > 0; }, 5.0);
    require(reads.load() == 1, "the seed ran");
    require(!adapter->isProtectedDataAvailable(), "stays unavailable");
    require(calls == 0, "unknown to unavailable is not a transition to available");
    unsubscribe();
}

void testForegroundNotificationsRereadAvailability() {
    for (NSString* name : {kDidBecomeActive, kWillEnterForeground}) {
        std::atomic<bool> value{true};
        IOSStorageAdapterCpp adapter([&] { return value.load(); });
        int calls = 0;
        auto unsubscribe = adapter.addProtectedDataAvailableListener([&] { calls += 1; });
        require(adapter.isProtectedDataAvailable(), "seeded available");

        post(kWillBecomeUnavailable);
        require(!adapter.isProtectedDataAvailable(), "will-become-unavailable caches false");

        post(name);
        require(adapter.isProtectedDataAvailable(), "foreground re-read heals a stale false cache");
        require(calls == 1, "false to true on a foreground re-read fires listeners");

        post(name);
        require(calls == 1, "an unchanged re-read does not fire");

        value.store(false);
        post(name);
        require(!adapter.isProtectedDataAvailable(), "foreground re-read can report unavailable");
        require(calls == 1, "true to false never fires");

        value.store(true);
        post(name);
        require(calls == 2, "recovery fires again");
        unsubscribe();
    }
}

void testForegroundNotificationOffMainReadsOnTheMainThread() {
    std::atomic<bool> value{false};
    std::atomic<bool> readOnMain{true};
    IOSStorageAdapterCpp adapter([&] {
        if (![NSThread isMainThread]) {
            readOnMain.store(false);
        }
        return value.load();
    });
    require(!adapter.isProtectedDataAvailable(), "seeded unavailable");
    value.store(true);
    std::thread poster([&] { post(kDidBecomeActive); });
    poster.join();
    spinMainRunLoop([&] { return adapter.isProtectedDataAvailable(); }, 5.0);
    require(adapter.isProtectedDataAvailable(), "off-main notification is re-read on main");
    require(readOnMain.load(), "UIApplication is never read off the main thread");
}

} // namespace

int main() {
    @autoreleasepool {
        testSeedComesFromTheReaderOnce();
        testHostWithoutUIKitReportsAvailable();
        testNotificationsDriveAvailabilityAndListeners();
        testListenersMayUnsubscribeWhileNotified();
        testDestroyedAdapterIgnoresNotificationsAndLateUnsubscribe();
        testOffMainSeedingReadsOnTheMainThread();
        testOffMainConstructionReportsUnknownAsUnavailable();
        testQueuedSeedNeverOverwritesANewerNotification();
        testNilApplicationKeepsUnknownUntilForeground();
        testUnknownToAvailableFiresListeners();
        testUnknownToUnavailableDoesNotFireListeners();
        testForegroundNotificationsRereadAvailability();
        testForegroundNotificationOffMainReadsOnTheMainThread();
        std::cout << "IOSStorageAdapterCpp protected data tests passed." << std::endl;
    }
    return 0;
}
