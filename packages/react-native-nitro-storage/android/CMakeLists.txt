cmake_minimum_required(VERSION 3.18.0)

project(NitroStorage)

set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# 1. Define source files (Manual implementation)
file(GLOB SOURCES
  "../cpp/bindings/*.cpp"
  "../cpp/core/*.cpp"
  "./src/main/cpp/*.cpp"
)

# 2. Create the library target
add_library(
  NitroStorage
  SHARED
  ${SOURCES}
)

# 3. Include directories for manual sources
target_include_directories(
  NitroStorage
  PRIVATE
  "../cpp/core"
  "../cpp/bindings"
  "./src/main/cpp"
)

# 4. Include Nitrogen Autolinking (adds generated sources, finding packages, linking libs)
include("../nitrogen/generated/android/NitroStorage+autolinking.cmake")

# 5. Link standard Android libraries
target_link_libraries(
  NitroStorage
  android
  log
)
