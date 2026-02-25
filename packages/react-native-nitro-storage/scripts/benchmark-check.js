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

function ensureLocalStorage() {
  if (typeof globalThis.localStorage !== "undefined") {
    return;
  }

  const store = new Map();
  const localStorageMock = {
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    get length() {
      return store.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
}

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
  memorySetOpsPerSecond: 2_000_000,
  // GitHub-hosted runners can dip below 8M due to noisy CPU allocation.
  memoryGetOpsPerSecond: 5_500_000,
  memoryBatchOpsPerSecond: 1_000_000,
  diskSetOpsPerSecond: 200_000,
  diskGetOpsPerSecond: 250_000,
  secureSetOpsPerSecond: 120_000,
  secureGetOpsPerSecond: 150_000,
};

ensureLocalStorage();
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

const diskCounter = createStorageItem({
  key: "__benchmark_disk_counter__",
  scope: StorageScope.Disk,
  defaultValue: 0,
});

const diskSetIterations = 25_000;
const diskSetMetric = measure("disk:set", diskSetIterations, () => {
  for (let index = 0; index < diskSetIterations; index += 1) {
    diskCounter.set(index);
  }
});

const diskGetIterations = 25_000;
const diskGetMetric = measure("disk:get", diskGetIterations, () => {
  for (let index = 0; index < diskGetIterations; index += 1) {
    diskCounter.get();
  }
});

const secureCounter = createStorageItem({
  key: "__benchmark_secure_counter__",
  scope: StorageScope.Secure,
  defaultValue: 0,
});

const secureSetIterations = 15_000;
const secureSetMetric = measure("secure:set", secureSetIterations, () => {
  for (let index = 0; index < secureSetIterations; index += 1) {
    secureCounter.set(index);
  }
});

const secureGetIterations = 15_000;
const secureGetMetric = measure("secure:get", secureGetIterations, () => {
  for (let index = 0; index < secureGetIterations; index += 1) {
    secureCounter.get();
  }
});

const metrics = [
  setMetric,
  getMetric,
  batchMetric,
  diskSetMetric,
  diskGetMetric,
  secureSetMetric,
  secureGetMetric,
];
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
if (diskSetMetric.opsPerSecond < thresholds.diskSetOpsPerSecond) {
  failures.push(
    `disk:set dropped below ${thresholds.diskSetOpsPerSecond.toLocaleString()} ops/s`
  );
}
if (diskGetMetric.opsPerSecond < thresholds.diskGetOpsPerSecond) {
  failures.push(
    `disk:get dropped below ${thresholds.diskGetOpsPerSecond.toLocaleString()} ops/s`
  );
}
if (secureSetMetric.opsPerSecond < thresholds.secureSetOpsPerSecond) {
  failures.push(
    `secure:set dropped below ${thresholds.secureSetOpsPerSecond.toLocaleString()} ops/s`
  );
}
if (secureGetMetric.opsPerSecond < thresholds.secureGetOpsPerSecond) {
  failures.push(
    `secure:get dropped below ${thresholds.secureGetOpsPerSecond.toLocaleString()} ops/s`
  );
}

storage.clearAll();

if (failures.length > 0) {
  console.error("Performance regression detected:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Benchmark thresholds passed.");
