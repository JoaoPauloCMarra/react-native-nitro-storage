const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const coverageEnabled = process.argv.includes("--coverage");
const sanitizerArg = process.argv.find((arg) => arg.startsWith("--sanitize="));
const sanitizer = sanitizerArg?.split("=")[1];
const supportedSanitizers = new Set(["address", "undefined", "thread"]);

if (sanitizer !== undefined && !supportedSanitizers.has(sanitizer)) {
  console.error(
    "❌ Unsupported sanitizer. Use --sanitize=address, --sanitize=undefined, or --sanitize=thread.",
  );
  process.exit(1);
}

if (coverageEnabled && sanitizer !== undefined) {
  console.error("❌ Coverage and sanitizer modes cannot run together.");
  process.exit(1);
}

const cppDir = path.join(__dirname, "..", "cpp");
const buildMode = coverageEnabled
  ? "coverage"
  : sanitizer === undefined
    ? "default"
    : sanitizer;
const buildDir = path.join(cppDir, "build", buildMode);

// Ensure build directory exists
if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
}
fs.mkdirSync(buildDir, { recursive: true });

console.log("🛠️  Preparing C++ test environment...");

// Locate Dependencies. Bun's hoisted linker installs workspace deps at the
// monorepo root, while isolated installs may keep package-local node_modules.
const packageRoot = path.join(__dirname, "..");
const workspaceRoot = path.join(packageRoot, "..", "..");
const nitroDir = [
  path.join(packageRoot, "node_modules", "react-native-nitro-modules", "cpp"),
  path.join(workspaceRoot, "node_modules", "react-native-nitro-modules", "cpp"),
].find((candidate) => fs.existsSync(candidate));
const reactNativeJsiDir = [
  path.join(
    packageRoot,
    "node_modules",
    "react-native",
    "ReactCommon",
    "jsi",
  ),
  path.join(
    workspaceRoot,
    "node_modules",
    "react-native",
    "ReactCommon",
    "jsi",
  ),
].find((candidate) => fs.existsSync(candidate));

if (!nitroDir || !reactNativeJsiDir) {
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
  virtual size_t getExternalMemorySize() noexcept { return 0; }

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
  "-std=c++20",
  "-g",
  ...(sanitizer !== undefined ? [`-fsanitize=${sanitizer}`] : []),
  ...(sanitizer !== undefined ? ["-fno-omit-frame-pointer"] : []),
  ...(coverageEnabled
    ? ["-fprofile-instr-generate", "-fcoverage-mapping"]
    : []),
  ...(process.platform === "darwin" ? ["-stdlib=libc++"] : []),
];
const linkFlags = [
  ...(sanitizer !== undefined ? [`-fsanitize=${sanitizer}`] : []),
  ...(process.platform === "darwin" ? [] : ["-lpthread"]),
];

function resolveLlvmTool(name) {
  if (process.platform !== "darwin") {
    return name;
  }
  return execFileSync("xcrun", ["--find", name], { encoding: "utf8" }).trim();
}

function runCommand(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: "inherit",
    ...options,
  });
}

function signDarwinBinary(binaryPath) {
  if (process.platform !== "darwin") {
    return;
  }

  execFileSync("codesign", ["--force", "--sign", "-", binaryPath], {
    stdio: "ignore",
  });
}

function sanitizerRuntimeEnv() {
  if (sanitizer === "address") {
    return {
      ...process.env,
      ASAN_OPTIONS: process.env.ASAN_OPTIONS ?? "strict_string_checks=1",
    };
  }

  if (sanitizer === "undefined") {
    return {
      ...process.env,
      UBSAN_OPTIONS:
        process.env.UBSAN_OPTIONS ?? "halt_on_error=1:print_stacktrace=1",
    };
  }

  if (sanitizer === "thread") {
    return {
      ...process.env,
      TSAN_OPTIONS:
        process.env.TSAN_OPTIONS ?? "halt_on_error=1:second_deadlock_stack=1",
    };
  }

  return process.env;
}

function runCoverage(hybridOutputFile) {
  const hybridProfile = path.join(buildDir, "hybrid.profraw");
  const mergedProfile = path.join(buildDir, "coverage.profdata");
  const exportFile = path.join(buildDir, "coverage-summary.json");
  const profdata = resolveLlvmTool("llvm-profdata");
  const cov = resolveLlvmTool("llvm-cov");
  const sourceFiles = [
    path.join(cppDir, "core", "NativeStorageAdapter.hpp"),
    path.join(cppDir, "bindings", "HybridStorage.cpp"),
    path.join(cppDir, "bindings", "HybridStorage.hpp"),
  ];

  runCommand(hybridOutputFile, [], {
    env: { ...process.env, LLVM_PROFILE_FILE: hybridProfile },
  });

  runCommand(profdata, [
    "merge",
    "-sparse",
    hybridProfile,
    "-o",
    mergedProfile,
  ]);

  runCommand(cov, [
    "report",
    hybridOutputFile,
    `-instr-profile=${mergedProfile}`,
    ...sourceFiles,
  ]);
  const exportSummary = execFileSync(
    cov,
    [
      "export",
      hybridOutputFile,
      `-instr-profile=${mergedProfile}`,
      "-summary-only",
      ...sourceFiles,
    ],
    { encoding: "utf8" },
  );
  fs.writeFileSync(exportFile, exportSummary);

  const summary = JSON.parse(fs.readFileSync(exportFile, "utf8"));
  const totals = summary.data[0].totals;
  const thresholds = {
    lines: 90,
    functions: 90,
    regions: 85,
    branches: 85,
  };
  const actual = {
    lines: totals.lines.percent,
    functions: totals.functions.percent,
    regions: totals.regions.percent,
    branches: totals.branches.percent,
  };
  const failures = Object.entries(thresholds).filter(
    ([metric, threshold]) => actual[metric] < threshold,
  );

  if (failures.length > 0) {
    failures.forEach(([metric, threshold]) => {
      console.error(
        `❌ C++ ${metric} coverage ${actual[metric].toFixed(2)}% is below ${threshold}%`,
      );
    });
    process.exit(1);
  }

  console.log(
    `✅ C++ coverage passed: lines ${actual.lines.toFixed(2)}%, functions ${actual.functions.toFixed(2)}%, regions ${actual.regions.toFixed(2)}%, branches ${actual.branches.toFixed(2)}%`,
  );
}

try {
  const compileHybridArgs = [
    ...commonFlags,
    "-DNITRO_STORAGE_DISABLE_PLATFORM_ADAPTER",
    "-DNITRO_STORAGE_USE_ORDERED_MAP_FOR_TESTS",
    `-I${path.join(cppDir, "core")}`,
    `-I${path.join(cppDir, "bindings")}`,
    `-I${includeRoot}`,
    `-I${reactNativeJsiDir}`,
    `-I${path.join(__dirname, "..", "nitrogen", "generated", "shared", "c++")}`,
    hybridTestFile,
    hybridSourceFile,
    hybridSpecFile,
    "-o",
    hybridOutputFile,
    ...linkFlags,
  ];
  runCommand("clang++", compileHybridArgs);

  let iosAdapterOutputFile = null;
  if (process.platform === "darwin") {
    const iosAdapterTestFile = path.join(
      __dirname,
      "..",
      "ios",
      "IOSStorageAdapterTest.mm",
    );
    const iosAdapterSourceFile = path.join(
      __dirname,
      "..",
      "ios",
      "IOSStorageAdapterCpp.mm",
    );
    iosAdapterOutputFile = path.join(buildDir, "ios_adapter_test");
    const compileIosAdapterArgs = [
      ...commonFlags,
      "-fobjc-arc",
      "-DNITRO_STORAGE_TESTING",
      `-I${path.join(cppDir, "core")}`,
      `-I${path.join(__dirname, "..", "ios")}`,
      iosAdapterTestFile,
      iosAdapterSourceFile,
      "-framework",
      "Foundation",
      "-framework",
      "Security",
      "-framework",
      "LocalAuthentication",
      "-o",
      iosAdapterOutputFile,
      ...linkFlags,
    ];
    runCommand("clang++", compileIosAdapterArgs);
  }

  signDarwinBinary(hybridOutputFile);
  if (iosAdapterOutputFile) {
    signDarwinBinary(iosAdapterOutputFile);
  }

  console.log("✅ Compilation successful.");
  console.log("🚀 Running tests...");

  if (coverageEnabled) {
    runCoverage(hybridOutputFile);
    if (iosAdapterOutputFile) {
      runCommand(iosAdapterOutputFile, [], { env: sanitizerRuntimeEnv() });
    }
  } else {
    const sanitizerEnv = sanitizerRuntimeEnv();
    runCommand(hybridOutputFile, [], { env: sanitizerEnv });
    if (iosAdapterOutputFile) {
      runCommand(iosAdapterOutputFile, [], { env: sanitizerEnv });
    }
  }
  console.log("✅ C++ tests passed!");
} catch (error) {
  console.error("❌ C++ tests failed.");
  process.exit(1);
}
