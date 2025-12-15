#pragma once

#include <string>
#include <optional>

namespace NitroStorage {

class NativeStorageAdapter {
public:
    virtual ~NativeStorageAdapter() = default;
    
    virtual void setDisk(const std::string& key, const std::string& value) = 0;
    virtual std::optional<std::string> getDisk(const std::string& key) = 0;
    virtual void deleteDisk(const std::string& key) = 0;
    
    virtual void setSecure(const std::string& key, const std::string& value) = 0;
    virtual std::optional<std::string> getSecure(const std::string& key) = 0;
    virtual void deleteSecure(const std::string& key) = 0;
};

} // namespace NitroStorage
