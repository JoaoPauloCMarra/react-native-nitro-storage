const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");

const entries = [
  { source: "README.md", target: "README.md", type: "file" },
  { source: "LICENSE", target: "LICENSE", type: "file" },
  { source: "SECURITY.md", target: "SECURITY.md", type: "file" },
  { source: "docs", target: "docs", type: "directory" },
];

function removeTarget(target) {
  const targetPath = path.join(packageRoot, target);
  if (!fs.existsSync(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyEntry(entry) {
  const sourcePath = path.join(repoRoot, entry.source);
  const targetPath = path.join(packageRoot, entry.target);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `Required package artifact source is missing: ${entry.source}`,
    );
  }

  removeTarget(entry.target);

  if (entry.type === "directory") {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
    return;
  }

  fs.copyFileSync(sourcePath, targetPath);
}

function prepare() {
  entries.forEach(copyEntry);
}

function cleanup() {
  entries.forEach((entry) => removeTarget(entry.target));
}

const mode = process.argv[2];

try {
  if (mode === "prepare") {
    prepare();
  } else if (mode === "cleanup") {
    cleanup();
  } else {
    throw new Error(
      "Usage: node scripts/sync-package-docs.js <prepare|cleanup>",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
