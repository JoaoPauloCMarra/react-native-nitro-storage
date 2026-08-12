const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");

const docsSyncScript = path.join(packageRoot, "scripts/sync-package-docs.js");

function runDocsSync(mode) {
  execFileSync(process.execPath, [docsSyncScript, mode], {
    cwd: packageRoot,
    stdio: "pipe",
  });
}

const requiredFiles = [
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "SECURITY.md",
  "app.plugin.js",
  ".watchmanconfig",
  "docs/api-reference.md",
  "docs/batch-transactions-migrations.md",
  "docs/benchmarks.md",
  "docs/mmkv-migration.md",
  "docs/react-hooks.md",
  "docs/recipes.md",
  "docs/secure-storage.md",
  "docs/web-backends.md",
  "nitro.json",
  "nitrogen/generated/shared/c++/HybridStorageSpec.hpp",
  "src/index.ts",
  "src/index.web.ts",
  "src/testing.ts",
  "cpp/bindings/HybridStorage.cpp",
  "cpp/core/NativeStorageAdapter.hpp",
  "ios/IOSStorageAdapterCpp.mm",
  "android/src/main/cpp/AndroidStorageAdapterCpp.cpp",
  "android/src/main/java/com/nitrostorage/AndroidStorageAdapter.kt",
  "lib/commonjs/index.js",
  "lib/module/index.js",
  "lib/typescript/index.d.ts",
  "lib/commonjs/testing.js",
  "lib/typescript/testing.d.ts",
  "lib/commonjs/indexeddb-backend.js",
  "lib/typescript/indexeddb-backend.d.ts",
];

const forbiddenPatterns = [
  /^src\/__tests__\//,
  /^scripts\//,
  /^cpp\/build\//,
  /^android\/build\//,
  /^android\/\.cxx\//,
  /^apps\/example\/(?:android|ios)\//,
  /(?:^|\/)\.env(?:\.|$)/,
  /(?:^|\/)npm-debug\.log$/,
  /(?:^|\/)yarn-error\.log$/,
  /(?:^|\/)bun(?:fig)?\.lockb$/,
  /(?:^|\/)[^/]*\.(?:jks|keystore|p8|p12|pem|mobileprovision)$/,
  /(?:^|\/)[^/]*\.tgz$/,
  /(?:^|\/)[^/]*Test\.cpp$/,
  /(?:^|\/)ios\/[^/]*Test\.mm$/,
];

function readPackFileList() {
  const output = execFileSync(
    "bun",
    ["pm", "pack", "--dry-run", "--ignore-scripts"],
    {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const files = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^packed\s+[\d.]+\s*[kKMG]?B\s+(.+)$/);
    if (match) {
      files.push(match[1]);
    }
  }
  return files;
}

let packFileList;
try {
  runDocsSync("prepare");
  try {
    packFileList = readPackFileList();
  } finally {
    runDocsSync("cleanup");
  }
} catch (error) {
  runDocsSync("cleanup");
  fail(
    `Failed to evaluate bun pack output. ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (!Array.isArray(packFileList) || packFileList.length === 0) {
  fail("bun pack output did not contain a file list.");
}

const packagedFiles = new Set(packFileList);

const missingRequiredFiles = requiredFiles.filter(
  (file) => !packagedFiles.has(file),
);
if (missingRequiredFiles.length > 0) {
  fail(`Missing required packed files: ${missingRequiredFiles.join(", ")}`);
}

const forbiddenFiles = packFileList.filter((file) =>
  forbiddenPatterns.some((pattern) => pattern.test(file)),
);
if (forbiddenFiles.length > 0) {
  fail(
    `Forbidden files were included in bun pack output: ${forbiddenFiles.join(", ")}`,
  );
}

console.log(
  `✅ pack content guard passed (${packFileList.length} files checked).`,
);
