#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");
const { execCommand, log, projectRoot } = require("./cli-utils.js");

function commandExists(command) {
  try {
    const checkCommand =
      process.platform === "win32"
        ? `where ${command}`
        : `command -v ${command}`;
    execSync(checkCommand, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("");
  log("🚀 Setting up react-native-nitro-storage...");
  console.log("");

  if (!commandExists("bun")) {
    log("Bun not found. Please install bun first:", "yellow");
    log("  • macOS/Linux: curl -fsSL https://bun.sh/install | bash", "cyan");
    log('  • Windows: powershell -c "irm bun.sh/install.ps1 | iex"', "cyan");
    log("  • Or visit: https://bun.sh/docs/installation", "cyan");
    process.exit(1);
  }

  log("📦 Installing dependencies...");
  if (!execCommand("bun install")) {
    log("Failed to install dependencies", "red");
    process.exit(1);
  }

  log("⚡ Generating Nitro bindings...");
  const packageDir = path.join(
    projectRoot,
    "packages/react-native-nitro-storage"
  );
  if (!execCommand("bun run codegen", { cwd: packageDir })) {
    log("Failed to generate Nitro bindings", "red");
    process.exit(1);
  }

  log("🔨 Building library...");
  if (!execCommand("bun run build", { cwd: packageDir })) {
    log("Failed to build library", "red");
    process.exit(1);
  }

  console.log("");
  log("✅ Setup complete!");
  console.log("");
  console.log("Next steps:");
  console.log("  1. cd apps/example");
  console.log("  2. bun run prebuild");
  console.log("  3. bun run ios  # or bun run android");
  console.log("");
}

main().catch((error) => {
  log(`Setup failed: ${error.message}`, "red");
  process.exit(1);
});
