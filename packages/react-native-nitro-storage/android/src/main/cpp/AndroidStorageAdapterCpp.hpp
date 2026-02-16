#pragma once

#include "NativeStorageAdapter.hpp"
#include <fbjni/fbjni.h>
#include <jni.h>

namespace NitroStorage {

struct JContext : facebook::jni::JavaClass<JContext> {
  static constexpr auto kJavaDescriptor = "Landroid/content/Context;";
};

struct AndroidStorageAdapterJava : facebook::jni::JavaClass<AndroidStorageAdapterJava> {
  static constexpr auto kJavaDescriptor = "Lcom/nitrostorage/AndroidStorageAdapter;";
  
  static facebook::jni::alias_ref<facebook::jni::JObject> getContext() {
     static auto method = javaClassStatic()->getStaticMethod<facebook::jni::JObject()>("getContext", "()Landroid/content/Context;");
     return method(javaClassStatic());
  }

};

class AndroidStorageAdapterCpp : public NativeStorageAdapter {
public:
    explicit AndroidStorageAdapterCpp(facebook::jni::alias_ref<facebook::jni::JObject> context);
    ~AndroidStorageAdapterCpp() override;
    
    void setDisk(const std::string& key, const std::string& value) override;
    std::optional<std::string> getDisk(const std::string& key) override;
    void deleteDisk(const std::string& key) override;
    bool hasDisk(const std::string& key) override;
    std::vector<std::string> getAllKeysDisk() override;
    size_t sizeDisk() override;
    void setDiskBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values) override;
    std::vector<std::optional<std::string>> getDiskBatch(const std::vector<std::string>& keys) override;
    void deleteDiskBatch(const std::vector<std::string>& keys) override;
    
    void setSecure(const std::string& key, const std::string& value) override;
    std::optional<std::string> getSecure(const std::string& key) override;
    void deleteSecure(const std::string& key) override;
    bool hasSecure(const std::string& key) override;
    std::vector<std::string> getAllKeysSecure() override;
    size_t sizeSecure() override;
    void setSecureBatch(const std::vector<std::string>& keys, const std::vector<std::string>& values) override;
    std::vector<std::optional<std::string>> getSecureBatch(const std::vector<std::string>& keys) override;
    void deleteSecureBatch(const std::vector<std::string>& keys) override;
    
    void clearDisk() override;
    void clearSecure() override;

    void setSecureAccessControl(int level) override;
    void setKeychainAccessGroup(const std::string& group) override;

    void setSecureBiometric(const std::string& key, const std::string& value) override;
    std::optional<std::string> getSecureBiometric(const std::string& key) override;
    void deleteSecureBiometric(const std::string& key) override;
    bool hasSecureBiometric(const std::string& key) override;
    void clearSecureBiometric() override;
};

} // namespace NitroStorage
