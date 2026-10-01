const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

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
const hybridFailureTestFile = path.join(
  cppDir,
  "bindings",
  "HybridStorageFailureTest.cpp",
);
const hybridFailureOutputFile = path.join(
  buildDir,
  "hybrid_storage_failure_test",
);
const sqliteStoreSource = path.join(cppDir, "core", "SqliteDiskStore.cpp");
const iosAdapterSourceFile = path.join(
  __dirname,
  "..",
  "ios",
  "IOSStorageAdapterCpp.mm",
);
const SQLITE_THRESHOLDS = {
  lines: 90,
  functions: 90,
  regions: 85,
  branches: 80,
};
const sqliteStoreTestFile = path.join(cppDir, "core", "SqliteDiskStoreTest.cpp");
const sqliteOutputFile = path.join(buildDir, "sqlite_disk_store_test");
const sqliteFailureTestFile = path.join(
  cppDir,
  "core",
  "SqliteDiskStoreFailureTest.cpp",
);
const sqliteFailureOutputFile = path.join(
  buildDir,
  "sqlite_disk_store_failure_test",
);

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

function runIosAdapterTest(binaryPath, baseEnv) {
  const isolatedHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "nitro-storage-ios-adapter-"),
  );
  try {
    runCommand(binaryPath, [], {
      env: {
        ...baseEnv,
        HOME: isolatedHome,
        CFFIXED_USER_HOME: isolatedHome,
        __CFPREFERENCES_AVOID_DAEMON: "1",
      },
    });
  } finally {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
}

function reportCoverage(cov, objects, profile, sourceFiles) {
  const objectArgs = objects.flatMap((object, index) =>
    index === 0 ? [object] : ["-object", object],
  );
  runCommand(cov, [
    "report",
    ...objectArgs,
    `-instr-profile=${profile}`,
    ...sourceFiles,
  ]);
  const exportSummary = execFileSync(
    cov,
    [
      "export",
      ...objectArgs,
      `-instr-profile=${profile}`,
      "-summary-only",
      ...sourceFiles,
    ],
    { encoding: "utf8" },
  );
  const totals = JSON.parse(exportSummary).data[0].totals;
  return {
    exportSummary,
    actual: {
      lines: totals.lines.percent,
      functions: totals.functions.percent,
      regions: totals.regions.percent,
      branches: totals.branches.percent,
    },
  };
}

function assertCoverage(label, actual, thresholds) {
  const failures = Object.entries(thresholds).filter(
    ([metric, threshold]) => actual[metric] < threshold,
  );

  if (failures.length > 0) {
    failures.forEach(([metric, threshold]) => {
      console.error(
        `❌ ${label} ${metric} coverage ${actual[metric].toFixed(2)}% is below ${threshold}%`,
      );
    });
    process.exit(1);
  }

  console.log(
    `✅ ${label} coverage passed: lines ${actual.lines.toFixed(2)}%, functions ${actual.functions.toFixed(2)}%, regions ${actual.regions.toFixed(2)}%, branches ${actual.branches.toFixed(2)}%`,
  );
}

function runCoverage(binaries) {
  const profdata = resolveLlvmTool("llvm-profdata");
  const cov = resolveLlvmTool("llvm-cov");

  binaries.forEach((binary) => {
    binary.profile = path.join(buildDir, `${binary.name}.profraw`);
    const env = { ...process.env, LLVM_PROFILE_FILE: binary.profile };
    if (binary.isolatedHome) {
      runIosAdapterTest(binary.output, env);
    } else {
      runCommand(binary.output, [], { env });
    }
  });

  const merge = (group, output) => {
    const members = binaries.filter((binary) => binary.groups.includes(group));
    runCommand(profdata, [
      "merge",
      "-sparse",
      ...members.map((binary) => binary.profile),
      "-o",
      output,
    ]);
    return members.map((binary) => binary.output);
  };

  const hybridProfile = path.join(buildDir, "coverage.profdata");
  const hybridObjects = merge("hybrid", hybridProfile);
  const hybrid = reportCoverage(cov, hybridObjects, hybridProfile, [
    path.join(cppDir, "core", "NativeStorageAdapter.hpp"),
    path.join(cppDir, "bindings", "HybridStorage.cpp"),
    path.join(cppDir, "bindings", "HybridStorage.hpp"),
  ]);
  fs.writeFileSync(
    path.join(buildDir, "coverage-summary.json"),
    hybrid.exportSummary,
  );
  assertCoverage("C++", hybrid.actual, {
    lines: 90,
    functions: 90,
    regions: 85,
    branches: 85,
  });

  const sqliteProfile = path.join(buildDir, "coverage-sqlite.profdata");
  const sqliteObjects = merge("sqlite", sqliteProfile);
  const sqlite = reportCoverage(cov, sqliteObjects, sqliteProfile, [
    sqliteStoreSource,
  ]);
  fs.writeFileSync(
    path.join(buildDir, "coverage-sqlite-summary.json"),
    sqlite.exportSummary,
  );
  assertCoverage("SqliteDiskStore", sqlite.actual, SQLITE_THRESHOLDS);

  const iosObjects = binaries.filter((binary) => binary.groups.includes("ios"));
  if (iosObjects.length > 0) {
    const iosProfile = path.join(buildDir, "coverage-ios.profdata");
    const ios = reportCoverage(cov, merge("ios", iosProfile), iosProfile, [
      iosAdapterSourceFile,
    ]);
    console.log(
      `ℹ️  IOSStorageAdapterCpp coverage (not gated): lines ${ios.actual.lines.toFixed(2)}%, branches ${ios.actual.branches.toFixed(2)}%`,
    );
  }
}

try {
  const hybridArgs = (testFile, outputFile) => [
    ...commonFlags,
    "-DNITRO_STORAGE_DISABLE_PLATFORM_ADAPTER",
    "-DNITRO_STORAGE_USE_ORDERED_MAP_FOR_TESTS",
    `-I${path.join(cppDir, "core")}`,
    `-I${path.join(cppDir, "bindings")}`,
    `-I${includeRoot}`,
    `-I${reactNativeJsiDir}`,
    `-I${path.join(__dirname, "..", "nitrogen", "generated", "shared", "c++")}`,
    testFile,
    hybridSourceFile,
    hybridSpecFile,
    "-o",
    outputFile,
    ...linkFlags,
  ];
  const sqliteArgs = (testFile, outputFile) => [
    ...commonFlags,
    `-I${path.join(cppDir, "core")}`,
    testFile,
    sqliteStoreSource,
    "-lsqlite3",
    "-o",
    outputFile,
    ...linkFlags,
  ];
  const iosAdapterArgs = (testFile, outputFile) => [
    ...commonFlags,
    "-fobjc-arc",
    "-DNITRO_STORAGE_TESTING",
    `-I${path.join(cppDir, "core")}`,
    `-I${path.join(__dirname, "..", "ios")}`,
    testFile,
    iosAdapterSourceFile,
    sqliteStoreSource,
    "-lsqlite3",
    "-framework",
    "Foundation",
    "-framework",
    "Security",
    "-framework",
    "LocalAuthentication",
    "-o",
    outputFile,
    ...linkFlags,
  ];

  const binaries = [
    {
      name: "hybrid",
      output: hybridOutputFile,
      args: hybridArgs(hybridTestFile, hybridOutputFile),
      groups: ["hybrid"],
    },
    {
      name: "hybrid-failure",
      output: hybridFailureOutputFile,
      args: hybridArgs(hybridFailureTestFile, hybridFailureOutputFile),
      groups: ["hybrid"],
    },
    {
      name: "sqlite",
      output: sqliteOutputFile,
      args: sqliteArgs(sqliteStoreTestFile, sqliteOutputFile),
      groups: ["sqlite"],
    },
    {
      name: "sqlite-failure",
      output: sqliteFailureOutputFile,
      args: sqliteArgs(sqliteFailureTestFile, sqliteFailureOutputFile),
      groups: ["sqlite"],
    },
  ];
  if (process.platform === "darwin") {
    const iosDir = path.join(__dirname, "..", "ios");
    const iosAdapterOutputFile = path.join(buildDir, "ios_adapter_test");
    const iosKeychainOutputFile = path.join(
      buildDir,
      "ios_adapter_keychain_test",
    );
    binaries.push(
      {
        name: "ios-adapter",
        output: iosAdapterOutputFile,
        args: iosAdapterArgs(
          path.join(iosDir, "IOSStorageAdapterTest.mm"),
          iosAdapterOutputFile,
        ),
        groups: ["ios"],
        isolatedHome: true,
      },
      {
        name: "ios-adapter-keychain",
        output: iosKeychainOutputFile,
        args: iosAdapterArgs(
          path.join(iosDir, "IOSStorageAdapterKeychainTest.mm"),
          iosKeychainOutputFile,
        ),
        groups: ["ios"],
        isolatedHome: true,
      },
    );
  }

  binaries.forEach((binary) => runCommand("clang++", binary.args));
  binaries.forEach((binary) => signDarwinBinary(binary.output));

  console.log("✅ Compilation successful.");
  console.log("🚀 Running tests...");

  if (coverageEnabled) {
    runCoverage(binaries);
  } else {
    const sanitizerEnv = sanitizerRuntimeEnv();
    binaries.forEach((binary) => {
      if (binary.isolatedHome) {
        runIosAdapterTest(binary.output, sanitizerEnv);
      } else {
        runCommand(binary.output, [], { env: sanitizerEnv });
      }
    });
  }
  console.log("✅ C++ tests passed!");
} catch (error) {
  console.error("❌ C++ tests failed.");
  process.exit(1);
}
