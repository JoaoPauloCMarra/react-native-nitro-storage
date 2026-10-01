#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace NitroStorage {

inline int32_t toJniSize(size_t size, const char* what) {
    if (size > static_cast<size_t>(std::numeric_limits<int32_t>::max())) {
        throw std::length_error(what);
    }
    return static_cast<int32_t>(size);
}

inline size_t fromJniSize(int32_t size) {
    return size > 0 ? static_cast<size_t>(size) : 0;
}

} // namespace NitroStorage
