const path = require("path");
const fs = require("fs");
const { performance } = require("perf_hooks");

const packageRoot = path.join(__dirname, "..");
const entrypointPath = path.join(packageRoot, "lib", "commonjs", "index.web.js");

let storageModule;
if (!fs.existsSync(entrypointPath)) {
  console.error("Benchmark setup failed: build artifacts were not found.");
  console.error("Run `bun run build` before running `bun run benchmark`.");
  process.exit(1);
}

try {
  storageModule = require(entrypointPath);
} catch (error) {
  console.error("Benchmark setup failed: unable to load benchmark entrypoint.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const {
  createStorageItem,
  StorageScope,
  setBatch,
  getBatch,
  removeBatch,
  storage,
} = storageModule;

function measure(label, operations, run) {
  const start = performance.now();
  run();
  const durationMs = performance.now() - start;
  const opsPerSecond = operations / (durationMs / 1000);
  return { label, durationMs, opsPerSecond };
}

function printMetric(metric) {
  const roundedMs = metric.durationMs.toFixed(2);
  const roundedOps = Math.round(metric.opsPerSecond).toLocaleString();
  console.log(`${metric.label}: ${roundedMs}ms (${roundedOps} ops/s)`);
}

const thresholds = {
  memorySetOpsPerSecond: 20_000,
  memoryGetOpsPerSecond: 40_000,
  memoryBatchOpsPerSecond: 15_000,
};

storage.clearAll();

const memoryCounter = createStorageItem({
  key: "__benchmark_memory_counter__",
  scope: StorageScope.Memory,
  defaultValue: 0,
});

const setIterations = 40_000;
const setMetric = measure("memory:set", setIterations, () => {
  for (let index = 0; index < setIterations; index += 1) {
    memoryCounter.set(index);
  }
});

const getIterations = 80_000;
const getMetric = measure("memory:get", getIterations, () => {
  for (let index = 0; index < getIterations; index += 1) {
    memoryCounter.get();
  }
});

const batchItems = Array.from({ length: 32 }, (_, index) =>
  createStorageItem({
    key: `__benchmark_batch_${index}__`,
    scope: StorageScope.Memory,
    defaultValue: 0,
  })
);
const batchPayload = batchItems.map((item, index) => ({ item, value: index + 1 }));
const batchIterations = 400;
const batchOperationsPerIteration = batchItems.length * 3;
const batchMetric = measure(
  "memory:batch-set-get-remove",
  batchIterations * batchOperationsPerIteration,
  () => {
    for (let iteration = 0; iteration < batchIterations; iteration += 1) {
      setBatch(batchPayload, StorageScope.Memory);
      getBatch(batchItems, StorageScope.Memory);
      removeBatch(batchItems, StorageScope.Memory);
    }
  }
);

const metrics = [setMetric, getMetric, batchMetric];
metrics.forEach(printMetric);

const failures = [];
if (setMetric.opsPerSecond < thresholds.memorySetOpsPerSecond) {
  failures.push(
    `memory:set dropped below ${thresholds.memorySetOpsPerSecond.toLocaleString()} ops/s`
  );
}
if (getMetric.opsPerSecond < thresholds.memoryGetOpsPerSecond) {
  failures.push(
    `memory:get dropped below ${thresholds.memoryGetOpsPerSecond.toLocaleString()} ops/s`
  );
}
if (batchMetric.opsPerSecond < thresholds.memoryBatchOpsPerSecond) {
  failures.push(
    `memory:batch dropped below ${thresholds.memoryBatchOpsPerSecond.toLocaleString()} ops/s`
  );
}

storage.clearAll();

if (failures.length > 0) {
  console.error("Performance regression detected:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Benchmark thresholds passed.");
