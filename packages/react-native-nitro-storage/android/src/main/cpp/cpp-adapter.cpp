#include <jni.h>
#include "NitroStorageOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* reserved) {
  return margelo::nitro::NitroStorage::initialize(vm);
}
