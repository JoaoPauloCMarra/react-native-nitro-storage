#include "SqliteDiskStore.hpp"

#include <cassert>
#include <filesystem>
#include <iostream>
#include <string>
#include <unistd.h>
#include <vector>

using NitroStorage::SqliteDiskStore;

int main() {
    const auto path = (std::filesystem::temp_directory_path() /
        ("nitro-sqlite-disk-" + std::to_string(getpid()) + ".sqlite")).string();
    std::filesystem::remove(path);
    std::filesystem::remove(path + "-wal");
    std::filesystem::remove(path + "-shm");

    {
        SqliteDiskStore store(path);
        store.set("theme", "dark");
        store.set("session:a", "1");
        store.set("session:b", "2");
        assert(store.get("theme").value() == "dark");
        assert(store.has("theme"));
        assert(!store.has("missing"));
        assert(store.size() == 3);

        store.setBatch({"batch-1", "batch-2"}, {"one", "two"});
        const auto batch = store.getBatch({"batch-1", "missing", "batch-2"});
        assert(batch[0].value() == "one");
        assert(!batch[1].has_value());
        assert(batch[2].value() == "two");

        const auto prefix = store.getKeysByPrefix("session:");
        assert(prefix.size() == 2);

        store.migrateIfAbsent({{"theme", "light"}, {"imported", "yes"}});
        assert(store.get("theme").value() == "dark");
        assert(store.get("imported").value() == "yes");

        store.remove("batch-1");
        assert(!store.has("batch-1"));
        store.removeBatch({"batch-2", "imported"});
        assert(!store.has("batch-2"));
        assert(store.size() == 3);

        store.clear();
        assert(store.size() == 0);
        assert(store.getAllKeys().empty());
    }

    {
        SqliteDiskStore& shared = SqliteDiskStore::shared(path);
        shared.set("persisted", "ok");
        SqliteDiskStore::resetShared();
        SqliteDiskStore reopened(path);
        assert(reopened.get("persisted").value() == "ok");
    }

    std::filesystem::remove(path);
    std::filesystem::remove(path + "-wal");
    std::filesystem::remove(path + "-shm");
    std::cout << "SqliteDiskStore tests passed." << std::endl;
    return 0;
}
