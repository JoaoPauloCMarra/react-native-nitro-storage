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
const rnDir = path.join(nodeModules, "react-native");
const jsiDir = path.join(rnDir, "ReactCommon", "jsi");
const nitroDir = path.join(nodeModules, "react-native-nitro-modules", "cpp");

if (!fs.existsSync(rnDir) || !fs.existsSync(nitroDir)) {
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

// Paths
const testFile = path.join(cppDir, "core", "StorageTest.cpp");
const outputFile = path.join(buildDir, "storage_test");

// Basic JSI compilation (mocked or real)
// We link JSI sources to properly resolve HostObject symbols
const jsiSources = [
  path.join(jsiDir, "jsi", "jsi.cpp"),
  // path.join(jsiDir, "jsi", "JSIDynamic.cpp") // Optional
];
const jsiImpl = jsiSources.filter((f) => fs.existsSync(f)).join(" ");

console.log("⚙️  Compiling...");

const compileCmd = [
  "clang++",
  "-std=c++17",
  "-g",
  // Includes
  `-I${path.join(cppDir, "core")}`,
  // Sources
  testFile,
  // Output
  `-o ${outputFile}`,

  // Linker flags (must come after sources)
  process.platform === "darwin" ? "-stdlib=libc++" : "-lpthread",
].join(" ");

try {
  execSync(compileCmd, { stdio: "inherit" });
  console.log("✅ Compilation successful.");

  console.log("🚀 Running tests...");
  try {
    execSync(outputFile, { stdio: "inherit" });
    console.log("✅ C++ tests passed!");
  } catch (e) {
    console.error("❌ C++ tests failed.");
    process.exit(1);
  }
} catch (error) {
  console.error("❌ C++ compilation failed.");
  process.exit(1);
}
