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

  void setDisk(std::string key, std::string value) {
      static auto method = javaClassStatic()->getMethod<void(std::string, std::string)>("setDisk");
      method(self(), key, value);
  }

  std::string getDisk(std::string key) {
      static auto method = javaClassStatic()->getMethod<jstring(std::string)>("getDisk");
      auto result = method(self(), key);
      return result ? result->toStdString() : "";
  }
  
  void deleteDisk(std::string key) {
      static auto method = javaClassStatic()->getMethod<void(std::string)>("deleteDisk");
      method(self(), key);
  }

  void setSecure(std::string key, std::string value) {
      static auto method = javaClassStatic()->getMethod<void(std::string, std::string)>("setSecure");
      method(self(), key, value);
  }

  std::string getSecure(std::string key) {
      static auto method = javaClassStatic()->getMethod<jstring(std::string)>("getSecure");
      auto result = method(self(), key);
      return result ? result->toStdString() : "";
  }
  
  void deleteSecure(std::string key) {
      static auto method = javaClassStatic()->getMethod<void(std::string)>("deleteSecure");
      method(self(), key);
  }
};

class AndroidStorageAdapterCpp : public NativeStorageAdapter {
public:
    explicit AndroidStorageAdapterCpp(facebook::jni::alias_ref<facebook::jni::JObject> context);
    ~AndroidStorageAdapterCpp() override;
    
    void setDisk(const std::string& key, const std::string& value) override;
    std::optional<std::string> getDisk(const std::string& key) override;
    void deleteDisk(const std::string& key) override;
    
    void setSecure(const std::string& key, const std::string& value) override;
    std::optional<std::string> getSecure(const std::string& key) override;
    void deleteSecure(const std::string& key) override;
};

} // namespace NitroStorage
