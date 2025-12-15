cmake_minimum_required(VERSION 3.22.1)
project(NitroStorage)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Define the path to our C++ sources
set(CPP_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../cpp")

# Collect source files
file(GLOB CORE_SOURCES "${CPP_ROOT}/core/*.cpp")
file(GLOB BINDING_SOURCES "${CPP_ROOT}/bindings/*.cpp")

# Create the shared library with our sources
add_library(${PROJECT_NAME} SHARED
    ${CORE_SOURCES}
    ${BINDING_SOURCES}
    # JNI adapter
    src/main/cpp/cpp-adapter.cpp
    src/main/cpp/AndroidStorageAdapterCpp.cpp
)

# Include directories
target_include_directories(${PROJECT_NAME} PRIVATE
    "${CPP_ROOT}/core"
    "${CPP_ROOT}/bindings"
    "src/main/cpp"
)

# Include Nitro autolinking (adds nitrogen sources, definitions, and links)
include(${CMAKE_CURRENT_SOURCE_DIR}/../nitrogen/generated/android/NitroStorage+autolinking.cmake)
