#include "AndroidStorageAdapterCpp.hpp"

namespace NitroStorage {

using namespace facebook::jni;
using JavaStringArray = JArrayClass<jstring>;

namespace {

local_ref<JavaStringArray> toJavaStringArray(const std::vector<std::string>& values) {
    auto javaArray = JavaStringArray::newArray(static_cast<jsize>(values.size()));
    for (size_t i = 0; i < values.size(); ++i) {
        auto javaValue = make_jstring(values[i]);
        javaArray->setElement(static_cast<jsize>(i), javaValue.get());
    }
    return javaArray;
}

std::vector<std::optional<std::string>> fromNullableJavaStringArray(alias_ref<JavaStringArray> values) {
    std::vector<std::optional<std::string>> parsedValues;
    if (!values) return parsedValues;

    const jsize size = static_cast<jsize>(values->size());
    parsedValues.reserve(size);
    for (jsize i = 0; i < size; ++i) {
        auto currentValue = values->getElement(i);
        if (!currentValue) {
            parsedValues.push_back(std::nullopt);
            continue;
        }
        parsedValues.push_back(currentValue->toStdString());
    }
    return parsedValues;
}

std::vector<std::string> fromJavaStringArray(alias_ref<JavaStringArray> values) {
    std::vector<std::string> result;
    if (!values) return result;

    const jsize size = static_cast<jsize>(values->size());
    result.reserve(size);
    for (jsize i = 0; i < size; ++i) {
        auto currentValue = values->getElement(i);
        if (currentValue) {
            result.push_back(currentValue->toStdString());
        }
    }
    return result;
}

} // namespace

AndroidStorageAdapterCpp::AndroidStorageAdapterCpp(alias_ref<JObject> context) {
    if (!context) [[unlikely]] {
        throw std::runtime_error("NitroStorage: Android Context is null");
    }
}

AndroidStorageAdapterCpp::~AndroidStorageAdapterCpp() = default;

// --- Disk ---

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

bool AndroidStorageAdapterCpp::hasDisk(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jboolean(std::string)>("hasDisk");
    return method(AndroidStorageAdapterJava::javaClassStatic(), key);
}

std::vector<std::string> AndroidStorageAdapterCpp::getAllKeysDisk() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
        local_ref<JavaStringArray>()
    >("getAllKeysDisk");
    auto keys = method(AndroidStorageAdapterJava::javaClassStatic());
    return fromJavaStringArray(keys);
}

size_t AndroidStorageAdapterCpp::sizeDisk() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jint()>("sizeDisk");
    return static_cast<size_t>(method(AndroidStorageAdapterJava::javaClassStatic()));
}

void AndroidStorageAdapterCpp::setDiskBatch(
    const std::vector<std::string>& keys,
    const std::vector<std::string>& values
) {
    auto javaKeys = toJavaStringArray(keys);
    auto javaValues = toJavaStringArray(values);
    static auto method =
        AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
            void(alias_ref<JavaStringArray>, alias_ref<JavaStringArray>)
        >("setDiskBatch");
    method(AndroidStorageAdapterJava::javaClassStatic(), javaKeys, javaValues);
}

std::vector<std::optional<std::string>> AndroidStorageAdapterCpp::getDiskBatch(
    const std::vector<std::string>& keys
) {
    auto javaKeys = toJavaStringArray(keys);
    static auto method =
        AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
            local_ref<JavaStringArray>(alias_ref<JavaStringArray>)
        >("getDiskBatch");
    auto values = method(AndroidStorageAdapterJava::javaClassStatic(), javaKeys);
    return fromNullableJavaStringArray(values);
}

void AndroidStorageAdapterCpp::deleteDiskBatch(const std::vector<std::string>& keys) {
    auto javaKeys = toJavaStringArray(keys);
    static auto method =
        AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
            void(alias_ref<JavaStringArray>)
        >("deleteDiskBatch");
    method(AndroidStorageAdapterJava::javaClassStatic(), javaKeys);
}

void AndroidStorageAdapterCpp::clearDisk() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void()>("clearDisk");
    method(AndroidStorageAdapterJava::javaClassStatic());
}

// --- Secure ---

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

bool AndroidStorageAdapterCpp::hasSecure(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jboolean(std::string)>("hasSecure");
    return method(AndroidStorageAdapterJava::javaClassStatic(), key);
}

std::vector<std::string> AndroidStorageAdapterCpp::getAllKeysSecure() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
        local_ref<JavaStringArray>()
    >("getAllKeysSecure");
    auto keys = method(AndroidStorageAdapterJava::javaClassStatic());
    return fromJavaStringArray(keys);
}

size_t AndroidStorageAdapterCpp::sizeSecure() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jint()>("sizeSecure");
    return static_cast<size_t>(method(AndroidStorageAdapterJava::javaClassStatic()));
}

void AndroidStorageAdapterCpp::setSecureBatch(
    const std::vector<std::string>& keys,
    const std::vector<std::string>& values
) {
    auto javaKeys = toJavaStringArray(keys);
    auto javaValues = toJavaStringArray(values);
    static auto method =
        AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
            void(alias_ref<JavaStringArray>, alias_ref<JavaStringArray>)
        >("setSecureBatch");
    method(AndroidStorageAdapterJava::javaClassStatic(), javaKeys, javaValues);
}

std::vector<std::optional<std::string>> AndroidStorageAdapterCpp::getSecureBatch(
    const std::vector<std::string>& keys
) {
    auto javaKeys = toJavaStringArray(keys);
    static auto method =
        AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
            local_ref<JavaStringArray>(alias_ref<JavaStringArray>)
        >("getSecureBatch");
    auto values = method(AndroidStorageAdapterJava::javaClassStatic(), javaKeys);
    return fromNullableJavaStringArray(values);
}

void AndroidStorageAdapterCpp::deleteSecureBatch(const std::vector<std::string>& keys) {
    auto javaKeys = toJavaStringArray(keys);
    static auto method =
        AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
            void(alias_ref<JavaStringArray>)
        >("deleteSecureBatch");
    method(AndroidStorageAdapterJava::javaClassStatic(), javaKeys);
}

void AndroidStorageAdapterCpp::clearSecure() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void()>("clearSecure");
    method(AndroidStorageAdapterJava::javaClassStatic());
}

// --- Config (no-ops on Android; access control / groups are iOS-specific) ---

void AndroidStorageAdapterCpp::setSecureAccessControl(int /*level*/) {}
void AndroidStorageAdapterCpp::setKeychainAccessGroup(const std::string& /*group*/) {}

// --- Biometric ---

void AndroidStorageAdapterCpp::setSecureBiometric(const std::string& key, const std::string& value) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(std::string, std::string)>("setSecureBiometric");
    method(AndroidStorageAdapterJava::javaClassStatic(), key, value);
}

std::optional<std::string> AndroidStorageAdapterCpp::getSecureBiometric(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jstring(std::string)>("getSecureBiometric");
    auto result = method(AndroidStorageAdapterJava::javaClassStatic(), key);
    if (!result) return std::nullopt;
    return result->toStdString();
}

void AndroidStorageAdapterCpp::deleteSecureBiometric(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(std::string)>("deleteSecureBiometric");
    method(AndroidStorageAdapterJava::javaClassStatic(), key);
}

bool AndroidStorageAdapterCpp::hasSecureBiometric(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jboolean(std::string)>("hasSecureBiometric");
    return method(AndroidStorageAdapterJava::javaClassStatic(), key);
}

void AndroidStorageAdapterCpp::clearSecureBiometric() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void()>("clearSecureBiometric");
    method(AndroidStorageAdapterJava::javaClassStatic());
}

} // namespace NitroStorage
