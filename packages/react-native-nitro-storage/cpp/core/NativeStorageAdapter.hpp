#pragma once

#include <string>
#include <optional>
#include <vector>

namespace NitroStorage {

class NativeStorageAdapter {
public:
    virtual ~NativeStorageAdapter() = default;
    
    virtual void setDisk(const std::string& key, const std::string& value) = 0;
    virtual std::optional<std::string> getDisk(const std::string& key) = 0;
    virtual void deleteDisk(const std::string& key) = 0;
    virtual void setDiskBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values) = 0;
    virtual std::vector<std::optional<std::string>> getDiskBatch(const std::vector<std::string>& keys) = 0;
    virtual void deleteDiskBatch(const std::vector<std::string>& keys) = 0;
    
    virtual void setSecure(const std::string& key, const std::string& value) = 0;
    virtual std::optional<std::string> getSecure(const std::string& key) = 0;
    virtual void deleteSecure(const std::string& key) = 0;
    virtual void setSecureBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values) = 0;
    virtual std::vector<std::optional<std::string>> getSecureBatch(const std::vector<std::string>& keys) = 0;
    virtual void deleteSecureBatch(const std::vector<std::string>& keys) = 0;
    
    virtual void clearDisk() = 0;
    virtual void clearSecure() = 0;
};

} // namespace NitroStorage
