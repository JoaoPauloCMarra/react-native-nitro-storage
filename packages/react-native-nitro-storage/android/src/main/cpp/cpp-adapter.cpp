#include <jni.h>
#include <fbjni/fbjni.h>
#include "../../../nitrogen/generated/android/NitroStorageOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::NitroStorage::registerAllNatives();
  });
}
