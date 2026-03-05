const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const cppDir = path.join(__dirname, "..", "cpp");
const buildDir = path.join(cppDir, "build");

// Ensure build directory exists
if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDir, { recursive: true });

console.log("🛠️  Preparing C++ test environment...");

// Locate Dependencies
const nodeModules = path.join(__dirname, "..", "node_modules");
const nitroDir = path.join(nodeModules, "react-native-nitro-modules", "cpp");

if (!fs.existsSync(nitroDir)) {
  console.error("❌ Dependencies not found. Run 'bun install' first.");
  process.exit(1);
}

// Create virtual include directory for <NitroModules/...> mapping
const includeRoot = path.join(buildDir, "headers");
const nitroVirtualDir = path.join(includeRoot, "NitroModules");
fs.mkdirSync(nitroVirtualDir, { recursive: true });

// Copy/Symlink Nitro Headers to virtual directory
// Nitro modules are split into core, platform, etc. but expected to be in <NitroModules/Header.hpp>
const nitroSubdirs = [
  "core",
  "platform",
  "registry",
  "jsi",
  "utils",
  "threading",
  "views",
  "entrypoint",
  "prototype",
  "templates",
];
nitroSubdirs.forEach((subdir) => {
  const src = path.join(nitroDir, subdir);
  if (fs.existsSync(src)) {
    fs.readdirSync(src).forEach((file) => {
      if (file.endsWith(".h") || file.endsWith(".hpp")) {
        const destPath = path.join(nitroVirtualDir, file);
        // Copy since symlinks can be flaky with some compiler settings or permissions
        fs.copyFileSync(path.join(src, file), destPath);
      }
    });
  }
});

// Test-only lightweight NitroModules stub for HybridStorage unit tests.
const hybridObjectStubPath = path.join(nitroVirtualDir, "HybridObject.hpp");
fs.writeFileSync(
  hybridObjectStubPath,
  `#pragma once
#include <memory>
#include <utility>

namespace margelo::nitro {

class Prototype {
public:
  template <typename... Args>
  void registerHybridMethod(const char*, Args...) {}
};

class HybridObject : public std::enable_shared_from_this<HybridObject> {
public:
  explicit HybridObject(const char* = "") {}
  virtual ~HybridObject() = default;
  virtual void loadHybridMethods() {}

protected:
  template <typename Fn>
  void registerHybrids(HybridObject*, Fn&& fn) {
    Prototype prototype;
    fn(prototype);
  }
};

} // namespace margelo::nitro
`,
  "utf8",
);

// Paths
const storageTestFile = path.join(cppDir, "core", "StorageTest.cpp");
const storageOutputFile = path.join(buildDir, "storage_test");
const hybridTestFile = path.join(cppDir, "bindings", "HybridStorageTest.cpp");
const hybridSourceFile = path.join(cppDir, "bindings", "HybridStorage.cpp");
const hybridSpecFile = path.join(
  __dirname,
  "..",
  "nitrogen",
  "generated",
  "shared",
  "c++",
  "HybridStorageSpec.cpp",
);
const hybridOutputFile = path.join(buildDir, "hybrid_storage_test");

console.log("⚙️  Compiling...");

const commonFlags = [
  "clang++",
  "-std=c++17",
  "-g",
  process.platform === "darwin" ? "-stdlib=libc++" : "",
];
const linkFlags = process.platform === "darwin" ? "" : "-lpthread";

try {
  const compileStorageCmd = [
    ...commonFlags,
    `-I${path.join(cppDir, "core")}`,
    storageTestFile,
    `-o ${storageOutputFile}`,
    linkFlags,
  ].join(" ");
  execSync(compileStorageCmd, { stdio: "inherit" });

  const compileHybridCmd = [
    ...commonFlags,
    "-DNITRO_STORAGE_DISABLE_PLATFORM_ADAPTER",
    "-DNITRO_STORAGE_USE_ORDERED_MAP_FOR_TESTS",
    `-I${path.join(cppDir, "core")}`,
    `-I${path.join(cppDir, "bindings")}`,
    `-I${includeRoot}`,
    `-I${path.join(__dirname, "..", "nitrogen", "generated", "shared", "c++")}`,
    hybridTestFile,
    hybridSourceFile,
    hybridSpecFile,
    `-o ${hybridOutputFile}`,
    linkFlags,
  ].join(" ");
  execSync(compileHybridCmd, { stdio: "inherit" });

  console.log("✅ Compilation successful.");
  console.log("🚀 Running tests...");

  execSync(storageOutputFile, { stdio: "inherit" });
  execSync(hybridOutputFile, { stdio: "inherit" });
  console.log("✅ C++ tests passed!");
} catch (error) {
  console.error("❌ C++ tests failed.");
  process.exit(1);
}
