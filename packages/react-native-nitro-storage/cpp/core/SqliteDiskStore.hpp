#pragma once

#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

struct sqlite3;
struct sqlite3_stmt;

namespace NitroStorage {

class SqliteDiskStore {
public:
    explicit SqliteDiskStore(std::string path);
    SqliteDiskStore(const SqliteDiskStore&) = delete;
    SqliteDiskStore& operator=(const SqliteDiskStore&) = delete;
    ~SqliteDiskStore();

    static SqliteDiskStore& shared(const std::string& path);
    static void resetShared();
    static std::string defaultPath();

    const std::string& path() const { return path_; }

    void set(const std::string& key, const std::string& value);
    std::optional<std::string> get(const std::string& key);
    void remove(const std::string& key);
    bool has(const std::string& key);
    void setBatch(
        const std::vector<std::string>& keys,
        const std::vector<std::string>& values
    );
    std::vector<std::optional<std::string>> getBatch(const std::vector<std::string>& keys);
    void removeBatch(const std::vector<std::string>& keys);
    std::vector<std::string> getAllKeys();
    std::vector<std::string> getKeysByPrefix(const std::string& prefix);
    size_t size();
    void clear();
    void migrateIfAbsent(const std::vector<std::pair<std::string, std::string>>& entries);

private:
    void openLocked();
    void closeLocked();
    void execLocked(const char* sql);
    void beginLocked();
    void commitLocked();
    void rollbackLocked();
    void setLocked(const std::string& key, const std::string& value);
    std::optional<std::string> getLocked(const std::string& key);
    void removeLocked(const std::string& key);
    sqlite3_stmt* prepareLocked(const char* sql);

    std::string path_;
    sqlite3* db_ = nullptr;
    sqlite3_stmt* setStmt_ = nullptr;
    sqlite3_stmt* getStmt_ = nullptr;
    sqlite3_stmt* removeStmt_ = nullptr;
    sqlite3_stmt* hasStmt_ = nullptr;
    sqlite3_stmt* keysStmt_ = nullptr;
    sqlite3_stmt* prefixStmt_ = nullptr;
    sqlite3_stmt* sizeStmt_ = nullptr;
    sqlite3_stmt* clearStmt_ = nullptr;
    sqlite3_stmt* insertAbsentStmt_ = nullptr;
    std::mutex mutex_;
};

} // namespace NitroStorage
