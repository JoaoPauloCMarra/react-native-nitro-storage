#include "SqliteDiskStore.hpp"

#include <sqlite3.h>

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <memory>
#include <stdexcept>

namespace NitroStorage {
namespace {

std::unique_ptr<SqliteDiskStore>& sharedStore() {
    static std::unique_ptr<SqliteDiskStore> store;
    return store;
}

std::mutex& sharedMutex() {
    static std::mutex mutex;
    return mutex;
}

[[noreturn]] void throwSqlite(sqlite3* db, const char* operation, int code) {
    const char* message = db != nullptr ? sqlite3_errmsg(db) : sqlite3_errstr(code);
    throw std::runtime_error(
        std::string("NitroStorage: Disk SQLite ") + operation + " failed: " +
        (message != nullptr ? message : "unknown error")
    );
}

void bindText(sqlite3_stmt* stmt, int index, const std::string& value) {
    const int rc = sqlite3_bind_text(
        stmt,
        index,
        value.data(),
        static_cast<int>(value.size()),
        SQLITE_TRANSIENT
    );
    if (rc != SQLITE_OK) {
        throw std::runtime_error("NitroStorage: Disk SQLite bind failed");
    }
}

std::string escapeLikePrefix(const std::string& prefix) {
    std::string escaped;
    escaped.reserve(prefix.size());
    for (const unsigned char character : prefix) {
        if (character == '%' || character == '_' || character == '\\') {
            escaped.push_back('\\');
        }
        escaped.push_back(static_cast<char>(character));
    }
    escaped.push_back('%');
    return escaped;
}

} // namespace

SqliteDiskStore::SqliteDiskStore(std::string path) : path_(std::move(path)) {
    std::lock_guard<std::mutex> lock(mutex_);
    openLocked();
}

SqliteDiskStore::~SqliteDiskStore() {
    std::lock_guard<std::mutex> lock(mutex_);
    closeLocked();
}

SqliteDiskStore& SqliteDiskStore::shared(const std::string& path) {
    std::lock_guard<std::mutex> lock(sharedMutex());
    auto& store = sharedStore();
    if (!store || store->path() != path) {
        store = std::make_unique<SqliteDiskStore>(path);
    }
    return *store;
}

void SqliteDiskStore::resetShared() {
    std::lock_guard<std::mutex> lock(sharedMutex());
    sharedStore().reset();
}

std::string SqliteDiskStore::defaultPath() {
#ifdef __APPLE__
    const char* home = std::getenv("HOME");
    if (home == nullptr || home[0] == '\0') {
        return "nitro-storage-disk.sqlite";
    }
    return std::string(home) + "/Library/Application Support/nitro-storage-disk.sqlite";
#else
    return "nitro-storage-disk.sqlite";
#endif
}

void SqliteDiskStore::openLocked() {
    const auto parent = std::filesystem::path(path_).parent_path();
    if (!parent.empty()) {
        std::filesystem::create_directories(parent);
    }
    sqlite3* db = nullptr;
    const int flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX;
    const int openRc = sqlite3_open_v2(path_.c_str(), &db, flags, nullptr);
    if (openRc != SQLITE_OK) {
        const int code = openRc;
        if (db != nullptr) {
            sqlite3_close(db);
        }
        throwSqlite(nullptr, "open", code);
    }
    db_ = db;
    sqlite3_busy_timeout(db_, 5000);
    execLocked("PRAGMA journal_mode=WAL;");
    execLocked("PRAGMA synchronous=NORMAL;");
    execLocked("PRAGMA temp_store=MEMORY;");
    execLocked(
        "CREATE TABLE IF NOT EXISTS kv ("
        "key TEXT PRIMARY KEY NOT NULL,"
        "value TEXT NOT NULL"
        ");"
    );
    setStmt_ = prepareLocked("INSERT OR REPLACE INTO kv(key, value) VALUES(?1, ?2);");
    getStmt_ = prepareLocked("SELECT value FROM kv WHERE key = ?1;");
    removeStmt_ = prepareLocked("DELETE FROM kv WHERE key = ?1;");
    hasStmt_ = prepareLocked("SELECT 1 FROM kv WHERE key = ?1 LIMIT 1;");
    keysStmt_ = prepareLocked("SELECT key FROM kv;");
    prefixStmt_ = prepareLocked("SELECT key FROM kv WHERE key LIKE ?1 ESCAPE '\\';");
    sizeStmt_ = prepareLocked("SELECT COUNT(*) FROM kv;");
    clearStmt_ = prepareLocked("DELETE FROM kv;");
    insertAbsentStmt_ = prepareLocked(
        "INSERT OR IGNORE INTO kv(key, value) VALUES(?1, ?2);"
    );
}

void SqliteDiskStore::closeLocked() {
    auto finalize = [](sqlite3_stmt*& stmt) {
        if (stmt != nullptr) {
            sqlite3_finalize(stmt);
            stmt = nullptr;
        }
    };
    finalize(setStmt_);
    finalize(getStmt_);
    finalize(removeStmt_);
    finalize(hasStmt_);
    finalize(keysStmt_);
    finalize(prefixStmt_);
    finalize(sizeStmt_);
    finalize(clearStmt_);
    finalize(insertAbsentStmt_);
    if (db_ != nullptr) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
}

void SqliteDiskStore::execLocked(const char* sql) {
    char* error = nullptr;
    const int rc = sqlite3_exec(db_, sql, nullptr, nullptr, &error);
    if (rc != SQLITE_OK) {
        const std::string message = error != nullptr ? error : "unknown error";
        sqlite3_free(error);
        throw std::runtime_error(
            std::string("NitroStorage: Disk SQLite exec failed: ") + message
        );
    }
}

void SqliteDiskStore::beginLocked() {
    execLocked("BEGIN IMMEDIATE;");
}

void SqliteDiskStore::commitLocked() {
    execLocked("COMMIT;");
}

void SqliteDiskStore::rollbackLocked() {
    sqlite3_exec(db_, "ROLLBACK;", nullptr, nullptr, nullptr);
}

sqlite3_stmt* SqliteDiskStore::prepareLocked(const char* sql) {
    sqlite3_stmt* stmt = nullptr;
    const int rc = sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) {
        throwSqlite(db_, "prepare", rc);
    }
    return stmt;
}

void SqliteDiskStore::setLocked(const std::string& key, const std::string& value) {
    sqlite3_reset(setStmt_);
    sqlite3_clear_bindings(setStmt_);
    bindText(setStmt_, 1, key);
    bindText(setStmt_, 2, value);
    const int rc = sqlite3_step(setStmt_);
    sqlite3_reset(setStmt_);
    if (rc != SQLITE_DONE) {
        throwSqlite(db_, "set", rc);
    }
}

std::optional<std::string> SqliteDiskStore::getLocked(const std::string& key) {
    sqlite3_reset(getStmt_);
    sqlite3_clear_bindings(getStmt_);
    bindText(getStmt_, 1, key);
    const int rc = sqlite3_step(getStmt_);
    if (rc == SQLITE_DONE) {
        sqlite3_reset(getStmt_);
        return std::nullopt;
    }
    if (rc != SQLITE_ROW) {
        sqlite3_reset(getStmt_);
        throwSqlite(db_, "get", rc);
    }
    const unsigned char* text = sqlite3_column_text(getStmt_, 0);
    const int bytes = sqlite3_column_bytes(getStmt_, 0);
    std::string value(
        text != nullptr ? reinterpret_cast<const char*>(text) : "",
        static_cast<size_t>(bytes)
    );
    sqlite3_reset(getStmt_);
    return value;
}

void SqliteDiskStore::removeLocked(const std::string& key) {
    sqlite3_reset(removeStmt_);
    sqlite3_clear_bindings(removeStmt_);
    bindText(removeStmt_, 1, key);
    const int rc = sqlite3_step(removeStmt_);
    sqlite3_reset(removeStmt_);
    if (rc != SQLITE_DONE) {
        throwSqlite(db_, "remove", rc);
    }
}

void SqliteDiskStore::set(const std::string& key, const std::string& value) {
    std::lock_guard<std::mutex> lock(mutex_);
    setLocked(key, value);
}

std::optional<std::string> SqliteDiskStore::get(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);
    return getLocked(key);
}

void SqliteDiskStore::remove(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);
    removeLocked(key);
}

bool SqliteDiskStore::has(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);
    sqlite3_reset(hasStmt_);
    sqlite3_clear_bindings(hasStmt_);
    bindText(hasStmt_, 1, key);
    const int rc = sqlite3_step(hasStmt_);
    sqlite3_reset(hasStmt_);
    if (rc == SQLITE_ROW) {
        return true;
    }
    if (rc == SQLITE_DONE) {
        return false;
    }
    throwSqlite(db_, "has", rc);
}

void SqliteDiskStore::setBatch(
    const std::vector<std::string>& keys,
    const std::vector<std::string>& values
) {
    std::lock_guard<std::mutex> lock(mutex_);
    beginLocked();
    try {
        const size_t count = std::min(keys.size(), values.size());
        for (size_t index = 0; index < count; ++index) {
            setLocked(keys[index], values[index]);
        }
        commitLocked();
    } catch (...) {
        rollbackLocked();
        throw;
    }
}

std::vector<std::optional<std::string>> SqliteDiskStore::getBatch(
    const std::vector<std::string>& keys
) {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<std::optional<std::string>> results;
    results.reserve(keys.size());
    for (const auto& key : keys) {
        results.push_back(getLocked(key));
    }
    return results;
}

void SqliteDiskStore::removeBatch(const std::vector<std::string>& keys) {
    std::lock_guard<std::mutex> lock(mutex_);
    beginLocked();
    try {
        for (const auto& key : keys) {
            removeLocked(key);
        }
        commitLocked();
    } catch (...) {
        rollbackLocked();
        throw;
    }
}

std::vector<std::string> SqliteDiskStore::getAllKeys() {
    std::lock_guard<std::mutex> lock(mutex_);
    sqlite3_reset(keysStmt_);
    std::vector<std::string> keys;
    while (true) {
        const int rc = sqlite3_step(keysStmt_);
        if (rc == SQLITE_DONE) {
            break;
        }
        if (rc != SQLITE_ROW) {
            sqlite3_reset(keysStmt_);
            throwSqlite(db_, "getAllKeys", rc);
        }
        const unsigned char* text = sqlite3_column_text(keysStmt_, 0);
        const int bytes = sqlite3_column_bytes(keysStmt_, 0);
        keys.emplace_back(
            text != nullptr ? reinterpret_cast<const char*>(text) : "",
            static_cast<size_t>(bytes)
        );
    }
    sqlite3_reset(keysStmt_);
    return keys;
}

std::vector<std::string> SqliteDiskStore::getKeysByPrefix(const std::string& prefix) {
    std::lock_guard<std::mutex> lock(mutex_);
    sqlite3_reset(prefixStmt_);
    sqlite3_clear_bindings(prefixStmt_);
    const std::string pattern = escapeLikePrefix(prefix);
    bindText(prefixStmt_, 1, pattern);
    std::vector<std::string> keys;
    while (true) {
        const int rc = sqlite3_step(prefixStmt_);
        if (rc == SQLITE_DONE) {
            break;
        }
        if (rc != SQLITE_ROW) {
            sqlite3_reset(prefixStmt_);
            throwSqlite(db_, "getKeysByPrefix", rc);
        }
        const unsigned char* text = sqlite3_column_text(prefixStmt_, 0);
        const int bytes = sqlite3_column_bytes(prefixStmt_, 0);
        keys.emplace_back(
            text != nullptr ? reinterpret_cast<const char*>(text) : "",
            static_cast<size_t>(bytes)
        );
    }
    sqlite3_reset(prefixStmt_);
    return keys;
}

size_t SqliteDiskStore::size() {
    std::lock_guard<std::mutex> lock(mutex_);
    sqlite3_reset(sizeStmt_);
    const int rc = sqlite3_step(sizeStmt_);
    if (rc != SQLITE_ROW) {
        sqlite3_reset(sizeStmt_);
        throwSqlite(db_, "size", rc);
    }
    const size_t count = static_cast<size_t>(sqlite3_column_int64(sizeStmt_, 0));
    sqlite3_reset(sizeStmt_);
    return count;
}

void SqliteDiskStore::clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    sqlite3_reset(clearStmt_);
    const int rc = sqlite3_step(clearStmt_);
    sqlite3_reset(clearStmt_);
    if (rc != SQLITE_DONE) {
        throwSqlite(db_, "clear", rc);
    }
}

void SqliteDiskStore::migrateIfAbsent(
    const std::vector<std::pair<std::string, std::string>>& entries
) {
    if (entries.empty()) {
        return;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    beginLocked();
    try {
        for (const auto& entry : entries) {
            sqlite3_reset(insertAbsentStmt_);
            sqlite3_clear_bindings(insertAbsentStmt_);
            bindText(insertAbsentStmt_, 1, entry.first);
            bindText(insertAbsentStmt_, 2, entry.second);
            const int rc = sqlite3_step(insertAbsentStmt_);
            sqlite3_reset(insertAbsentStmt_);
            if (rc != SQLITE_DONE) {
                throwSqlite(db_, "migrate", rc);
            }
        }
        commitLocked();
    } catch (...) {
        rollbackLocked();
        throw;
    }
}

} // namespace NitroStorage
