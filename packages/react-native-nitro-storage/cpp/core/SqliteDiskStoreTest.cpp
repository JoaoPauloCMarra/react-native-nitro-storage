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

        store.set("User::token", "upper");
        store.set("user::token", "lower");
        store.set("literal%key", "percent");
        store.set("literalXkey", "percent-decoy");
        store.set("literal_key", "underscore");
        store.set("literalXkey2", "underscore-decoy");
        store.set("literal\\key", "backslash");
        store.set("literal:key", "backslash-decoy");
        store.set("café::token", "unicode");
        const std::string nulPrefix("nul\0", 4);
        const std::string nulKey = nulPrefix + "token";
        store.set(nulKey, "nul");

        assert((store.getKeysByPrefix("User::") == std::vector<std::string>{"User::token"}));
        assert((store.getKeysByPrefix("user::") == std::vector<std::string>{"user::token"}));
        assert((store.getKeysByPrefix("literal%") == std::vector<std::string>{"literal%key"}));
        assert((store.getKeysByPrefix("literal_") == std::vector<std::string>{"literal_key"}));
        assert((store.getKeysByPrefix("literal\\") == std::vector<std::string>{"literal\\key"}));
        assert((store.getKeysByPrefix("café::") == std::vector<std::string>{"café::token"}));
        assert((store.getKeysByPrefix(nulPrefix) == std::vector<std::string>{nulKey}));
        const auto upperNamespaceKeys = store.getKeysByPrefix("User::");
        store.removeBatch(upperNamespaceKeys);
        assert(!store.has("User::token"));
        assert(store.has("user::token"));
        assert(store.getKeysByPrefix("").size() == store.getAllKeys().size());

        store.clear();
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
