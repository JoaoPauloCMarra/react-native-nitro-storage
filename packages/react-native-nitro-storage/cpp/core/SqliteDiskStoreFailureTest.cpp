#include "SqliteDiskStore.hpp"

#include <sqlite3.h>

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <dirent.h>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <spawn.h>
#include <string>
#include <sys/stat.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>

using NitroStorage::SqliteDiskStore;

extern char** environ;

namespace {

void require(bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "SqliteDiskStore failure test assertion failed: " << message << std::endl;
        std::abort();
    }
}

struct FaultState {
    std::atomic<int> writeRc{SQLITE_OK};
    std::atomic<bool> denyGrowth{false};
    std::atomic<int> deniedGrowthWrites{0};
    std::atomic<int> killAfterWrites{-1};
    std::atomic<int> lastErrno{-1};
    std::atomic<int> openRc{SQLITE_OK};
    std::atomic<long long> volumeCapacityBytes{-1};
    std::string volumeDirectory;
    std::atomic<bool> fastSleep{false};
    std::atomic<int> sleepCalls{0};
    std::atomic<sqlite3_int64> clockSkewMs{0};
    std::function<void()> onSleep;
    std::string trackedPrefix;
};

FaultState gFault;
sqlite3_vfs* gBaseVfs = nullptr;
sqlite3_vfs gFaultVfs;

struct FaultFile {
    sqlite3_file base;
    sqlite3_file* real;
    bool tracked;
};

sqlite3_file* realFile(sqlite3_file* file) {
    return reinterpret_cast<FaultFile*>(file)->real;
}

long long volumeUsedBytes() {
    long long used = 0;
    std::error_code error;
    for (const auto& entry : std::filesystem::directory_iterator(gFault.volumeDirectory, error)) {
        const auto size = entry.file_size(error);
        if (!error) {
            used += static_cast<long long>(size);
        }
    }
    return used;
}

bool volumeCannotGrowBy(long long growth) {
    const long long capacity = gFault.volumeCapacityBytes.load();
    return capacity >= 0 && growth > 0 && volumeUsedBytes() + growth > capacity;
}

int faultClose(sqlite3_file* file) {
    sqlite3_file* real = realFile(file);
    return real->pMethods != nullptr ? real->pMethods->xClose(real) : SQLITE_OK;
}

int faultRead(sqlite3_file* file, void* buffer, int amount, sqlite3_int64 offset) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xRead(real, buffer, amount, offset);
}

int faultWrite(sqlite3_file* file, const void* buffer, int amount, sqlite3_int64 offset) {
    auto* fault = reinterpret_cast<FaultFile*>(file);
    const int injected = gFault.writeRc.load();
    if (fault->tracked && injected != SQLITE_OK) {
        return injected;
    }
    if (fault->tracked && gFault.denyGrowth.load()) {
        sqlite3_int64 size = 0;
        const int sizeRc = fault->real->pMethods->xFileSize(fault->real, &size);
        if (sizeRc != SQLITE_OK) {
            return sizeRc;
        }
        if (offset + amount > size) {
            gFault.deniedGrowthWrites.fetch_add(1);
            return SQLITE_FULL;
        }
    }
    if (fault->tracked && gFault.volumeCapacityBytes.load() >= 0) {
        sqlite3_int64 size = 0;
        const int sizeRc = fault->real->pMethods->xFileSize(fault->real, &size);
        if (sizeRc != SQLITE_OK) {
            return sizeRc;
        }
        if (volumeCannotGrowBy(offset + amount - size)) {
            return SQLITE_FULL;
        }
    }
    if (fault->tracked && gFault.killAfterWrites.load() >= 0) {
        if (gFault.killAfterWrites.fetch_sub(1) == 0) {
            kill(getpid(), SIGKILL);
        }
    }
    return fault->real->pMethods->xWrite(fault->real, buffer, amount, offset);
}

int faultTruncate(sqlite3_file* file, sqlite3_int64 size) {
    sqlite3_file* real = realFile(file);
    if (reinterpret_cast<FaultFile*>(file)->tracked && gFault.denyGrowth.load()) {
        sqlite3_int64 current = 0;
        const int sizeRc = real->pMethods->xFileSize(real, &current);
        if (sizeRc != SQLITE_OK) {
            return sizeRc;
        }
        if (size > current) {
            return SQLITE_FULL;
        }
    }
    return real->pMethods->xTruncate(real, size);
}

int faultSync(sqlite3_file* file, int flags) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xSync(real, flags);
}

int faultFileSize(sqlite3_file* file, sqlite3_int64* size) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xFileSize(real, size);
}

int faultLock(sqlite3_file* file, int level) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xLock(real, level);
}

int faultUnlock(sqlite3_file* file, int level) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xUnlock(real, level);
}

int faultCheckReservedLock(sqlite3_file* file, int* out) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xCheckReservedLock(real, out);
}

int faultFileControl(sqlite3_file* file, int op, void* arg) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xFileControl(real, op, arg);
}

int faultSectorSize(sqlite3_file* file) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xSectorSize(real);
}

int faultDeviceCharacteristics(sqlite3_file* file) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xDeviceCharacteristics(real);
}

int faultShmMap(sqlite3_file* file, int page, int size, int extend, void volatile** out) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xShmMap(real, page, size, extend, out);
}

int faultShmLock(sqlite3_file* file, int offset, int count, int flags) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xShmLock(real, offset, count, flags);
}

void faultShmBarrier(sqlite3_file* file) {
    sqlite3_file* real = realFile(file);
    real->pMethods->xShmBarrier(real);
}

int faultShmUnmap(sqlite3_file* file, int deleteFlag) {
    sqlite3_file* real = realFile(file);
    return real->pMethods->xShmUnmap(real, deleteFlag);
}

int faultFetch(sqlite3_file* file, sqlite3_int64 offset, int amount, void** out) {
    sqlite3_file* real = realFile(file);
    if (real->pMethods->iVersion < 3 || real->pMethods->xFetch == nullptr) {
        *out = nullptr;
        return SQLITE_OK;
    }
    return real->pMethods->xFetch(real, offset, amount, out);
}

int faultUnfetch(sqlite3_file* file, sqlite3_int64 offset, void* pointer) {
    sqlite3_file* real = realFile(file);
    if (real->pMethods->iVersion < 3 || real->pMethods->xUnfetch == nullptr) {
        return SQLITE_OK;
    }
    return real->pMethods->xUnfetch(real, offset, pointer);
}

const sqlite3_io_methods kFaultIoMethods = {
    3,
    faultClose,
    faultRead,
    faultWrite,
    faultTruncate,
    faultSync,
    faultFileSize,
    faultLock,
    faultUnlock,
    faultCheckReservedLock,
    faultFileControl,
    faultSectorSize,
    faultDeviceCharacteristics,
    faultShmMap,
    faultShmLock,
    faultShmBarrier,
    faultShmUnmap,
    faultFetch,
    faultUnfetch,
};

int faultOpen(sqlite3_vfs*, const char* name, sqlite3_file* file, int flags, int* outFlags) {
    auto* fault = reinterpret_cast<FaultFile*>(file);
    fault->real = reinterpret_cast<sqlite3_file*>(fault + 1);
    fault->real->pMethods = nullptr;
    const int injected = gFault.openRc.load();
    if (injected != SQLITE_OK && name != nullptr && !gFault.trackedPrefix.empty() &&
        std::string(name).rfind(gFault.trackedPrefix, 0) == 0) {
        file->pMethods = nullptr;
        return injected;
    }
    const int rc = gBaseVfs->xOpen(gBaseVfs, name, fault->real, flags, outFlags);
    if (rc != SQLITE_OK) {
        file->pMethods = nullptr;
        return rc;
    }
    fault->tracked = name != nullptr && !gFault.trackedPrefix.empty() &&
        std::string(name).rfind(gFault.trackedPrefix, 0) == 0;
    file->pMethods = &kFaultIoMethods;
    return SQLITE_OK;
}

int faultDelete(sqlite3_vfs*, const char* name, int syncDir) {
    return gBaseVfs->xDelete(gBaseVfs, name, syncDir);
}

int faultAccess(sqlite3_vfs*, const char* name, int flags, int* out) {
    return gBaseVfs->xAccess(gBaseVfs, name, flags, out);
}

int faultFullPathname(sqlite3_vfs*, const char* name, int size, char* out) {
    return gBaseVfs->xFullPathname(gBaseVfs, name, size, out);
}

int faultGetLastError(sqlite3_vfs*, int size, char* buffer) {
    const int injected = gFault.lastErrno.load();
    if (injected >= 0) {
        return injected;
    }
    return gBaseVfs->xGetLastError(gBaseVfs, size, buffer);
}

int faultSleep(sqlite3_vfs*, int microseconds) {
    if (!gFault.fastSleep.load()) {
        return gBaseVfs->xSleep(gBaseVfs, microseconds);
    }
    gFault.sleepCalls.fetch_add(1);
    gFault.clockSkewMs.fetch_add(microseconds / 1000 + 1);
    if (gFault.onSleep) {
        auto callback = std::move(gFault.onSleep);
        gFault.onSleep = nullptr;
        callback();
    }
    return microseconds;
}

int faultCurrentTimeInt64(sqlite3_vfs*, sqlite3_int64* out) {
    const int rc = gBaseVfs->xCurrentTimeInt64(gBaseVfs, out);
    *out += gFault.clockSkewMs.load();
    return rc;
}

int faultCurrentTime(sqlite3_vfs*, double* out) {
    const int rc = gBaseVfs->xCurrentTime(gBaseVfs, out);
    *out += static_cast<double>(gFault.clockSkewMs.load()) / 86400000.0;
    return rc;
}

void installFaultVfs() {
    gBaseVfs = sqlite3_vfs_find(nullptr);
    require(gBaseVfs != nullptr, "default sqlite VFS must exist");
    gFaultVfs = *gBaseVfs;
    gFaultVfs.zName = "nitro-storage-fault";
    gFaultVfs.pNext = nullptr;
    gFaultVfs.szOsFile = static_cast<int>(sizeof(FaultFile)) + gBaseVfs->szOsFile;
    gFaultVfs.xOpen = faultOpen;
    gFaultVfs.xDelete = faultDelete;
    gFaultVfs.xAccess = faultAccess;
    gFaultVfs.xFullPathname = faultFullPathname;
    gFaultVfs.xSleep = faultSleep;
    gFaultVfs.xGetLastError = faultGetLastError;
    gFaultVfs.xCurrentTime = faultCurrentTime;
    if (gBaseVfs->iVersion >= 2 && gBaseVfs->xCurrentTimeInt64 != nullptr) {
        gFaultVfs.xCurrentTimeInt64 = faultCurrentTimeInt64;
    }
    require(sqlite3_vfs_register(&gFaultVfs, 1) == SQLITE_OK, "fault VFS must register");
}

struct ArmedWriteFault {
    explicit ArmedWriteFault(int rc) { gFault.writeRc.store(rc); }
    ~ArmedWriteFault() { gFault.writeRc.store(SQLITE_OK); }
};

std::string failureMessage(const std::function<void()>& operation) {
    try {
        operation();
    } catch (const std::exception& error) {
        return error.what();
    }
    return "";
}

bool startsWith(const std::string& value, const std::string& prefix) {
    return value.compare(0, prefix.size(), prefix) == 0;
}

bool contains(const std::string& value, const std::string& needle) {
    return value.find(needle) != std::string::npos;
}

const std::string kFullPrefix = "[nitro-error:storage_full] NitroStorage: Disk SQLite ";
const std::string kCorruptionPrefix = "[nitro-error:storage_corruption] NitroStorage: Disk SQLite ";
const std::string kUntaggedPrefix = "NitroStorage: Disk SQLite ";

void requireFull(const std::string& message, const std::string& operation) {
    require(
        startsWith(message, kFullPrefix + operation + " failed: "),
        "expected storage_full for " + operation + ", got: " + message
    );
}

int openFileDescriptorCount() {
    int count = 0;
    DIR* directory = opendir("/dev/fd");
    require(directory != nullptr, "/dev/fd must be readable");
    while (readdir(directory) != nullptr) {
        ++count;
    }
    closedir(directory);
    return count;
}

std::filesystem::path gRoot;

std::string freshPath(const std::string& name) {
    const auto directory = gRoot / name;
    std::filesystem::remove_all(directory);
    std::filesystem::create_directories(directory);
    return (directory / "store.sqlite").string();
}

void removeDatabase(const std::string& path) {
    std::filesystem::remove(path);
    std::filesystem::remove(path + "-wal");
    std::filesystem::remove(path + "-shm");
}

bool runningAsRoot() {
    return geteuid() == 0;
}

void testDiskFullOnEveryWritePathIsTaggedAtomicAndRecoverable() {
    const std::string path = freshPath("disk-full");
    gFault.trackedPrefix = path;
    {
        SqliteDiskStore store(path);
        store.set("kept-a", "a");
        store.set("kept-b", "b");
        store.set("kept-c", "c");

        {
            ArmedWriteFault full(SQLITE_FULL);
            requireFull(failureMessage([&] { store.set("new", "value"); }), "set");
            requireFull(failureMessage([&] { store.set("kept-a", "overwrite"); }), "set");
            requireFull(failureMessage([&] { store.remove("kept-a"); }), "remove");
            requireFull(failureMessage([&] { store.clear(); }), "clear");

            const std::string batchSet = failureMessage([&] {
                store.setBatch({"batch-1", "batch-2", "kept-b"}, {"1", "2", "overwrite"});
            });
            require(startsWith(batchSet, kFullPrefix), "setBatch must be tagged: " + batchSet);

            const std::string batchRemove = failureMessage([&] {
                store.removeBatch({"kept-a", "kept-b"});
            });
            require(startsWith(batchRemove, kFullPrefix), "removeBatch must be tagged: " + batchRemove);

            const std::string migrate = failureMessage([&] {
                store.migrateIfAbsent({{"legacy-1", "1"}, {"legacy-2", "2"}});
            });
            require(startsWith(migrate, kFullPrefix), "migrateIfAbsent must be tagged: " + migrate);

            const std::string migrateOnce = failureMessage([&] {
                store.migrateOnce("suite_v1", {{"suite-1", "1"}, {"suite-2", "2"}});
            });
            require(startsWith(migrateOnce, kFullPrefix), "migrateOnce must be tagged: " + migrateOnce);

            require(store.get("kept-a").value() == "a", "reads must work while disk is full");
            require(store.getBatch({"kept-b"})[0].value() == "b", "batch reads must work while full");
            require(store.size() == 3, "failed writes must not change the row count");
            require(!store.has("new"), "failed set must not persist");
            require(!store.has("batch-1") && !store.has("batch-2"), "failed setBatch must be atomic");
            require(store.get("kept-b").value() == "b", "failed setBatch must not overwrite");
            require(store.has("kept-a") && store.has("kept-b"), "failed removeBatch must be atomic");
            require(!store.has("legacy-1") && !store.has("legacy-2"), "failed migration must be atomic");
            require(!store.has("suite-1"), "failed migrateOnce must not import entries");
            require(!store.hasMigrationMarker("suite_v1"), "failed migrateOnce must not write marker");
        }

        store.set("after-full", "ok");
        store.setBatch({"batch-1", "batch-2"}, {"1", "2"});
        store.remove("kept-a");
        store.removeBatch({"batch-1"});
        store.migrateOnce("suite_v1", {{"suite-1", "1"}});
        require(store.get("after-full").value() == "ok", "store must accept writes after space frees");
        require(!store.has("kept-a") && !store.has("batch-1"), "removes must work after space frees");
        require(store.hasMigrationMarker("suite_v1"), "migration must complete after space frees");
        require(store.get("suite-1").value() == "1", "migration entries must import after retry");
        store.clear();
        require(store.size() == 0, "clear must work after space frees");
        store.set("durable", "yes");
    }
    {
        SqliteDiskStore reopened(path);
        require(reopened.get("durable").value() == "yes", "post-recovery writes must be durable");
        require(reopened.hasMigrationMarker("suite_v1"), "marker must survive reopen");
        require(reopened.size() == 1, "only committed rows must survive reopen");
    }
    gFault.trackedPrefix.clear();
}

void testDiskFullDuringOpenIsTaggedAndReleasesConnection() {
    const std::string path = freshPath("full-on-open");
    gFault.trackedPrefix = path;
    const int before = openFileDescriptorCount();
    {
        ArmedWriteFault full(SQLITE_FULL);
        const std::string message = failureMessage([&] { SqliteDiskStore store(path); });
        require(startsWith(message, kFullPrefix), "full during open must be tagged: " + message);
        const std::string sharedMessage = failureMessage([&] { (void)SqliteDiskStore::shared(path); });
        require(startsWith(sharedMessage, kFullPrefix), "shared open must be tagged: " + sharedMessage);
    }
    require(openFileDescriptorCount() == before, "failed open must not leak descriptors");
    SqliteDiskStore& shared = SqliteDiskStore::shared(path);
    shared.set("after", "ok");
    require(shared.get("after").value() == "ok", "shared store must open once space frees");
    SqliteDiskStore::resetShared();
    gFault.trackedPrefix.clear();
}

struct ArmedSystemError {
    explicit ArmedSystemError(int systemError) { gFault.lastErrno.store(systemError); }
    ~ArmedSystemError() { gFault.lastErrno.store(-1); }
};

void testIoErrorsAreStorageFullOnlyWhenTheSystemReportsNoSpace() {
    const std::string path = freshPath("io-error");
    gFault.trackedPrefix = path;
    {
        SqliteDiskStore store(path);
        store.set("kept", "value");
        for (const int ioError : {SQLITE_IOERR_WRITE, SQLITE_IOERR_FSYNC, SQLITE_IOERR_TRUNCATE, SQLITE_IOERR_SHMSIZE}) {
            for (const int systemError : {ENOSPC, EDQUOT}) {
                ArmedWriteFault fault(ioError);
                ArmedSystemError system(systemError);
                requireFull(failureMessage([&] { store.set("next", "value"); }), "set");
                requireFull(failureMessage([&] { store.remove("kept"); }), "remove");
                requireFull(failureMessage([&] { store.clear(); }), "clear");
                const std::string batch = failureMessage([&] { store.setBatch({"a"}, {"1"}); });
                require(startsWith(batch, kFullPrefix), "no-space IO error in a batch must be tagged: " + batch);
                const std::string migrate = failureMessage([&] { store.migrateOnce("m", {{"a", "1"}}); });
                require(startsWith(migrate, kFullPrefix), "no-space IO error in a migration must be tagged: " + migrate);
            }
            for (const int systemError : {0, EIO, EACCES, EROFS, EFBIG, ENOMEM}) {
                ArmedWriteFault fault(ioError);
                ArmedSystemError system(systemError);
                const std::string message = failureMessage([&] { store.set("next", "value"); });
                require(
                    startsWith(message, kUntaggedPrefix + "set failed: "),
                    "IO error with errno " + std::to_string(systemError) + " must stay untagged: " + message
                );
                const std::string removeMessage = failureMessage([&] { store.remove("kept"); });
                require(
                    startsWith(removeMessage, kUntaggedPrefix + "remove failed: "),
                    "IO error remove must stay untagged: " + removeMessage
                );
            }
        }
        {
            ArmedWriteFault busy(SQLITE_BUSY);
            ArmedSystemError system(ENOSPC);
            const std::string message = failureMessage([&] { store.set("next", "value"); });
            require(startsWith(message, kUntaggedPrefix), "only IO errors consult the system error: " + message);
        }
        require(store.get("kept").value() == "value", "IO error must not lose committed data");
        require(store.size() == 1 && !store.hasMigrationMarker("m"), "failed writes must leave no rows");
        store.set("next", "value");
        require(store.has("next"), "store must recover after IO error");
    }
    gFault.trackedPrefix.clear();
}

void testNoSpaceWhileCreatingTheDatabaseFileIsTagged() {
    const std::string path = freshPath("open-io-error");
    gFault.trackedPrefix = path;
    const int before = openFileDescriptorCount();
    gFault.openRc.store(SQLITE_IOERR);
    {
        ArmedSystemError system(ENOSPC);
        const std::string message = failureMessage([&] { SqliteDiskStore store(path); });
        require(startsWith(message, kFullPrefix + "open failed: "), "no-space open must be tagged: " + message);
    }
    {
        ArmedSystemError system(EIO);
        const std::string message = failureMessage([&] { SqliteDiskStore store(path); });
        require(startsWith(message, kUntaggedPrefix + "open failed: "), "other open IO errors stay untagged: " + message);
    }
    gFault.openRc.store(SQLITE_OK);
    require(openFileDescriptorCount() == before, "failed open must not leak descriptors");
    SqliteDiskStore store(path);
    store.set("after", "ok");
    require(store.get("after").value() == "ok", "store must open once the fault clears");
    gFault.trackedPrefix.clear();
}

void testOversizedKeysAndValuesFailAtBindAndRollBack() {
    const std::string path = freshPath("too-big");
    SqliteDiskStore store(path);
    store.set("kept", "value");
    store.limitValueLengthForTesting(1000);
    const std::string oversized(2000, 'x');
    const std::string expected = "NitroStorage: Disk SQLite bind failed: string or blob too big";

    require(failureMessage([&] { store.set("big-value", oversized); }) == expected, "oversized value");
    require(failureMessage([&] { store.set(oversized, "v"); }) == expected, "oversized key");
    require(failureMessage([&] { (void)store.get(oversized); }) == expected, "oversized key on get");
    require(failureMessage([&] { (void)store.has(oversized); }) == expected, "oversized key on has");
    require(failureMessage([&] { store.remove(oversized); }) == expected, "oversized key on remove");
    require(failureMessage([&] { (void)store.getKeysByPrefix(oversized); }) == expected, "oversized prefix");
    require(
        failureMessage([&] { store.setBatch({"a", "b"}, {"1", oversized}); }) == expected,
        "oversized value inside a batch"
    );
    require(!store.has("a"), "batch with an oversized value must be atomic");
    require(
        failureMessage([&] { store.removeBatch({"kept", oversized}); }) == expected,
        "oversized key inside a remove batch"
    );
    require(store.has("kept"), "remove batch with an oversized key must be atomic");
    require(
        failureMessage([&] { store.migrateOnce("m", {{"a", "1"}, {"b", oversized}}); }) == expected,
        "oversized value inside a migration"
    );
    require(!store.has("a") && !store.hasMigrationMarker("m"), "failed migration must be atomic");
    require(
        failureMessage([&] { store.migrateIfAbsent({{"a", "1"}, {oversized, "2"}}); }) == expected,
        "oversized key inside migrateIfAbsent"
    );

    store.setBatch({"a", "b"}, {"1", std::string(500, 'y')});
    store.removeBatch({"a"});
    store.migrateOnce("m", {{"c", "3"}});
    require(store.size() == 3 && store.hasMigrationMarker("m"), "transactions must work after a bind failure");
    require(store.get("b").value().size() == 500, "values below the limit must round trip");
}

void testClearRecreatesACorruptOrUnopenableStore() {
    const std::string path = freshPath("recreate");
    const std::string garbage(8192, 'x');
    for (const char* suffix : {"", "-wal", "-shm", "-journal"}) {
        std::ofstream file(path + suffix, std::ios::binary);
        file << garbage;
    }
    const std::string openMessage = failureMessage([&] { (void)SqliteDiskStore::shared(path); });
    require(startsWith(openMessage, kCorruptionPrefix), "unopenable store must be tagged: " + openMessage);
    require(std::filesystem::file_size(path) == garbage.size(), "a corrupt database must never be deleted on open");

    SqliteDiskStore::recreateShared(path);
    require(!std::filesystem::exists(path + "-journal"), "recreate must remove stale journals");
    SqliteDiskStore& shared = SqliteDiskStore::shared(path);
    require(shared.size() == 0 && !shared.hasMigrationMarker("suite_v1"), "recreated store must be empty");
    shared.setBatch({"a", "b", "c"}, {"1", "2", "3"});
    shared.migrateOnce("suite_v1", {});
    SqliteDiskStore::resetShared();

    SqliteDiskStore& reopened = SqliteDiskStore::shared(path);
    require(reopened.size() == 3, "recreated store must persist");
    {
        std::fstream file(path, std::ios::binary | std::ios::in | std::ios::out);
        file.seekp(4096);
        file << std::string(static_cast<size_t>(std::filesystem::file_size(path)) - 4096, 'x');
    }
    const std::string clearMessage = failureMessage([&] { reopened.clear(); });
    require(startsWith(clearMessage, kCorruptionPrefix), "clear on a corrupt store must be tagged: " + clearMessage);

    SqliteDiskStore::recreateShared(path);
    require(&SqliteDiskStore::shared(path) == &reopened, "recreate must keep the shared instance alive");
    require(reopened.size() == 0 && !reopened.hasMigrationMarker("suite_v1"), "recreate must drop every row");
    reopened.set("after", "ok");
    require(reopened.get("after").value() == "ok", "recreated store must accept writes");

    if (!runningAsRoot()) {
        SqliteDiskStore::resetShared();
        require(std::filesystem::file_size(path) >= 3 * 4096, "fixture must be checkpointed into the database file");
        {
            std::fstream file(path, std::ios::binary | std::ios::in | std::ios::out);
            file.seekp(4096);
            file << std::string(static_cast<size_t>(std::filesystem::file_size(path)) - 4096, 'x');
        }
        SqliteDiskStore& stuck = SqliteDiskStore::shared(path);
        const auto directory = std::filesystem::path(path).parent_path();
        require(chmod(directory.c_str(), 0555) == 0, "chmod read-only directory");
        const std::string failed = failureMessage([&] { stuck.recreate(); });
        require(
            startsWith(failed, "NitroStorage: Disk SQLite clear failed: cannot delete the database file: "),
            "recreate must fail when the files cannot be replaced: " + failed
        );
        const std::string afterFailure = failureMessage([&] { (void)stuck.size(); });
        require(
            startsWith(afterFailure, kCorruptionPrefix),
            "a store that failed to recreate must reopen and keep reporting corruption: " + afterFailure
        );
        require(chmod(directory.c_str(), 0755) == 0, "chmod writable directory");
        stuck.recreate();
        stuck.set("healed", "yes");
        require(stuck.size() == 1, "store must heal once recreate succeeds");
    }
    SqliteDiskStore::resetShared();
}

std::string likePatternForPrefix(const std::string& prefix) {
    std::string escaped;
    for (const char character : prefix) {
        if (character == '\0') break;
        if (character == '%' || character == '_' || character == '\\') {
            escaped.push_back('\\');
        }
        escaped.push_back(character);
    }
    escaped.push_back('%');
    return escaped;
}

std::vector<std::string> likeScan(sqlite3* db, const std::string& prefix) {
    sqlite3_stmt* stmt = nullptr;
    require(
        sqlite3_prepare_v2(db, "SELECT key FROM kv WHERE key LIKE ?1 ESCAPE '\\';", -1, &stmt, nullptr) == SQLITE_OK,
        "prepare LIKE scan"
    );
    const std::string pattern = likePatternForPrefix(prefix);
    sqlite3_bind_text(stmt, 1, pattern.data(), static_cast<int>(pattern.size()), SQLITE_TRANSIENT);
    std::vector<std::string> keys;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        std::string key(
            reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0)),
            static_cast<size_t>(sqlite3_column_bytes(stmt, 0))
        );
        if (key.compare(0, prefix.size(), prefix) == 0) {
            keys.push_back(std::move(key));
        }
    }
    sqlite3_finalize(stmt);
    return keys;
}

void testUtf8ValidationSelectsTheRangeQueryOnlyForWellFormedPrefixes() {
    const std::vector<std::string> valid = {
        "", "a", std::string("a\0b", 3), "caf\xc3\xa9", "\xc2\x80", "\xdf\xbf", "\xe0\xa0\x80", "\xed\x9f\xbf",
        "\xee\x80\x80", "\xef\xbf\xbf", "\xf0\x90\x80\x80", "\xf0\x9f\x98\x80", "\xf4\x8f\xbf\xbf", "%_\\",
    };
    const std::vector<std::string> invalid = {
        "\x80", "\xbf", "\xc0\x80", "\xc1\xbf", "\xc3", "\xc3\x28", "\xe0\x80\x80", "\xe0\x9f\xbf", "\xe2\x82",
        "\xe2\x28\xa1", "\xed\xa0\x80", "\xed\xbf\xbf", "\xf0\x80\x80\x80", "\xf0\x8f\xbf\xbf", "\xf0\x9f\x98",
        "\xf0\x28\x8c\xbc", "\xf4\x90\x80\x80", "\xf5\x80\x80\x80", "\xf8\x88\x80\x80\x80", "\xfe", "\xff",
        "a\xff", "\xff\xff",
    };
    for (const auto& value : valid) {
        require(SqliteDiskStore::isValidUtf8(value), "well-formed UTF-8 must be accepted");
    }
    for (const auto& value : invalid) {
        require(!SqliteDiskStore::isValidUtf8(value), "malformed UTF-8 must be rejected");
    }
}

void testPrefixRangeQueryMatchesTheLikeScanItReplaced() {
    const std::string path = freshPath("prefix-differential");
    SqliteDiskStore store(path);
    const std::vector<std::string> keys = {
        "", "a", "A", "ab", "aB", "Ab", "abc", "ab%", "ab_", "ab\\", "a%", "a_", "%", "%%", "_", "__", "\\", "\\%",
        "user::1", "User::1", "USER::1", "user::", "user:;", "user:", "caf\xc3\xa9", "caf\xc3\xa9::1", "cafe", "caf",
        std::string("nul\0token", 9), "nul", std::string("nul\0", 4), std::string("\0", 1), std::string("\0\0", 2),
        "\xf0\x9f\x98\x80", "\xf0\x9f\x98\x80x", "\xf0\x9f\x98\x81", "\xff", "\xff\xff", "\xff\xffz", "a\xff",
        "a\xff\xff", "a\xffz", "b", "\xfe", "\xfe\xff", "\xc3", "\xc3\x28", "\xed\xa0\x80", "z", "zz", "\x7f", "\x80",
        "\xf4\x8f\xbf\xbf", "\xf4\x8f\xbf\xbfz",
    };
    store.setBatch(keys, std::vector<std::string>(keys.size(), "v"));
    require(store.size() == keys.size(), "differential corpus must hold distinct keys");

    std::vector<std::string> prefixes = keys;
    for (const char* extra : {"u", "U", "us", "user", "USER", "AB", "ca", "n", "nu", "missing", "zzz", "%a", "_a",
             "a\\", "\xc3\xa9", "\xf0", "\xf0\x9f", "\xf4", "\xed"}) {
        prefixes.emplace_back(extra);
    }
    prefixes.emplace_back(std::string("nul\0t", 5));
    prefixes.emplace_back(std::string("a\0", 2));
    for (int byte = 0; byte < 256; ++byte) {
        prefixes.emplace_back(1, static_cast<char>(byte));
    }

    sqlite3* raw = nullptr;
    require(sqlite3_open_v2(path.c_str(), &raw, SQLITE_OPEN_READONLY, nullptr) == SQLITE_OK, "raw open");
    for (const auto& prefix : prefixes) {
        auto expected = likeScan(raw, prefix);
        auto actual = store.getKeysByPrefix(prefix);
        std::sort(expected.begin(), expected.end());
        std::sort(actual.begin(), actual.end());
        require(actual == expected, "range query must return the LIKE scan result for prefix of size " +
            std::to_string(prefix.size()) + " starting with byte " +
            (prefix.empty() ? std::string("none") : std::to_string(static_cast<unsigned char>(prefix[0]))) +
            ": expected " + std::to_string(expected.size()) + " got " + std::to_string(actual.size()));
    }
    sqlite3_close(raw);
}

void testBusyWriterUsesBusyTimeoutAndStaysUntagged() {
    const std::string path = freshPath("busy");
    SqliteDiskStore store(path);
    store.set("kept", "value");

    sqlite3* other = nullptr;
    require(sqlite3_open_v2(path.c_str(), &other, SQLITE_OPEN_READWRITE, nullptr) == SQLITE_OK, "second connection");
    require(sqlite3_exec(other, "BEGIN IMMEDIATE;", nullptr, nullptr, nullptr) == SQLITE_OK, "second writer lock");

    gFault.fastSleep.store(true);
    gFault.sleepCalls.store(0);
    const std::string setMessage = failureMessage([&] { store.set("blocked", "value"); });
    require(startsWith(setMessage, kUntaggedPrefix + "set failed: "), "BUSY set stays untagged: " + setMessage);
    require(contains(setMessage, "locked"), "BUSY set must say locked: " + setMessage);
    require(gFault.sleepCalls.load() > 0, "busy_timeout must invoke the busy handler");

    const std::string batchMessage = failureMessage([&] { store.setBatch({"blocked"}, {"value"}); });
    require(startsWith(batchMessage, kUntaggedPrefix + "exec failed: "), "BUSY setBatch: " + batchMessage);
    const std::string removeMessage = failureMessage([&] { store.remove("kept"); });
    require(startsWith(removeMessage, kUntaggedPrefix + "remove failed: "), "BUSY remove: " + removeMessage);

    require(store.get("kept").value() == "value", "WAL readers must not block on a writer");
    require(!store.has("blocked"), "blocked write must not persist");

    gFault.sleepCalls.store(0);
    gFault.onSleep = [other] {
        require(sqlite3_exec(other, "COMMIT;", nullptr, nullptr, nullptr) == SQLITE_OK, "release writer");
    };
    store.set("after-release", "ok");
    require(gFault.sleepCalls.load() >= 1, "write must wait in busy handler until lock release");
    require(store.get("after-release").value() == "ok", "write must succeed once writer releases");
    gFault.onSleep = nullptr;
    gFault.fastSleep.store(false);
    sqlite3_close(other);
}

void testReadOnlyDatabaseFileFailsUntagged() {
    if (runningAsRoot()) {
        std::cout << "skip: read-only file test needs a non-root user" << std::endl;
        return;
    }
    const std::string path = freshPath("readonly-file");
    {
        SqliteDiskStore store(path);
        store.set("kept", "value");
    }
    require(chmod(path.c_str(), 0444) == 0, "chmod read-only file");
    const int before = openFileDescriptorCount();
    {
        SqliteDiskStore store(path);
        require(store.get("kept").value() == "value", "read-only store must still read");
        require(store.getAllKeys().size() == 1, "read-only store must still enumerate");
        const std::string message = failureMessage([&] { store.set("next", "value"); });
        require(startsWith(message, kUntaggedPrefix + "set failed: "), "read-only write must be untagged: " + message);
        require(contains(message, "readonly"), "read-only write must say readonly: " + message);
        const std::string removeMessage = failureMessage([&] { store.remove("kept"); });
        require(startsWith(removeMessage, kUntaggedPrefix + "remove failed: "), "read-only remove: " + removeMessage);
        const std::string batchMessage = failureMessage([&] { store.setBatch({"a"}, {"1"}); });
        require(startsWith(batchMessage, kUntaggedPrefix), "read-only batch must be untagged: " + batchMessage);
        require(store.get("kept").value() == "value", "read-only failures must not lose data");
    }
    require(openFileDescriptorCount() == before, "read-only open must not leak descriptors");
    chmod(path.c_str(), 0644);
}

void testReadOnlyDirectoryFailsUntaggedWithoutLeak() {
    if (runningAsRoot()) {
        std::cout << "skip: read-only directory test needs a non-root user" << std::endl;
        return;
    }
    const std::string path = freshPath("readonly-dir");
    const auto directory = std::filesystem::path(path).parent_path();
    require(chmod(directory.c_str(), 0555) == 0, "chmod read-only directory");
    const int before = openFileDescriptorCount();
    const std::string message = failureMessage([&] { SqliteDiskStore store(path); });
    require(startsWith(message, kUntaggedPrefix + "open failed: "), "CANTOPEN must be untagged: " + message);
    require(openFileDescriptorCount() == before, "CANTOPEN must not leak descriptors");
    chmod(directory.c_str(), 0755);
}

void testParentPathThatIsAFileThrowsStdException() {
    const std::string path = freshPath("parent-file");
    const auto blocker = std::filesystem::path(path).parent_path() / "blocker";
    {
        std::ofstream file(blocker);
        file << "not a directory";
    }
    const std::string nested = (blocker / "store.sqlite").string();
    const std::string message = failureMessage([&] { SqliteDiskStore store(nested); });
    require(!message.empty(), "unusable parent path must throw a std::exception");
    require(!startsWith(message, "[nitro-error:"), "unusable parent path must be untagged: " + message);
}

void testGarbageWalAndShmAreIgnoredOnReopen() {
    const std::string path = freshPath("garbage-wal");
    {
        SqliteDiskStore store(path);
        store.set("kept", "value");
    }
    {
        std::ofstream wal(path + "-wal", std::ios::binary);
        wal << std::string(4096, '\x5a');
        std::ofstream shm(path + "-shm", std::ios::binary);
        shm << std::string(32768, '\x7f');
    }
    SqliteDiskStore reopened(path);
    require(reopened.get("kept").value() == "value", "garbage WAL/SHM must not lose data");
    reopened.set("next", "value");
    require(reopened.size() == 2, "store must accept writes after garbage WAL/SHM");
}

void testTruncatedDatabaseReportsCorruption() {
    const std::string path = freshPath("truncated");
    {
        SqliteDiskStore store(path);
        std::vector<std::string> keys;
        std::vector<std::string> values;
        for (int index = 0; index < 200; ++index) {
            keys.push_back("key-" + std::to_string(index));
            values.push_back(std::string(2048, static_cast<char>('a' + index % 26)));
        }
        store.setBatch(keys, values);
    }
    const auto size = std::filesystem::file_size(path);
    require(size > 16384, "fixture must span many pages");
    std::filesystem::resize_file(path, 12288);

    std::string message;
    try {
        SqliteDiskStore store(path);
        message = failureMessage([&] {
            (void)store.getAllKeys();
            (void)store.get("key-199");
        });
    } catch (const std::exception& error) {
        message = error.what();
    }
    require(startsWith(message, kCorruptionPrefix), "truncated database must be storage_corruption: " + message);
}

void testCorruptionFoundMidSessionIsTaggedOnEveryOperation() {
    const std::string path = freshPath("corrupt-mid-session");
    {
        SqliteDiskStore store(path);
        store.setBatch({"a", "b", "c"}, {"1", "2", "3"});
        store.migrateOnce("suite_v1", {});
    }
    SqliteDiskStore store(path);
    const auto size = std::filesystem::file_size(path);
    require(size >= 3 * 4096, "fixture must have table pages after the schema page");
    {
        std::fstream file(path, std::ios::binary | std::ios::in | std::ios::out);
        file.seekp(4096);
        file << std::string(static_cast<size_t>(size) - 4096, 'x');
    }
    const std::vector<std::pair<std::string, std::function<void()>>> operations = {
        {"get", [&] { (void)store.get("a"); }},
        {"has", [&] { (void)store.has("a"); }},
        {"getBatch", [&] { (void)store.getBatch({"a", "b"}); }},
        {"getAllKeys", [&] { (void)store.getAllKeys(); }},
        {"getKeysByPrefix", [&] { (void)store.getKeysByPrefix("a"); }},
        {"size", [&] { (void)store.size(); }},
        {"hasMigrationMarker", [&] { (void)store.hasMigrationMarker("suite_v1"); }},
        {"set", [&] { store.set("a", "x"); }},
        {"remove", [&] { store.remove("a"); }},
        {"setBatch", [&] { store.setBatch({"a"}, {"x"}); }},
        {"removeBatch", [&] { store.removeBatch({"a"}); }},
        {"clear", [&] { store.clear(); }},
        {"migrateIfAbsent", [&] { store.migrateIfAbsent({{"a", "x"}}); }},
        {"migrateOnce", [&] { store.migrateOnce("other_v1", {{"a", "x"}}); }},
    };
    for (const auto& [name, operation] : operations) {
        const std::string message = failureMessage(operation);
        require(
            startsWith(message, kCorruptionPrefix),
            name + " on a corrupt database must be storage_corruption, got: " + message
        );
    }
    const std::string again = failureMessage([&] { store.setBatch({"a"}, {"x"}); });
    require(startsWith(again, kCorruptionPrefix), "corrupt store must keep reporting corruption: " + again);
}

void testDatabaseUnlinkedWhileOpen() {
    const std::string path = freshPath("unlinked");
    SqliteDiskStore store(path);
    store.set("kept", "value");
    removeDatabase(path);

    require(store.get("kept").value() == "value", "reads continue on the open inode");
    const std::string message = failureMessage([&] { store.set("next", "value"); });
    require(message.empty(), "writes continue on the open inode: " + message);
    require(store.get("next").value() == "value", "the open handle reads its own writes after unlink");

    SqliteDiskStore fresh(path);
    require(!fresh.has("kept") && !fresh.has("next"), "a new connection sees a fresh database after unlink");
    fresh.set("fresh", "value");
    require(fresh.has("fresh"), "fresh database must accept writes");
}

void testSharedStoreRetriesAfterFailedOpen() {
    const std::string path = freshPath("shared-retry");
    {
        std::ofstream file(path, std::ios::binary);
        file << std::string(8192, 'x');
    }
    const std::string message = failureMessage([&] { (void)SqliteDiskStore::shared(path); });
    require(startsWith(message, kCorruptionPrefix), "corrupt shared open must be tagged: " + message);
    removeDatabase(path);
    SqliteDiskStore& shared = SqliteDiskStore::shared(path);
    shared.set("recovered", "yes");
    require(shared.get("recovered").value() == "yes", "shared store must open after file is fixed");
    SqliteDiskStore::resetShared();
    SqliteDiskStore reopened(path);
    require(reopened.get("recovered").value() == "yes", "recovered shared write must persist");
}

void testHostileInputsRoundTripByteExact() {
    const std::string path = freshPath("hostile-input");
    SqliteDiskStore store(path);
    const std::string nulValue("before\0after", 12);
    const std::string invalidUtf8Key("bad-\xff\xfe-key", 10);
    const std::string invalidUtf8Value("\xc3\x28\xa0\xa1", 4);
    const std::string onlyNul("\0", 1);
    const std::string large(8 * 1024 * 1024, 'L');

    store.set("", "empty-key");
    store.set("empty-value", "");
    store.set("nul-value", nulValue);
    store.set(invalidUtf8Key, invalidUtf8Value);
    store.set(onlyNul, "nul-key");
    store.set("large", large);

    require(store.get("").value() == "empty-key", "empty key round trip");
    require(store.has(""), "empty key has");
    require(store.get("empty-value").value().empty(), "empty value round trip");
    require(store.has("empty-value"), "empty value is present, not missing");
    require(store.get("nul-value").value() == nulValue, "NUL value round trip");
    require(store.get(invalidUtf8Key).value() == invalidUtf8Value, "invalid UTF-8 round trip");
    require(store.get(onlyNul).value() == "nul-key", "NUL-only key round trip");
    require(store.get(onlyNul).value() != store.get("").value(), "NUL key must not alias empty key");
    require(store.get("large").value() == large, "8 MiB value round trip");

    const auto batch = store.getBatch({invalidUtf8Key, "nul-value", "missing"});
    require(batch[0].value() == invalidUtf8Value && batch[1].value() == nulValue && !batch[2],
        "batch hostile round trip");

    const auto keys = store.getAllKeys();
    bool sawInvalid = false;
    bool sawNul = false;
    for (const auto& key : keys) {
        sawInvalid = sawInvalid || key == invalidUtf8Key;
        sawNul = sawNul || key == onlyNul;
    }
    require(sawInvalid && sawNul && keys.size() == 6, "getAllKeys must return byte-exact keys");
    require((store.getKeysByPrefix("bad-\xff") == std::vector<std::string>{invalidUtf8Key}),
        "prefix query on invalid UTF-8");

    store.removeBatch({"", onlyNul, invalidUtf8Key, "large"});
    require(store.size() == 2, "hostile keys must be removable");
}

void testLikeWildcardOnlyPrefixes() {
    const std::string path = freshPath("like-prefix");
    SqliteDiskStore store(path);
    store.set("%", "percent");
    store.set("%%x", "double-percent");
    store.set("_", "underscore");
    store.set("a", "decoy");
    store.set("\\%", "escaped");
    store.set("\\", "backslash");
    store.set("ab", "decoy-2");

    require((store.getKeysByPrefix("%").size() == 2), "% prefix must be literal");
    require((store.getKeysByPrefix("%%") == std::vector<std::string>{"%%x"}), "%% prefix must be literal");
    require((store.getKeysByPrefix("_") == std::vector<std::string>{"_"}), "_ prefix must be literal");
    require((store.getKeysByPrefix("\\%") == std::vector<std::string>{"\\%"}), "escaped prefix literal");
    require((store.getKeysByPrefix("\\").size() == 2), "backslash prefix literal");
    require(store.getKeysByPrefix("abc").empty(), "prefix longer than key must not match");
    require(store.getKeysByPrefix("A").empty(), "prefix match must be case-sensitive");
}

void testMigrationMarkerValueIsIgnored() {
    const std::string path = freshPath("marker-value");
    {
        SqliteDiskStore store(path);
    }
    sqlite3* raw = nullptr;
    require(sqlite3_open_v2(path.c_str(), &raw, SQLITE_OPEN_READWRITE, nullptr) == SQLITE_OK, "raw open");
    require(sqlite3_exec(raw, "INSERT INTO meta(k, v) VALUES('suite_v1', '');", nullptr, nullptr, nullptr) == SQLITE_OK,
        "partial marker row");
    sqlite3_close(raw);

    SqliteDiskStore store(path);
    require(store.hasMigrationMarker("suite_v1"), "any marker row counts as migrated");
    store.migrateOnce("suite_v1", {{"late", "x"}});
    require(!store.has("late"), "migrateOnce must skip when marker row exists");
}

void testConcurrentOperationsFromManyThreads() {
    const std::string path = freshPath("concurrency");
    SqliteDiskStore store(path);
    std::atomic<int> failures{0};
    std::vector<std::thread> threads;
    constexpr int kThreads = 8;
    constexpr int kIterations = 60;
    for (int thread = 0; thread < kThreads; ++thread) {
        threads.emplace_back([&store, &failures, thread] {
            for (int iteration = 0; iteration < kIterations; ++iteration) {
                const std::string key = "t" + std::to_string(thread) + ":" + std::to_string(iteration % 8);
                const std::string value = std::to_string(iteration);
                try {
                    store.set(key, value);
                    const auto read = store.get(key);
                    if (!read || *read != value) {
                        failures.fetch_add(1);
                    }
                    store.setBatch({key + ":a", key + ":b"}, {value, value});
                    (void)store.getKeysByPrefix("t" + std::to_string(thread) + ":");
                    (void)store.getBatch({key, key + ":a"});
                    store.removeBatch({key + ":a"});
                    if (iteration % 3 == 0) {
                        store.remove(key);
                    }
                    (void)store.has(key);
                    (void)store.size();
                } catch (const std::exception&) {
                    failures.fetch_add(1);
                }
            }
        });
    }
    for (auto& thread : threads) {
        thread.join();
    }
    require(failures.load() == 0, "concurrent operations must not fail or tear");
    for (int thread = 0; thread < kThreads; ++thread) {
        const auto keys = store.getKeysByPrefix("t" + std::to_string(thread) + ":");
        for (const auto& key : keys) {
            require(store.has(key), "every listed key must be readable");
        }
    }
}

long long fileSizeOrZero(const std::string& path) {
    std::error_code error;
    const auto size = std::filesystem::file_size(path, error);
    return error ? 0 : static_cast<long long>(size);
}

struct DeniedGrowth {
    DeniedGrowth() { gFault.denyGrowth.store(true); }
    ~DeniedGrowth() { gFault.denyGrowth.store(false); }
};

void testVolumeWithoutFreeSpaceKeepsStoreReadableAndRecovers() {
    const std::string path = freshPath("no-free-space");
    gFault.trackedPrefix = path;
    {
        SqliteDiskStore store(path);
        for (int index = 0; index < 50; ++index) {
            store.set("key-" + std::to_string(index), std::string(1000, 'v'));
        }
        {
            DeniedGrowth noSpace;
            requireFull(failureMessage([&] { store.remove("key-1"); }), "remove");
            requireFull(failureMessage([&] { store.clear(); }), "clear");
            requireFull(failureMessage([&] { store.set("key-2", "x"); }), "set");
            const std::string batch = failureMessage([&] { store.removeBatch({"key-3", "key-4"}); });
            require(startsWith(batch, kFullPrefix), "removeBatch on full volume must be tagged: " + batch);
            require(gFault.deniedGrowthWrites.load() > 0, "fault must model a volume that cannot grow files");

            require(store.size() == 50, "full volume must not lose rows");
            require(store.get("key-1").value() == std::string(1000, 'v'), "full volume must stay readable");
            require(store.getAllKeys().size() == 50, "key enumeration must work on a full volume");
            require(store.getKeysByPrefix("key-4").size() == 11, "prefix query must work on a full volume");
        }
        store.remove("key-1");
        store.removeBatch({"key-3", "key-4"});
        require(store.size() == 47, "deletes must succeed as soon as the volume has space");
        store.clear();
        require(store.size() == 0, "clear must succeed as soon as the volume has space");
    }
    {
        DeniedGrowth noSpace;
        SqliteDiskStore reopened(path);
        require(reopened.size() == 0, "existing database must open and read on a full volume");
        requireFull(failureMessage([&] { reopened.set("next", std::string(8192, 'n')); }), "set");
    }
    SqliteDiskStore recovered(path);
    recovered.set("next", "value");
    require(recovered.get("next").value() == "value", "reopen after full volume must accept writes");
    gFault.trackedPrefix.clear();
}

void testRecreateFreesSpaceOnAVolumeThatIsFull() {
    const std::string path = freshPath("full-volume-clear");
    gFault.trackedPrefix = path;
    gFault.volumeDirectory = std::filesystem::path(path).parent_path().string();
    {
        SqliteDiskStore& writer = SqliteDiskStore::shared(path);
        std::vector<std::string> keys;
        for (int index = 0; index < 300; ++index) {
            keys.push_back("bulk-" + std::to_string(index));
        }
        writer.setBatch(keys, std::vector<std::string>(keys.size(), std::string(4000, 'b')));
        SqliteDiskStore::resetShared();
    }
    SqliteDiskStore& store = SqliteDiskStore::shared(path);
    const long long usedWhenFull = volumeUsedBytes();
    require(usedWhenFull > 1024 * 1024, "fixture must occupy more than 1 MiB");
    gFault.volumeCapacityBytes.store(usedWhenFull);

    requireFull(failureMessage([&] { store.set("next", std::string(8192, 'n')); }), "set");
    requireFull(failureMessage([&] { store.clear(); }), "clear");
    require(store.size() == 300, "full volume must stay readable");

    SqliteDiskStore::recreateShared(path);
    require(&SqliteDiskStore::shared(path) == &store, "recreate must keep the shared instance");
    require(store.size() == 0, "recreate must leave an empty store");
    require(volumeUsedBytes() < usedWhenFull / 4, "recreate must free the space the database held");
    store.set("after", std::string(8192, 'a'));
    require(store.get("after").value().size() == 8192, "writes must work once the old database is gone");

    gFault.volumeCapacityBytes.store(0);
    const std::string noRoom = failureMessage([&] { SqliteDiskStore::recreateShared(path); });
    require(startsWith(noRoom, kFullPrefix), "recreate without any room must report storage_full: " + noRoom);
    const std::string retry = failureMessage([&] { (void)store.size(); });
    require(startsWith(retry, kFullPrefix), "the next call must retry the open and report storage_full: " + retry);
    gFault.volumeCapacityBytes.store(-1);
    store.set("healed", "yes");
    require(store.size() == 1 && store.get("healed").value() == "yes", "store must heal once space returns");

    SqliteDiskStore::resetShared();
    gFault.volumeDirectory.clear();
    gFault.trackedPrefix.clear();
}

void testFailedBatchThatSpillsLeavesNoOpenTransaction() {
    const std::string path = freshPath("spill");
    gFault.trackedPrefix = path;
    SqliteDiskStore store(path);
    store.set("kept", "value");
    std::vector<std::string> keys;
    std::vector<std::string> values;
    for (int index = 0; index < 3000; ++index) {
        keys.push_back("spill-" + std::to_string(index));
        values.push_back(std::string(4000, 's'));
    }
    {
        DeniedGrowth noSpace;
        const std::string message = failureMessage([&] { store.setBatch(keys, values); });
        require(startsWith(message, kFullPrefix), "spilled batch must be tagged: " + message);
        const std::string second = failureMessage([&] { store.setBatch({"a"}, {std::string(8192, 'a')}); });
        require(startsWith(second, kFullPrefix), "second failed batch must report full, not a nested transaction: " + second);
        const std::string third = failureMessage([&] { store.migrateOnce("m", {{"b", std::string(8192, 'b')}}); });
        require(startsWith(third, kFullPrefix), "failed migration must report full: " + third);
    }
    require(store.size() == 1, "failed spilled batch must leave no partial rows");
    require(store.getKeysByPrefix("spill-").empty(), "failed spilled batch must be atomic");
    store.setBatch({"after-1", "after-2"}, {"1", "2"});
    store.removeBatch({"after-1"});
    store.migrateOnce("m", {{"b", "2"}});
    require(store.size() == 3, "transactions must work after a failed transaction");
    require(store.hasMigrationMarker("m"), "migration must work after a failed transaction");
    gFault.trackedPrefix.clear();
}

void testPageLimitFailureInsideTransactionIsRolledBack() {
    const std::string path = freshPath("page-limit");
    SqliteDiskStore store(path);
    store.set("kept", "value");
    store.limitPageCountForTesting(1);
    const std::string oversized(1 << 20, 'x');

    const std::string batch = failureMessage([&] { store.setBatch({"small", "oversized"}, {"1", oversized}); });
    require(startsWith(batch, kFullPrefix + "set failed: "), "page limit setBatch must be tagged: " + batch);
    const std::string migrate = failureMessage([&] {
        store.migrateOnce("suite_v1", {{"import-small", "1"}, {"import-big", oversized}});
    });
    require(startsWith(migrate, kFullPrefix + "migrate failed: "), "page limit migrateOnce must be tagged: " + migrate);
    const std::string absent = failureMessage([&] {
        store.migrateIfAbsent({{"import-small", "1"}, {"import-big", oversized}});
    });
    require(startsWith(absent, kFullPrefix + "migrate failed: "), "page limit migrateIfAbsent must be tagged: " + absent);

    require(!store.has("small") && !store.has("import-small"), "statements before the failure must be rolled back");
    require(!store.hasMigrationMarker("suite_v1"), "failed migration must not write its marker");
    store.removeBatch({"missing"});
    store.setBatch({"kept"}, {"updated"});
    require(store.get("kept").value() == "updated", "next transaction must start cleanly");
    store.removeBatch({"kept"});
    store.clear();
    require(store.size() == 0, "deletes must work on a database that is at its page limit");
}

void testFailedCommitRollsBackAutomatically() {
    const std::string path = freshPath("failed-commit");
    gFault.trackedPrefix = path;
    {
        SqliteDiskStore store(path);
        store.set("kept", "value");
    }
    sqlite3* raw = nullptr;
    require(sqlite3_open_v2(path.c_str(), &raw, SQLITE_OPEN_READWRITE, nullptr) == SQLITE_OK, "raw open");
    require(sqlite3_exec(raw, "BEGIN IMMEDIATE;", nullptr, nullptr, nullptr) == SQLITE_OK, "begin");
    require(
        sqlite3_exec(raw, "INSERT OR REPLACE INTO kv(key, value) VALUES('a', 'b');", nullptr, nullptr, nullptr) == SQLITE_OK,
        "insert"
    );
    {
        ArmedWriteFault full(SQLITE_FULL);
        require((sqlite3_exec(raw, "COMMIT;", nullptr, nullptr, nullptr) & 0xff) == SQLITE_FULL, "commit must fail full");
    }
    require(sqlite3_get_autocommit(raw) != 0, "SQLite must roll back a transaction whose COMMIT failed");
    require(sqlite3_exec(raw, "BEGIN IMMEDIATE;", nullptr, nullptr, nullptr) == SQLITE_OK, "begin after failed commit");
    require(sqlite3_exec(raw, "ROLLBACK;", nullptr, nullptr, nullptr) == SQLITE_OK, "rollback");
    sqlite3_close(raw);
    SqliteDiskStore store(path);
    require(!store.has("a"), "row from failed commit must not persist");
    gFault.trackedPrefix.clear();
}

void testWalFileStaysBoundedAfterLargeTransaction() {
    const std::string path = freshPath("wal-bound");
    SqliteDiskStore store(path);
    std::vector<std::string> keys;
    std::vector<std::string> values;
    for (int index = 0; index < 3000; ++index) {
        keys.push_back("bulk-" + std::to_string(index));
        values.push_back(std::string(2000, 'b'));
    }
    store.setBatch(keys, values);
    require(fileSizeOrZero(path + "-wal") > 4 * 1024 * 1024, "fixture must grow the WAL past 4 MiB");
    for (int index = 0; index < 8; ++index) {
        store.set("after-" + std::to_string(index), "v");
    }
    require(
        fileSizeOrZero(path + "-wal") < 1024 * 1024,
        "WAL must shrink after checkpoint instead of keeping its high-water size: " +
            std::to_string(fileSizeOrZero(path + "-wal"))
    );
    for (int index = 0; index < 3000; ++index) {
        store.set("churn-" + std::to_string(index % 10), std::string(3000, 'c'));
    }
    require(
        fileSizeOrZero(path + "-wal") < 6 * 1024 * 1024,
        "WAL must stay near the auto-checkpoint size under churn: " +
            std::to_string(fileSizeOrZero(path + "-wal"))
    );
    require(store.size() == 3018, "churn must not lose rows");
}

std::string gExecutablePath;

struct KillFixture {
    std::vector<std::string> keys;
    std::vector<std::string> values;
    std::vector<std::pair<std::string, std::string>> entries;
};

KillFixture killFixture() {
    KillFixture fixture;
    for (int index = 0; index < 3000; ++index) {
        fixture.keys.push_back("batch-" + std::to_string(index));
        fixture.values.push_back(std::string(4000, 'k'));
        fixture.entries.emplace_back("import-" + std::to_string(index), std::string(4000, 'i'));
    }
    return fixture;
}

int runKilledChild(const std::string& scenario, const std::string& path, int killAt) {
    gFault.trackedPrefix = path;
    try {
        const KillFixture fixture = killFixture();
        SqliteDiskStore store(path);
        gFault.killAfterWrites.store(killAt);
        if (scenario == "setBatch") {
            store.setBatch(fixture.keys, fixture.values);
        } else if (scenario == "migrateOnce") {
            store.migrateOnce("suite_v1", fixture.entries);
        } else if (scenario == "removeBatch") {
            store.removeBatch({"seed-1", "seed-2", "seed-3"});
        } else if (scenario == "remove") {
            store.remove("seed-1");
        } else {
            return 44;
        }
    } catch (const std::exception& error) {
        std::cerr << "killed-child scenario failed: " << error.what() << std::endl;
        return 43;
    }
    return 42;
}

void killedChild(const std::string& scenario, const std::string& path, int killAt) {
    std::cout.flush();
    std::cerr.flush();
    const std::string killArgument = std::to_string(killAt);
    char* const arguments[] = {
        const_cast<char*>(gExecutablePath.c_str()),
        const_cast<char*>("--killed-child"),
        const_cast<char*>(scenario.c_str()),
        const_cast<char*>(path.c_str()),
        const_cast<char*>(killArgument.c_str()),
        nullptr,
    };
    pid_t child = 0;
    require(
        posix_spawn(&child, gExecutablePath.c_str(), nullptr, nullptr, arguments, environ) == 0,
        "child process must start"
    );
    int status = 0;
    require(waitpid(child, &status, 0) == child, "waitpid must return the child");
    require(
        WIFSIGNALED(status) && WTERMSIG(status) == SIGKILL,
        scenario + " child must be killed mid-write at " + killArgument + ", wait status " + std::to_string(status)
    );
}

void testProcessKilledMidWriteReopensConsistent() {
    const std::string path = freshPath("killed");
    {
        SqliteDiskStore store(path);
        store.setBatch({"seed-1", "seed-2", "seed-3"}, {"1", "2", "3"});
    }

    for (const int killAt : {0, 1, 7, 400, 2500}) {
        killedChild("setBatch", path, killAt);
        SqliteDiskStore store(path);
        require(store.size() == 3, "killed setBatch must leave no partial rows at write " + std::to_string(killAt));
        require(store.get("seed-2").value() == "2", "committed rows must survive a killed setBatch");
    }

    for (const int killAt : {0, 3, 900, 2800}) {
        killedChild("migrateOnce", path, killAt);
        SqliteDiskStore store(path);
        require(!store.hasMigrationMarker("suite_v1"), "killed migration must not leave a marker");
        require(store.size() == 3, "killed migration must not leave partial imports");
    }

    for (const int killAt : {0, 1}) {
        killedChild("removeBatch", path, killAt);
        SqliteDiskStore store(path);
        require(store.size() == 3, "killed removeBatch must remove nothing");
    }

    killedChild("remove", path, 0);
    {
        SqliteDiskStore store(path);
        require(store.has("seed-1"), "killed remove must not half-apply");
        store.migrateOnce("suite_v1", {{"import-0", "x"}});
        store.setBatch({"batch-0"}, {"y"});
        require(store.hasMigrationMarker("suite_v1") && store.size() == 5, "store must work after kills");
    }
}

void testLargeDatabaseEnumeration() {
    const std::string path = freshPath("large-db");
    SqliteDiskStore store(path);
    constexpr int kCount = 20000;
    std::vector<std::string> keys;
    std::vector<std::string> values;
    keys.reserve(kCount);
    values.reserve(kCount);
    for (int index = 0; index < kCount; ++index) {
        keys.push_back((index % 2 == 0 ? "even:" : "odd:") + std::to_string(index));
        values.push_back("v");
    }
    store.setBatch(keys, values);
    require(store.size() == kCount, "large batch must store every row");
    require(store.getAllKeys().size() == kCount, "getAllKeys must return every key");
    const auto even = store.getKeysByPrefix("even:");
    require(even.size() == kCount / 2, "prefix query must return every match");
    const auto all = store.getBatch(keys);
    require(all.size() == kCount && all.back().has_value(), "large getBatch must return every row");
    store.removeBatch(even);
    require(store.size() == kCount / 2, "large removeBatch must remove every key");
    store.setBatch({}, {});
    store.removeBatch({});
    store.setBatch({"only-key"}, {});
    require(store.size() == kCount / 2 && !store.has("only-key"), "empty and uneven batches must be no-ops");
}

} // namespace

int main(int argc, char** argv) {
    installFaultVfs();
    if (argc == 5 && std::string(argv[1]) == "--killed-child") {
        return runKilledChild(argv[2], argv[3], std::atoi(argv[4]));
    }
    gExecutablePath = argv[0];
    gRoot = std::filesystem::temp_directory_path() /
        ("nitro-sqlite-failure-" + std::to_string(getpid()));
    std::filesystem::remove_all(gRoot);
    std::filesystem::create_directories(gRoot);
    gRoot = std::filesystem::canonical(gRoot);

    testDiskFullOnEveryWritePathIsTaggedAtomicAndRecoverable();
    testDiskFullDuringOpenIsTaggedAndReleasesConnection();
    testVolumeWithoutFreeSpaceKeepsStoreReadableAndRecovers();
    testRecreateFreesSpaceOnAVolumeThatIsFull();
    testFailedBatchThatSpillsLeavesNoOpenTransaction();
    testPageLimitFailureInsideTransactionIsRolledBack();
    testFailedCommitRollsBackAutomatically();
    testProcessKilledMidWriteReopensConsistent();
    testWalFileStaysBoundedAfterLargeTransaction();
    testLargeDatabaseEnumeration();
    testIoErrorsAreStorageFullOnlyWhenTheSystemReportsNoSpace();
    testNoSpaceWhileCreatingTheDatabaseFileIsTagged();
    testOversizedKeysAndValuesFailAtBindAndRollBack();
    testClearRecreatesACorruptOrUnopenableStore();
    testUtf8ValidationSelectsTheRangeQueryOnlyForWellFormedPrefixes();
    testPrefixRangeQueryMatchesTheLikeScanItReplaced();
    testBusyWriterUsesBusyTimeoutAndStaysUntagged();
    testReadOnlyDatabaseFileFailsUntagged();
    testReadOnlyDirectoryFailsUntaggedWithoutLeak();
    testParentPathThatIsAFileThrowsStdException();
    testGarbageWalAndShmAreIgnoredOnReopen();
    testTruncatedDatabaseReportsCorruption();
    testCorruptionFoundMidSessionIsTaggedOnEveryOperation();
    testDatabaseUnlinkedWhileOpen();
    testSharedStoreRetriesAfterFailedOpen();
    testHostileInputsRoundTripByteExact();
    testLikeWildcardOnlyPrefixes();
    testMigrationMarkerValueIsIgnored();
    testConcurrentOperationsFromManyThreads();

    std::filesystem::remove_all(gRoot);
    std::cout << "SqliteDiskStore failure tests passed." << std::endl;
    return 0;
}
