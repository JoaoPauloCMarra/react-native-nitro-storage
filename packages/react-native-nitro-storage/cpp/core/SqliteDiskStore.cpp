#include "SqliteDiskStore.hpp"

#include <sqlite3.h>

#include <algorithm>
#include <cerrno>
#include <cstdlib>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <system_error>

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

const char* storageErrorTag(sqlite3* db, int code) {
    switch (code & 0xff) {
        case SQLITE_FULL:
            return "[nitro-error:storage_full] ";
        case SQLITE_CORRUPT:
        case SQLITE_NOTADB:
            return "[nitro-error:storage_corruption] ";
        case SQLITE_IOERR: {
            const int systemError = db != nullptr ? sqlite3_system_errno(db) : 0;
            return systemError == ENOSPC || systemError == EDQUOT
                ? "[nitro-error:storage_full] "
                : "";
        }
        default:
            return "";
    }
}

[[noreturn]] void throwSqlite(sqlite3* db, const char* operation, int code) {
    const char* message = db != nullptr ? sqlite3_errmsg(db) : sqlite3_errstr(code);
    throw std::runtime_error(
        std::string(storageErrorTag(db, code)) + "NitroStorage: Disk SQLite " + operation +
        " failed: " + (message != nullptr ? message : "unknown error")
    );
}

void bindText(sqlite3_stmt* stmt, int index, const std::string& value) {
    const int rc = sqlite3_bind_text64(
        stmt,
        index,
        value.data(),
        static_cast<sqlite3_uint64>(value.size()),
        SQLITE_TRANSIENT,
        SQLITE_UTF8
    );
    if (rc != SQLITE_OK) {
        throwSqlite(sqlite3_db_handle(stmt), "bind", rc);
    }
}

std::string escapeLikePrefix(const std::string& prefix) {
    std::string escaped;
    escaped.reserve(prefix.size() + 1);
    for (const char character : prefix) {
        // SQLite LIKE stops at NUL; exact filtering below handles the full key.
        if (character == '\0') break;
        if (character == '%' || character == '_' || character == '\\') {
            escaped.push_back('\\');
        }
        escaped.push_back(character);
    }
    escaped.push_back('%');
    return escaped;
}

std::optional<std::string> prefixUpperBound(const std::string& prefix) {
    std::string upper = prefix;
    while (!upper.empty() && static_cast<unsigned char>(upper.back()) == 0xFF) {
        upper.pop_back();
    }
    if (upper.empty()) {
        return std::nullopt;
    }
    upper.back() = static_cast<char>(static_cast<unsigned char>(upper.back()) + 1);
    return upper;
}

} // namespace

SqliteDiskStore::SqliteDiskStore(std::string path) : path_(std::move(path)) {
    std::lock_guard<std::mutex> lock(mutex_);
    reopenLocked();
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

bool SqliteDiskStore::isValidUtf8(const std::string& value) {
    const auto* bytes = reinterpret_cast<const unsigned char*>(value.data());
    const size_t size = value.size();
    size_t index = 0;
    while (index < size) {
        const unsigned char lead = bytes[index];
        size_t length = 0;
        unsigned int minimum = 0;
        unsigned int codePoint = 0;
        if (lead < 0x80) {
            index += 1;
            continue;
        } else if ((lead & 0xE0) == 0xC0) {
            length = 2;
            minimum = 0x80;
            codePoint = lead & 0x1Fu;
        } else if ((lead & 0xF0) == 0xE0) {
            length = 3;
            minimum = 0x800;
            codePoint = lead & 0x0Fu;
        } else if ((lead & 0xF8) == 0xF0) {
            length = 4;
            minimum = 0x10000;
            codePoint = lead & 0x07u;
        } else {
            return false;
        }
        if (size - index < length) {
            return false;
        }
        for (size_t offset = 1; offset < length; ++offset) {
            const unsigned char continuation = bytes[index + offset];
            if ((continuation & 0xC0) != 0x80) {
                return false;
            }
            codePoint = (codePoint << 6) | (continuation & 0x3Fu);
        }
        if (codePoint < minimum || codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
            return false;
        }
        index += length;
    }
    return true;
}

void SqliteDiskStore::recreateShared(const std::string& path) {
    std::lock_guard<std::mutex> lock(sharedMutex());
    auto& store = sharedStore();
    if (store && store->path() == path) {
        store->recreate();
        return;
    }
    store.reset();
    removeDatabaseFiles(path);
    store = std::make_unique<SqliteDiskStore>(path);
}

void SqliteDiskStore::removeDatabaseFiles(const std::string& path) {
    for (const char* suffix : {"", "-wal", "-shm", "-journal"}) {
        std::error_code error;
        std::filesystem::remove(path + suffix, error);
        if (error) {
            throw std::runtime_error(
                "NitroStorage: Disk SQLite clear failed: cannot delete the database file: " +
                error.message()
            );
        }
    }
}

void SqliteDiskStore::recreate() {
    std::lock_guard<std::mutex> lock(mutex_);
    closeLocked();
    removeDatabaseFiles(path_);
    reopenLocked();
}

void SqliteDiskStore::reopenLocked() {
    try {
        openLocked();
    } catch (...) {
        closeLocked();
        throw;
    }
}

void SqliteDiskStore::ensureOpenLocked() {
    if (db_ == nullptr) {
        reopenLocked();
    }
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
        try {
            throwSqlite(db, "open", openRc);
        } catch (...) {
            if (db != nullptr) {
                sqlite3_close(db);
            }
            throw;
        }
    }
    db_ = db;
    sqlite3_busy_timeout(db_, 5000);
    execLocked("PRAGMA journal_mode=WAL;");
    execLocked("PRAGMA synchronous=NORMAL;");
    execLocked("PRAGMA temp_store=MEMORY;");
    execLocked("PRAGMA wal_autocheckpoint=1000;");
    execLocked("PRAGMA journal_size_limit=32768;");
    execLocked(
        "CREATE TABLE IF NOT EXISTS kv ("
        "key TEXT PRIMARY KEY NOT NULL,"
        "value TEXT NOT NULL"
        ");"
    );
    execLocked(
        "CREATE TABLE IF NOT EXISTS meta ("
        "k TEXT PRIMARY KEY NOT NULL,"
        "v TEXT NOT NULL"
        ");"
    );
    setStmt_ = prepareLocked("INSERT OR REPLACE INTO kv(key, value) VALUES(?1, ?2);");
    getStmt_ = prepareLocked("SELECT value FROM kv WHERE key = ?1;");
    removeStmt_ = prepareLocked("DELETE FROM kv WHERE key = ?1;");
    hasStmt_ = prepareLocked("SELECT 1 FROM kv WHERE key = ?1 LIMIT 1;");
    keysStmt_ = prepareLocked("SELECT key FROM kv;");
    prefixRangeStmt_ = prepareLocked("SELECT key FROM kv WHERE key >= ?1 AND key < ?2;");
    prefixFromStmt_ = prepareLocked("SELECT key FROM kv WHERE key >= ?1;");
    prefixLikeStmt_ = prepareLocked("SELECT key FROM kv WHERE key LIKE ?1 ESCAPE '\\';");
    sizeStmt_ = prepareLocked("SELECT COUNT(*) FROM kv;");
    clearStmt_ = prepareLocked("DELETE FROM kv;");
    insertAbsentStmt_ = prepareLocked(
        "INSERT OR IGNORE INTO kv(key, value) VALUES(?1, ?2);"
    );
    getMetaStmt_ = prepareLocked("SELECT 1 FROM meta WHERE k = ?1 LIMIT 1;");
    setMetaStmt_ = prepareLocked("INSERT OR REPLACE INTO meta(k, v) VALUES(?1, ?2);");
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
    finalize(prefixRangeStmt_);
    finalize(prefixFromStmt_);
    finalize(prefixLikeStmt_);
    finalize(sizeStmt_);
    finalize(clearStmt_);
    finalize(insertAbsentStmt_);
    finalize(getMetaStmt_);
    finalize(setMetaStmt_);
    if (db_ != nullptr) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
}

void SqliteDiskStore::execLocked(const char* sql) {
    const int rc = sqlite3_exec(db_, sql, nullptr, nullptr, nullptr);
    if (rc != SQLITE_OK) {
        throwSqlite(db_, "exec", rc);
    }
}

void SqliteDiskStore::limitPageCountForTesting(int pages) {
    std::lock_guard<std::mutex> lock(mutex_);
    ensureOpenLocked();
    execLocked(("PRAGMA max_page_count=" + std::to_string(pages) + ";").c_str());
}

void SqliteDiskStore::limitValueLengthForTesting(int bytes) {
    std::lock_guard<std::mutex> lock(mutex_);
    ensureOpenLocked();
    sqlite3_limit(db_, SQLITE_LIMIT_LENGTH, bytes);
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
    ensureOpenLocked();
    setLocked(key, value);
}

std::optional<std::string> SqliteDiskStore::get(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);
    ensureOpenLocked();
    return getLocked(key);
}

void SqliteDiskStore::remove(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);
    ensureOpenLocked();
    removeLocked(key);
}

bool SqliteDiskStore::has(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);
    ensureOpenLocked();
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
    ensureOpenLocked();
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
    ensureOpenLocked();
    std::vector<std::optional<std::string>> results;
    results.reserve(keys.size());
    for (const auto& key : keys) {
        results.push_back(getLocked(key));
    }
    return results;
}

void SqliteDiskStore::removeBatch(const std::vector<std::string>& keys) {
    std::lock_guard<std::mutex> lock(mutex_);
    ensureOpenLocked();
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
    ensureOpenLocked();
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
    ensureOpenLocked();
    const bool useRange = isValidUtf8(prefix);
    const auto upperBound = useRange ? prefixUpperBound(prefix) : std::nullopt;
    sqlite3_stmt* stmt = !useRange
        ? prefixLikeStmt_
        : upperBound.has_value() ? prefixRangeStmt_ : prefixFromStmt_;
    sqlite3_reset(stmt);
    sqlite3_clear_bindings(stmt);
    bindText(stmt, 1, useRange ? prefix : escapeLikePrefix(prefix));
    if (upperBound.has_value()) {
        bindText(stmt, 2, *upperBound);
    }
    std::vector<std::string> keys;
    while (true) {
        const int rc = sqlite3_step(stmt);
        if (rc == SQLITE_DONE) {
            break;
        }
        if (rc != SQLITE_ROW) {
            sqlite3_reset(stmt);
            throwSqlite(db_, "getKeysByPrefix", rc);
        }
        const unsigned char* text = sqlite3_column_text(stmt, 0);
        const int bytes = sqlite3_column_bytes(stmt, 0);
        std::string key(
            text != nullptr ? reinterpret_cast<const char*>(text) : "",
            static_cast<size_t>(bytes)
        );
        if (key.compare(0, prefix.size(), prefix) == 0) {
            keys.push_back(std::move(key));
        }
    }
    sqlite3_reset(stmt);
    return keys;
}

size_t SqliteDiskStore::size() {
    std::lock_guard<std::mutex> lock(mutex_);
    ensureOpenLocked();
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
    ensureOpenLocked();
    sqlite3_reset(clearStmt_);
    const int rc = sqlite3_step(clearStmt_);
    sqlite3_reset(clearStmt_);
    if (rc != SQLITE_DONE) {
        throwSqlite(db_, "clear", rc);
    }
}

void SqliteDiskStore::insertAbsentLocked(
    const std::vector<std::pair<std::string, std::string>>& entries
) {
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
}

bool SqliteDiskStore::hasMigrationMarkerLocked(const std::string& name) {
    sqlite3_reset(getMetaStmt_);
    sqlite3_clear_bindings(getMetaStmt_);
    bindText(getMetaStmt_, 1, name);
    const int rc = sqlite3_step(getMetaStmt_);
    sqlite3_reset(getMetaStmt_);
    if (rc == SQLITE_ROW) {
        return true;
    }
    if (rc == SQLITE_DONE) {
        return false;
    }
    throwSqlite(db_, "hasMigrationMarker", rc);
}

void SqliteDiskStore::setMigrationMarkerLocked(const std::string& name) {
    sqlite3_reset(setMetaStmt_);
    sqlite3_clear_bindings(setMetaStmt_);
    bindText(setMetaStmt_, 1, name);
    bindText(setMetaStmt_, 2, "1");
    const int rc = sqlite3_step(setMetaStmt_);
    sqlite3_reset(setMetaStmt_);
    if (rc != SQLITE_DONE) {
        throwSqlite(db_, "setMigrationMarker", rc);
    }
}

void SqliteDiskStore::migrateIfAbsent(
    const std::vector<std::pair<std::string, std::string>>& entries
) {
    if (entries.empty()) {
        return;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    ensureOpenLocked();
    beginLocked();
    try {
        insertAbsentLocked(entries);
        commitLocked();
    } catch (...) {
        rollbackLocked();
        throw;
    }
}

bool SqliteDiskStore::hasMigrationMarker(const std::string& name) {
    std::lock_guard<std::mutex> lock(mutex_);
    ensureOpenLocked();
    return hasMigrationMarkerLocked(name);
}

void SqliteDiskStore::migrateOnce(
    const std::string& name,
    const std::vector<std::pair<std::string, std::string>>& entries
) {
    std::lock_guard<std::mutex> lock(mutex_);
    ensureOpenLocked();
    beginLocked();
    try {
        if (hasMigrationMarkerLocked(name)) {
            commitLocked();
            return;
        }
        insertAbsentLocked(entries);
        setMigrationMarkerLocked(name);
        commitLocked();
    } catch (...) {
        rollbackLocked();
        throw;
    }
}

} // namespace NitroStorage
