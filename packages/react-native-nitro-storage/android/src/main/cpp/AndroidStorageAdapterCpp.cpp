#include "AndroidStorageAdapterCpp.hpp"

#include <limits>
#include <stdexcept>

namespace NitroStorage {

using namespace facebook::jni;
using JavaStringArray = JArrayClass<jstring>;

namespace {

local_ref<JString> toJavaString(const std::string& value) {
    // fbjni's std::string overload uses c_str(), which truncates embedded NUL.
    if (value.find('\0') == std::string::npos) return make_jstring(value);
    if (value.size() > static_cast<size_t>(std::numeric_limits<jsize>::max())) {
        throw std::length_error("Storage string exceeds the Java array limit");
    }
    const auto size = static_cast<jsize>(value.size());
    auto bytes = JArrayByte::newArray(size);
    bytes->setRegion(0, size, reinterpret_cast<const jbyte*>(value.data()));
    static auto constructor = JString::javaClassStatic()->getConstructor<
        jstring(jbyteArray, jstring)>();
    auto charset = make_jstring("UTF-8");
    return JString::javaClassStatic()->newObject(constructor, bytes.get(), charset.get());
}

local_ref<JavaStringArray> toJavaStringArray(const std::vector<std::string>& values) {
    auto javaArray = JavaStringArray::newArray(static_cast<jsize>(values.size()));
    for (size_t i = 0; i < values.size(); ++i) {
        auto javaValue = toJavaString(values[i]);
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
    if (!values) return {};
    const jsize size = values->size();
    std::vector<std::string> result;
    result.reserve(size);
    for (jsize i = 0; i < size; ++i) {
        auto currentValue = values->getElement(i);
        // Null entries are dropped so a missing key can never surface as the
        // empty-string clear sentinel used by change listeners.
        if (currentValue) {
            result.push_back(currentValue->toStdString());
        }
    }
    return result;
}

} // namespace

AndroidStorageAdapterCpp::AndroidStorageAdapterCpp() = default;

AndroidStorageAdapterCpp::~AndroidStorageAdapterCpp() = default;

// --- Disk ---

void AndroidStorageAdapterCpp::setDisk(const std::string& key, const std::string& value) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(alias_ref<JString>, alias_ref<JString>)>("setDisk");
    method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key), toJavaString(value));
}

std::optional<std::string> AndroidStorageAdapterCpp::getDisk(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jstring(alias_ref<JString>)>("getDisk");
    auto result = method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key));
    if (!result) return std::nullopt;
    return result->toStdString();
}

void AndroidStorageAdapterCpp::deleteDisk(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(alias_ref<JString>)>("deleteDisk");
    method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key));
}

bool AndroidStorageAdapterCpp::hasDisk(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jboolean(alias_ref<JString>)>("hasDisk");
    return method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key));
}

std::vector<std::string> AndroidStorageAdapterCpp::getAllKeysDisk() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
        local_ref<JavaStringArray>()
    >("getAllKeysDisk");
    auto keys = method(AndroidStorageAdapterJava::javaClassStatic());
    return fromJavaStringArray(keys);
}

std::vector<std::string> AndroidStorageAdapterCpp::getKeysByPrefixDisk(const std::string& prefix) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
        local_ref<JavaStringArray>(alias_ref<JString>)
    >("getKeysByPrefixDisk");
    auto keys = method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(prefix));
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
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(alias_ref<JString>, alias_ref<JString>)>("setSecure");
    method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key), toJavaString(value));
}

std::optional<std::string> AndroidStorageAdapterCpp::getSecure(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jstring(alias_ref<JString>)>("getSecure");
    auto result = method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key));
    if (!result) return std::nullopt;
    return result->toStdString();
}

void AndroidStorageAdapterCpp::deleteSecure(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(alias_ref<JString>)>("deleteSecure");
    method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key));
}

bool AndroidStorageAdapterCpp::hasSecure(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jboolean(alias_ref<JString>)>("hasSecure");
    return method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key));
}

std::vector<std::string> AndroidStorageAdapterCpp::getAllKeysSecure() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
        local_ref<JavaStringArray>()
    >("getAllKeysSecure");
    auto keys = method(AndroidStorageAdapterJava::javaClassStatic());
    return fromJavaStringArray(keys);
}

std::vector<std::string> AndroidStorageAdapterCpp::getKeysByPrefixSecure(const std::string& prefix) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<
        local_ref<JavaStringArray>(alias_ref<JString>)
    >("getKeysByPrefixSecure");
    auto keys = method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(prefix));
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
void AndroidStorageAdapterCpp::setSecureWritesAsync(bool enabled) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(jboolean)>("setSecureWritesAsync");
    method(AndroidStorageAdapterJava::javaClassStatic(), enabled);
}
void AndroidStorageAdapterCpp::setKeychainAccessGroup(const std::string& /*group*/) {}

// --- Biometric ---

void AndroidStorageAdapterCpp::setSecureBiometric(const std::string& key, const std::string& value) {
    setSecureBiometricWithLevel(key, value, 2);
}

void AndroidStorageAdapterCpp::setSecureBiometricWithLevel(const std::string& key, const std::string& value, int level) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(alias_ref<JString>, alias_ref<JString>, jint)>("setSecureBiometricWithLevel");
    method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key), toJavaString(value), level);
}

std::optional<std::string> AndroidStorageAdapterCpp::getSecureBiometric(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jstring(alias_ref<JString>)>("getSecureBiometric");
    auto result = method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key));
    if (!result) return std::nullopt;
    return result->toStdString();
}

void AndroidStorageAdapterCpp::deleteSecureBiometric(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void(alias_ref<JString>)>("deleteSecureBiometric");
    method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key));
}

bool AndroidStorageAdapterCpp::hasSecureBiometric(const std::string& key) {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<jboolean(alias_ref<JString>)>("hasSecureBiometric");
    return method(AndroidStorageAdapterJava::javaClassStatic(), toJavaString(key));
}

void AndroidStorageAdapterCpp::clearSecureBiometric() {
    static auto method = AndroidStorageAdapterJava::javaClassStatic()->getStaticMethod<void()>("clearSecureBiometric");
    method(AndroidStorageAdapterJava::javaClassStatic());
}

} // namespace NitroStorage
