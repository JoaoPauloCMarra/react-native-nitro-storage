const path = require("path");
const fs = require("fs");
const { performance } = require("perf_hooks");

const packageRoot = path.join(__dirname, "..");
const packageManifest = require(path.join(packageRoot, "package.json"));
const entrypointPath = path.join(
  packageRoot,
  "lib",
  "commonjs",
  "index.web.js",
);

if (packageManifest.name !== "react-native-nitro-storage") {
  console.error(
    `Benchmark setup failed: expected react-native-nitro-storage, got ${packageManifest.name}.`,
  );
  process.exit(1);
}

if (!fs.existsSync(entrypointPath)) {
  console.error("Benchmark setup failed: build artifacts were not found.");
  console.error("Run `bun run build` before running `bun run benchmark`.");
  process.exit(1);
}

function createIsolatedLocalStorage() {
  const store = new Map();
  return {
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
}

Object.defineProperty(globalThis, "localStorage", {
  value: createIsolatedLocalStorage(),
  configurable: true,
  writable: true,
});

let storageModule;
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

console.log(`Benchmark package: ${packageManifest.name}@${packageManifest.version}`);
console.log(
  "Benchmark scope: isolated Node web adapter with a private in-memory localStorage implementation.",
);
console.log(
  "Disk/Secure labels below are web scopes backed by the same private adapter; they are not native storage measurements.",
);
console.log("");

function percentile(values, percentileValue) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function measureSamples(label, operations, run, samples = 7, warmup = 2) {
  for (let index = 0; index < warmup; index += 1) {
    run();
  }

  const durations = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    run();
    durations.push(performance.now() - start);
  }

  const totalMs = durations.reduce((sum, duration) => sum + duration, 0);
  const medianMs = percentile(durations, 0.5);
  return {
    label,
    operations,
    samples,
    warmup,
    meanMs: totalMs / samples,
    medianMs,
    p95Ms: percentile(durations, 0.95),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    opsPerSecond: operations / (medianMs / 1000),
  };
}

function printMetric(metric) {
  const roundedMs = metric.medianMs.toFixed(2);
  const roundedOps = Math.round(metric.opsPerSecond).toLocaleString();
  console.log(
    `${metric.label}: median=${roundedMs}ms p95=${metric.p95Ms.toFixed(2)}ms (${roundedOps} ops/s)`,
  );
}

const thresholds = {
  memorySetOpsPerSecond: 2_000_000,
  // GitHub-hosted runners have high CPU variance; keep threshold realistic.
  memoryGetOpsPerSecond: 4_000_000,
  memoryBatchOpsPerSecond: 1_000_000,
  diskSetOpsPerSecond: 200_000,
  diskGetOpsPerSecond: 250_000,
  secureSetOpsPerSecond: 120_000,
  secureGetOpsPerSecond: 150_000,
};

storage.clearAll();

const benchmarkNamespace = `__nitro_storage_benchmark_${process.pid}__`;
const benchmarkKey = (name) => `${benchmarkNamespace}${name}`;

const resetStorage = () => {
  storage.clearAll();
};

const memoryCounter = createStorageItem({
  key: benchmarkKey("memory_counter"),
  scope: StorageScope.Memory,
  defaultValue: 0,
});

const setIterations = 40_000;
resetStorage();
const setMetric = measureSamples("web:memory:set", setIterations, () => {
  for (let index = 0; index < setIterations; index += 1) {
    memoryCounter.set(index);
  }
});

const getIterations = 80_000;
resetStorage();
const getMetric = measureSamples("web:memory:get", getIterations, () => {
  for (let index = 0; index < getIterations; index += 1) {
    memoryCounter.get();
  }
});

const batchItems = Array.from({ length: 32 }, (_, index) =>
  createStorageItem({
    key: benchmarkKey(`batch_${index}`),
    scope: StorageScope.Memory,
    defaultValue: 0,
  }),
);
const batchPayload = batchItems.map((item, index) => ({
  item,
  value: index + 1,
}));
const batchIterations = 400;
const batchOperationsPerIteration = batchItems.length * 3;
resetStorage();
const batchMetric = measureSamples(
  "web:memory:batch-set-get-remove",
  batchIterations * batchOperationsPerIteration,
  () => {
    for (let iteration = 0; iteration < batchIterations; iteration += 1) {
      setBatch(batchPayload, StorageScope.Memory);
      getBatch(batchItems, StorageScope.Memory);
      removeBatch(batchItems, StorageScope.Memory);
    }
  },
);

const diskCounter = createStorageItem({
  key: benchmarkKey("disk_counter"),
  scope: StorageScope.Disk,
  defaultValue: 0,
});

const diskSetIterations = 25_000;
resetStorage();
const diskSetMetric = measureSamples("web:disk-scope:set", diskSetIterations, () => {
  for (let index = 0; index < diskSetIterations; index += 1) {
    diskCounter.set(index);
  }
});

const diskGetIterations = 25_000;
resetStorage();
const diskGetMetric = measureSamples("web:disk-scope:get", diskGetIterations, () => {
  for (let index = 0; index < diskGetIterations; index += 1) {
    diskCounter.get();
  }
});

const secureCounter = createStorageItem({
  key: benchmarkKey("secure_counter"),
  scope: StorageScope.Secure,
  defaultValue: 0,
});

const secureSetIterations = 15_000;
resetStorage();
const secureSetMetric = measureSamples(
  "web:secure-scope:set",
  secureSetIterations,
  () => {
    for (let index = 0; index < secureSetIterations; index += 1) {
      secureCounter.set(index);
    }
  },
);

const secureGetIterations = 15_000;
resetStorage();
const secureGetMetric = measureSamples(
  "web:secure-scope:get",
  secureGetIterations,
  () => {
    for (let index = 0; index < secureGetIterations; index += 1) {
      secureCounter.get();
    }
  },
);

const metrics = [
  setMetric,
  getMetric,
  batchMetric,
  diskSetMetric,
  diskGetMetric,
  secureSetMetric,
  secureGetMetric,
];
console.log("Web (localStorage) results:");
metrics.forEach(printMetric);

console.log(
  `BENCHMARK_RESULT ${JSON.stringify({
    package: packageManifest.name,
    version: packageManifest.version,
    benchmark: "web-storage",
    scope: "node-private-localStorage",
    native: false,
    metrics,
    runtime: process.version,
    platform: process.platform,
    architecture: process.arch,
  })}`,
);

const failures = [];
if (setMetric.opsPerSecond < thresholds.memorySetOpsPerSecond) {
  failures.push(
    `memory:set dropped below ${thresholds.memorySetOpsPerSecond.toLocaleString()} ops/s`,
  );
}
if (getMetric.opsPerSecond < thresholds.memoryGetOpsPerSecond) {
  failures.push(
    `memory:get dropped below ${thresholds.memoryGetOpsPerSecond.toLocaleString()} ops/s`,
  );
}
if (batchMetric.opsPerSecond < thresholds.memoryBatchOpsPerSecond) {
  failures.push(
    `memory:batch dropped below ${thresholds.memoryBatchOpsPerSecond.toLocaleString()} ops/s`,
  );
}
if (diskSetMetric.opsPerSecond < thresholds.diskSetOpsPerSecond) {
  failures.push(
    `disk:set dropped below ${thresholds.diskSetOpsPerSecond.toLocaleString()} ops/s`,
  );
}
if (diskGetMetric.opsPerSecond < thresholds.diskGetOpsPerSecond) {
  failures.push(
    `disk:get dropped below ${thresholds.diskGetOpsPerSecond.toLocaleString()} ops/s`,
  );
}
if (secureSetMetric.opsPerSecond < thresholds.secureSetOpsPerSecond) {
  failures.push(
    `secure:set dropped below ${thresholds.secureSetOpsPerSecond.toLocaleString()} ops/s`,
  );
}
if (secureGetMetric.opsPerSecond < thresholds.secureGetOpsPerSecond) {
  failures.push(
    `secure:get dropped below ${thresholds.secureGetOpsPerSecond.toLocaleString()} ops/s`,
  );
}

storage.clearAll();

if (failures.length > 0) {
  console.error("Performance regression detected:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Benchmark thresholds passed.");
