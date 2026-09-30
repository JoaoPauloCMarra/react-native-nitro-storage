"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const {
  REGISTRY_RETRY_DELAYS_SECONDS,
  isRegistryNotFound,
  parsePublishArgs,
  verifyPublishedPackage,
} = require("./publish.js");

const notFound = {
  ok: false,
  output: "npm error code E404\nnpm error 404 Not Found",
};
const found = (version, gitHead) => ({
  ok: true,
  output: JSON.stringify({ version, gitHead }),
});

function sequenceView(results) {
  const calls = [];
  return {
    calls,
    view: (name, version) => {
      calls.push(`${name}@${version}`);
      return results[Math.min(calls.length - 1, results.length - 1)];
    },
  };
}

function recordingSleep() {
  const delays = [];
  return { delays, sleep: async (seconds) => delays.push(seconds) };
}

test("parses the space-separated tag form", () => {
  assert.equal(parsePublishArgs(["--tag", "next", "--yes"]).tag, "next");
});

test("parses the equals tag form", () => {
  assert.equal(parsePublishArgs(["--tag=next"]).tag, "next");
});

test("defaults the tag to latest", () => {
  assert.equal(parsePublishArgs([]).tag, "latest");
});

test("keeps the dry-run script flags working", () => {
  const options = parsePublishArgs(["--dry-run", "--skip-checks", "--yes"]);
  assert.equal(options.isDryRun, true);
  assert.equal(options.skipChecks, true);
  assert.equal(options.yes, true);
  assert.equal(options.tag, "latest");
});

test("accepts every documented flag", () => {
  const options = parsePublishArgs([
    "--",
    "--allow-dirty",
    "--skip-pack-preview",
    "--with-coverage",
    "--verify-npm-lifecycle",
    "--help",
  ]);
  assert.equal(options.allowDirty, true);
  assert.equal(options.skipPackPreview, true);
  assert.equal(options.withCoverage, true);
  assert.equal(options.verifyNpmLifecycle, true);
  assert.equal(options.help, true);
});

test("rejects unknown arguments", () => {
  assert.throws(() => parsePublishArgs(["--tags=next"]), /Unknown argument/);
  assert.throws(() => parsePublishArgs(["next"]), /Unknown argument/);
});

test("rejects a tag flag without a value", () => {
  assert.throws(() => parsePublishArgs(["--tag"]), /requires a value/);
  assert.throws(() => parsePublishArgs(["--tag", "--yes"]), /requires a value/);
  assert.throws(() => parsePublishArgs(["--tag="]), /requires a value/);
});

test("the CLI exits 1 on an unknown argument before any work", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "publish.js"), "--dry-run", "--bogus"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Unknown argument: --bogus/);
});

test("uses the publish workflow delay ladder", () => {
  assert.deepEqual(REGISTRY_RETRY_DELAYS_SECONDS, [10, 20, 40, 60, 60, 60]);
});

test("classifies registry not-found output", () => {
  assert.equal(isRegistryNotFound(notFound.output), true);
  assert.equal(isRegistryNotFound("npm error code ECONNRESET"), false);
});

test("retries E404 until the version appears", async () => {
  const registry = sequenceView([notFound, notFound, found("1.2.3", "abc")]);
  const clock = recordingSleep();
  const result = await verifyPublishedPackage("pkg", "1.2.3", "abc", {
    view: registry.view,
    sleep: clock.sleep,
  });
  assert.deepEqual(result, { version: "1.2.3", gitHead: "abc" });
  assert.equal(registry.calls.length, 3);
  assert.deepEqual(clock.delays, [10, 20]);
});

test("treats empty registry output as propagation delay", async () => {
  const registry = sequenceView([{ ok: true, output: "" }, found("1.2.3")]);
  const clock = recordingSleep();
  const result = await verifyPublishedPackage("pkg", "1.2.3", undefined, {
    view: registry.view,
    sleep: clock.sleep,
  });
  assert.equal(result.version, "1.2.3");
  assert.deepEqual(clock.delays, [10]);
});

test("fails after the delay ladder is exhausted", async () => {
  const registry = sequenceView([notFound]);
  const clock = recordingSleep();
  await assert.rejects(
    verifyPublishedPackage("pkg", "1.2.3", undefined, {
      view: registry.view,
      sleep: clock.sleep,
    }),
    /was not found on the registry after publish/,
  );
  assert.equal(registry.calls.length, 6);
  assert.deepEqual(clock.delays, [10, 20, 40, 60, 60]);
});

test("fails fast on a non-404 registry error", async () => {
  const registry = sequenceView([
    { ok: false, output: "npm error code ECONNRESET" },
  ]);
  const clock = recordingSleep();
  await assert.rejects(
    verifyPublishedPackage("pkg", "1.2.3", undefined, {
      view: registry.view,
      sleep: clock.sleep,
    }),
    /refusing to classify it as propagation delay/,
  );
  assert.equal(registry.calls.length, 1);
  assert.deepEqual(clock.delays, []);
});

test("rejects a gitHead mismatch", async () => {
  const registry = sequenceView([found("1.2.3", "other")]);
  await assert.rejects(
    verifyPublishedPackage("pkg", "1.2.3", "abc", {
      view: registry.view,
      sleep: async () => {},
    }),
    /does not match local commit abc/,
  );
});

test("rejects a version mismatch", async () => {
  const registry = sequenceView([found("1.2.2", "abc")]);
  await assert.rejects(
    verifyPublishedPackage("pkg", "1.2.3", "abc", {
      view: registry.view,
      sleep: async () => {},
    }),
    /does not match published version 1.2.3/,
  );
});
