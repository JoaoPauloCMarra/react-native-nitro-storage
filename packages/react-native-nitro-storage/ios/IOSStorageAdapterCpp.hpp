#pragma once

#include "../core/NativeStorageAdapter.hpp"

namespace NitroStorage {

class IOSStorageAdapterCpp : public NativeStorageAdapter {
public:
    IOSStorageAdapterCpp();
    ~IOSStorageAdapterCpp() override;
    
    void setDisk(const std::string& key, const std::string& value) override;
    std::optional<std::string> getDisk(const std::string& key) override;
    void deleteDisk(const std::string& key) override;
    
    void setSecure(const std::string& key, const std::string& value) override;
    std::optional<std::string> getSecure(const std::string& key) override;
    void deleteSecure(const std::string& key) override;
    
    void clearDisk() override;
    void clearSecure() override;
};

} // namespace NitroStorage
