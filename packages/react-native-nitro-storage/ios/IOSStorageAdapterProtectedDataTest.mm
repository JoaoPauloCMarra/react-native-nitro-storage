#import "IOSStorageAdapterCpp.hpp"
#import <Foundation/Foundation.h>

#include <atomic>
#include <cstdlib>
#include <functional>
#include <iostream>
#include <memory>
#include <string>
#include <thread>

using NitroStorage::IOSStorageAdapterCpp;

namespace {

NSString* const kBecameAvailable = @"UIApplicationProtectedDataDidBecomeAvailable";
NSString* const kWillBecomeUnavailable = @"UIApplicationProtectedDataWillBecomeUnavailable";

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
    std::atomic<bool> built{false};
    std::unique_ptr<IOSStorageAdapterCpp> adapter;
    std::thread worker([&] {
        adapter = std::make_unique<IOSStorageAdapterCpp>([&] {
            readOnMain.store([NSThread isMainThread]);
            return false;
        });
        built.store(true);
    });
    spinMainRunLoop([&] { return built.load(); }, 5.0);
    worker.join();
    require(built.load(), "construction off the main thread completes");
    require(readOnMain.load(), "UIApplication state is read on the main thread");
    require(!adapter->isProtectedDataAvailable(), "seed is applied when main serves the read");
}

void testOffMainSeedingNeverBlocksOnABusyMainThread() {
    std::atomic<bool> built{false};
    std::unique_ptr<IOSStorageAdapterCpp> adapter;
    std::thread worker([&] {
        adapter = std::make_unique<IOSStorageAdapterCpp>([] { return false; });
        built.store(true);
    });
    worker.join();
    require(built.load(), "construction must return while the main thread is busy");
    require(adapter->isProtectedDataAvailable(), "unknown state is reported available until main reads it");

    spinMainRunLoop([&] { return !adapter->isProtectedDataAvailable(); }, 5.0);
    require(!adapter->isProtectedDataAvailable(), "late seed is applied once main runs");
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
        testOffMainSeedingNeverBlocksOnABusyMainThread();
        std::cout << "IOSStorageAdapterCpp protected data tests passed." << std::endl;
    }
    return 0;
}
