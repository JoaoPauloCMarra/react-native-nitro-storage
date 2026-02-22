const { execSync } = require("child_process");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

const requiredFiles = [
  "src/index.ts",
  "src/index.web.ts",
  "lib/commonjs/index.js",
  "lib/module/index.js",
  "lib/typescript/index.d.ts",
];

const forbiddenPatterns = [
  /^src\/__tests__\//,
  /^scripts\//,
  /(?:^|\/)[^/]*Test\.cpp$/,
];

let packMetadata;
try {
  const output = execSync("npm pack --dry-run --json", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output);
  packMetadata = Array.isArray(parsed) ? parsed[0] : parsed;
} catch (error) {
  fail(
    `Failed to evaluate npm pack output. ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (!packMetadata || !Array.isArray(packMetadata.files)) {
  fail("npm pack metadata does not contain a files list.");
}

const packagedFiles = new Set(packMetadata.files.map((file) => file.path));

const missingRequiredFiles = requiredFiles.filter((file) => !packagedFiles.has(file));
if (missingRequiredFiles.length > 0) {
  fail(`Missing required packed files: ${missingRequiredFiles.join(", ")}`);
}

const forbiddenFiles = Array.from(packagedFiles).filter((file) =>
  forbiddenPatterns.some((pattern) => pattern.test(file)),
);
if (forbiddenFiles.length > 0) {
  fail(`Forbidden files were included in npm pack output: ${forbiddenFiles.join(", ")}`);
}

console.log("✅ npm pack content guard passed.");
