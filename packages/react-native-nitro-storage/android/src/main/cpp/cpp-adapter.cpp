#include <jni.h>
#include <fbjni/fbjni.h>
#include "../../../nitrogen/generated/android/NitroStorageOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::NitroStorage::initialize(vm);
}
