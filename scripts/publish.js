#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

const projectRoot = path.resolve(__dirname, "..");
const packageDir = path.join(
  projectRoot,
  "packages/react-native-nitro-storage",
);
const packageJsonPath = path.join(packageDir, "package.json");
const packageFilter = "react-native-nitro-storage";
const packageDocsSyncScript = path.join(
  packageDir,
  "scripts/sync-package-docs.js",
);
const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const lifecycleFlags = [
  "prepublishOnly",
  "prepare",
  "prepack",
  "postpack",
  "publish",
  "postpublish",
];

function log(message, color = "green") {
  console.log(colors[color](message));
}

function execCommand(command, options = {}) {
  try {
    execSync(command, {
      stdio: "inherit",
      cwd: projectRoot,
      shell: true,
      ...options,
    });
    return true;
  } catch (error) {
    return false;
  }
}

function execCommandWithOutput(command, options = {}) {
  try {
    return execSync(command, {
      encoding: "utf-8",
      cwd: projectRoot,
      shell: true,
      ...options,
    }).trim();
  } catch (error) {
    return null;
  }
}

function formatDuration(startedAt) {
  const seconds = (Date.now() - startedAt) / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function validateNpmTag(tag) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(tag)) {
    log(`Invalid npm dist tag: ${tag}`, "red");
    process.exit(1);
  }

  if (/^v?\d+\.\d+\.\d+/.test(tag)) {
    log(
      `Invalid npm dist tag "${tag}": use a release channel like latest or next.`,
      "red",
    );
    process.exit(1);
  }
}

function isInteractive() {
  return process.stdin.isTTY && process.stdout.isTTY && !isCI;
}

function runCheck(label, command, options = {}) {
  log(label, "cyan");
  const startedAt = Date.now();
  const ok = execCommand(command, options);
  if (!ok) {
    log(`✗ ${label.replace(/[^\w]+$/g, "")} failed`, "red");
    process.exit(1);
  }
  console.log(`  ✓ completed in ${formatDuration(startedAt)}`);
  console.log("");
}

function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function getPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  return packageJson.version;
}

function getGitStatus() {
  const status = execCommandWithOutput("git status --porcelain", {
    cwd: packageDir,
  });
  if (status === null || status === "") {
    return [];
  }
  return status.split("\n").filter(Boolean);
}

function checkNpmAuth() {
  const whoami = execCommandWithOutput("npm whoami 2>/dev/null");
  return whoami !== null && whoami !== "";
}

function cleanupPackageDocs() {
  if (!fs.existsSync(packageDocsSyncScript)) {
    return;
  }

  execCommand(`node ${shellQuote(packageDocsSyncScript)} cleanup`, {
    cwd: packageDir,
  });
}

function preparePackageDocs() {
  if (!fs.existsSync(packageDocsSyncScript)) {
    return true;
  }

  return execCommand(`node ${shellQuote(packageDocsSyncScript)} prepare`, {
    cwd: packageDir,
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function getFirstChangelogVersion() {
  const changelogPath = path.join(projectRoot, "CHANGELOG.md");
  const changelog = fs.readFileSync(changelogPath, "utf-8");
  return changelog.match(/^##\s+([^\s]+)/m)?.[1] ?? null;
}

function assertReleaseDocs(version) {
  const packageJson = readJson(packageJsonPath);
  const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf-8");
  const changelogVersion = getFirstChangelogVersion();
  const nitroPeer = packageJson.peerDependencies?.["react-native-nitro-modules"];

  const failures = [];
  if (changelogVersion !== version) {
    failures.push(
      `CHANGELOG.md top entry is ${changelogVersion ?? "missing"}, expected ${version}`,
    );
  }

  if (!readme.includes(`react-native-nitro-modules ${nitroPeer}`)) {
    failures.push(
      `README.md peer dependency list does not mention react-native-nitro-modules ${nitroPeer}`,
    );
  }

  if (
    !readme.includes("storage.export") ||
    !readme.includes("subscribeNamespace")
  ) {
    failures.push("README.md is missing 0.5.1 export/event API examples");
  }

  if (failures.length > 0) {
    failures.forEach((failure) => log(`✗ ${failure}`, "red"));
    process.exit(1);
  }
}

function formatGitStatus(statusLines) {
  const preview = statusLines.slice(0, 10).join("\n");
  const remainder =
    statusLines.length > 10
      ? `\n...and ${statusLines.length - 10} more changed path(s)`
      : "";
  return `${preview}${remainder}`;
}

async function confirmOrExit({
  shouldSkip,
  question,
  onSkipMessage,
  onDeclineMessage,
}) {
  if (shouldSkip) {
    if (onSkipMessage) {
      console.log(onSkipMessage);
    }
    return;
  }

  if (!isInteractive()) {
    log(`${onDeclineMessage} Re-run with --yes if this is intentional.`, "red");
    process.exit(1);
  }

  const answer = await askQuestion(question);
  if (answer !== "y" && answer !== "yes") {
    log(onDeclineMessage, "red");
    process.exit(1);
  }
}

function getPackSummary() {
  const output = execCommandWithOutput("npm pack --dry-run --json", {
    cwd: packageDir,
  });
  if (!output) {
    return null;
  }

  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (_error) {
    return null;
  }
}

function printPackSummary(packSummary) {
  const packageSize = packSummary.packageSize ?? packSummary.size;
  console.log(
    `  • tarball: ${packSummary.filename} (${formatBytes(packageSize)})`,
  );
  console.log(
    `  • unpacked: ${formatBytes(packSummary.unpackedSize)}, files: ${packSummary.files?.length ?? "?"}`,
  );
}

function formatBytes(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "unknown";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} kB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const args = process.argv.slice(2);
  const argSet = new Set(args);
  if (argSet.has("--help")) {
    console.log(`Usage: bun run publish-package[:dry] -- [options]

Options:
  --dry-run                 Run npm publish in dry-run mode.
  --yes                     Skip interactive confirmations.
  --allow-dirty             Allow uncommitted changes.
  --skip-checks             Skip git/auth preflight only.
  --skip-pack-preview       Skip the npm pack summary preview.
  --with-coverage           Run JS/TS and C++ coverage gates before packaging.
  --verify-npm-lifecycle    Dry-run npm publish with lifecycle scripts enabled.
  --tag=<tag>               npm dist tag, default latest.
`);
    return;
  }

  const isDryRun = args.includes("--dry-run");
  const skipChecks = args.includes("--skip-checks");
  const yes = args.includes("--yes");
  const allowDirty = args.includes("--allow-dirty");
  const skipPackPreview = args.includes("--skip-pack-preview");
  const withCoverage = args.includes("--with-coverage");
  const verifyNpmLifecycle = args.includes("--verify-npm-lifecycle");
  const tag =
    args.find((arg) => arg.startsWith("--tag="))?.split("=")[1] || "latest";
  validateNpmTag(tag);

  console.log("");
  log("📦 Publishing react-native-nitro-storage", "bold");
  console.log("");

  const version = getPackageVersion();
  cleanupPackageDocs();
  assertReleaseDocs(version);

  log(`Version: ${version}`, "cyan");
  log(`Tag: ${tag}`, "cyan");
  if (isDryRun) {
    log("Mode: DRY RUN (no actual publish)", "yellow");
  }
  console.log("");

  if (!skipChecks) {
    log("Running pre-publish checks...", "cyan");

    const gitStatus = getGitStatus();
    if (gitStatus.length > 0) {
      log("⚠️  Warning: You have uncommitted changes", "yellow");
      console.log(formatGitStatus(gitStatus));
      await confirmOrExit({
        shouldSkip: allowDirty || yes,
        question: "Continue anyway? (y/n): ",
        onSkipMessage: "  ✓ Dirty tree override enabled",
        onDeclineMessage: "Publish cancelled",
      });
    } else {
      console.log("  ✓ Git working directory is clean");
    }

    if (isDryRun) {
      console.log("  ✓ Skipping npm auth check in dry-run mode");
    } else if (!checkNpmAuth()) {
      log("✗ Not logged in to npm. Run: npm login", "red");
      process.exit(1);
    } else {
      const npmUser = execCommandWithOutput("npm whoami");
      console.log(`  ✓ Logged in to npm as: ${npmUser}`);
    }

    console.log("");
  }

  runCheck("🧹 Running lint...", `bun run lint -- --filter=${packageFilter}`, {
    cwd: projectRoot,
  });
  runCheck(
    "🎨 Running format check...",
    `bun run format:check -- --filter=${packageFilter}`,
    { cwd: projectRoot },
  );
  runCheck(
    "📝 Running typecheck...",
    `bun run typecheck -- --filter=${packageFilter}`,
    { cwd: projectRoot },
  );
  runCheck(
    "🔎 Running type-surface checks...",
    `bun run test:types -- --filter=${packageFilter}`,
    { cwd: projectRoot },
  );
  runCheck(
    "🧪 Running unit tests...",
    `bun run test -- --filter=${packageFilter}`,
    { cwd: projectRoot },
  );
  runCheck(
    "🧪 Running C++ tests...",
    `bun run test:cpp -- --filter=${packageFilter}`,
    { cwd: projectRoot },
  );
  if (withCoverage) {
    runCheck(
      "📊 Running JS/TS coverage gate...",
      `bun run test:coverage -- --filter=${packageFilter}`,
      { cwd: projectRoot },
    );
    runCheck(
      "📊 Running C++ coverage gate...",
      `bun run test:cpp:coverage -- --filter=${packageFilter}`,
      { cwd: projectRoot },
    );
  }
  runCheck(
    "🏗️ Preparing package artifacts...",
    [
      "bun run clean",
      "bun run codegen",
      "bun run build",
      "bun run test:types",
      "bun run benchmark",
      "bun run test:cpp",
      "bun run check:pack",
    ].join(" && "),
    { cwd: packageDir },
  );

  if (!skipPackPreview) {
    log("📋 npm pack dry-run:", "cyan");
    const packSummary = getPackSummary();
    if (!packSummary) {
      log("✗ npm pack dry-run failed", "red");
      process.exit(1);
    }
    printPackSummary(packSummary);
    console.log("");
  }

  if (!isDryRun) {
    await confirmOrExit({
      shouldSkip: yes,
      question: `Publish version ${version} to npm with tag "${tag}"? (y/n): `,
      onSkipMessage: "  ✓ Publish confirmation skipped via --yes",
      onDeclineMessage: "Publish cancelled",
    });
    console.log("");
  }

  if (isDryRun) {
    log("🏃 Running npm publish dry-run...", "cyan");
    const lifecycleFlag = verifyNpmLifecycle ? "" : " --ignore-scripts";
    if (!verifyNpmLifecycle) {
      if (!preparePackageDocs()) {
        log("✗ Failed to prepare package docs", "red");
        cleanupPackageDocs();
        process.exit(1);
      }
    }
    const dryPublishCommand = `npm publish --dry-run${lifecycleFlag} --tag ${shellQuote(tag)} --access public`;
    const ok = execCommand(dryPublishCommand, { cwd: packageDir });
    cleanupPackageDocs();
    if (!ok) {
      log("✗ npm publish dry-run failed", "red");
      process.exit(1);
    }
    console.log("");
    log("✅ Dry run complete. Package is ready to publish.", "green");
    if (!verifyNpmLifecycle) {
      console.log(
        [
          "  ✓ npm lifecycle scripts were skipped during dry-run after local",
          "artifact checks prepared package docs and covered:",
          lifecycleFlags.join(", "),
        ].join(" "),
      );
    }
    log(
      `Run without --dry-run${yes ? "" : " --yes"} to publish version ${version}`,
      "cyan",
    );
  } else {
    log("🚀 Publishing to npm...", "cyan");
    const publishCommand = `npm publish --tag ${shellQuote(tag)} --access public${isCI ? " --provenance" : ""}`;
    if (!execCommand(publishCommand, { cwd: packageDir })) {
      log("✗ Publish failed", "red");
      cleanupPackageDocs();
      process.exit(1);
    }
    cleanupPackageDocs();
    console.log("");
    log(
      `✅ Successfully published react-native-nitro-storage@${version}`,
      "green",
    );
    log(`   https://www.npmjs.com/package/react-native-nitro-storage`, "cyan");
  }

  console.log("");
}

main().catch((error) => {
  log(`Publish failed: ${error.message}`, "red");
  process.exit(1);
});
