#include "AndroidStorageAdapterCpp.hpp"

namespace NitroStorage {

using namespace facebook::jni;

AndroidStorageAdapterCpp::AndroidStorageAdapterCpp(alias_ref<JObject> context) {
    if (!context) [[unlikely]] {
        throw std::runtime_error("NitroStorage: Android Context is null");
    }
}

AndroidStorageAdapterCpp::~AndroidStorageAdapterCpp() = default;

void AndroidStorageAdapterCpp::setDisk(const std::string& key, const std::string& value) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(std::string, std::string)>("setDisk");
    method(AndroidStorageAdapterJava::javaClassStatic(), key, value);
}

std::optional<std::string> AndroidStorageAdapterCpp::getDisk(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jstring(std::string)>("getDisk");
    auto result = method(AndroidStorageAdapterJava::javaClassStatic(), key);
    if (!result) return std::nullopt;
    return result->toStdString();
}

void AndroidStorageAdapterCpp::deleteDisk(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(std::string)>("deleteDisk");
    method(AndroidStorageAdapterJava::javaClassStatic(), key);
}

void AndroidStorageAdapterCpp::setSecure(const std::string& key, const std::string& value) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(std::string, std::string)>("setSecure");
    method(AndroidStorageAdapterJava::javaClassStatic(), key, value);
}

std::optional<std::string> AndroidStorageAdapterCpp::getSecure(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jstring(std::string)>("getSecure");
    auto result = method(AndroidStorageAdapterJava::javaClassStatic(), key);
    if (!result) return std::nullopt;
    return result->toStdString();
}

void AndroidStorageAdapterCpp::deleteSecure(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(std::string)>("deleteSecure");
    method(AndroidStorageAdapterJava::javaClassStatic(), key);
}

void AndroidStorageAdapterCpp::clearDisk() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void()>("clearDisk");
    method(AndroidStorageAdapterJava::javaClassStatic());
}

void AndroidStorageAdapterCpp::clearSecure() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void()>("clearSecure");
    method(AndroidStorageAdapterJava::javaClassStatic());
}

} // namespace NitroStorage
