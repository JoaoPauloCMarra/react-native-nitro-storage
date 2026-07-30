#!/usr/bin/env bun

import { Glob } from "bun";

const repositoryDirectory = `${import.meta.dir}/..`;
const generatedDirectory =
  `${repositoryDirectory}/packages/react-native-nitro-storage/nitrogen/generated`;

async function snapshotGeneratedFiles(): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const glob = new Glob("**/*");

  for await (const relativePath of glob.scan({
    cwd: generatedDirectory,
    onlyFiles: true,
  })) {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(
      await Bun.file(`${generatedDirectory}/${relativePath}`).arrayBuffer(),
    );
    snapshot.set(relativePath, hasher.digest("hex"));
  }

  return snapshot;
}

function snapshotsMatch(
  before: Map<string, string>,
  after: Map<string, string>,
): boolean {
  if (before.size !== after.size) {
    return false;
  }

  for (const [file, hash] of before) {
    if (after.get(file) !== hash) {
      return false;
    }
  }

  return true;
}

const before = await snapshotGeneratedFiles();
const codegen = Bun.spawn(["bun", "run", "codegen"], {
  cwd: repositoryDirectory,
  stdout: "inherit",
  stderr: "inherit",
});
const exitCode = await codegen.exited;

if (exitCode !== 0) {
  process.exit(exitCode);
}

const after = await snapshotGeneratedFiles();
if (!snapshotsMatch(before, after)) {
  console.error("Nitrogen output was stale. Commit regenerated files.");
  process.exit(1);
}

console.log("Nitrogen output is current.");
