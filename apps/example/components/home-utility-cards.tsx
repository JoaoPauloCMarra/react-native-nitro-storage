import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import {
  createStorageItem,
  flushWebStorageBackends,
  getBatch,
  getStorageErrorCode,
  getWebDiskStorageBackend,
  getWebSecureStorageBackend,
  removeBatch,
  setBatch,
  setWebDiskStorageBackend,
  setWebSecureStorageBackend,
  storage,
  StorageScope,
  type WebDiskStorageBackend,
  type WebSecureStorageBackend,
} from "react-native-nitro-storage";
import { isWebRuntime } from "./runtime";
import {
  Button,
  Card,
  CodeBlock,
  Colors,
  Section,
  StatusRow,
  describeStorageError,
  nowMs,
  styles,
} from "./shared";

const bufferedDiskItem = createStorageItem({
  key: "disk-buffered-item",
  scope: StorageScope.Disk,
  defaultValue: "",
  coalesceDiskWrites: true,
});

const benchmarkDiskItems = Array.from({ length: 24 }, (_, index) =>
  createStorageItem({
    key: `bench:disk:${index}`,
    scope: StorageScope.Disk,
    defaultValue: "",
  }),
);

const benchmarkSecureItems = Array.from({ length: 6 }, (_, index) =>
  createStorageItem({
    key: `bench:secure:${index}`,
    scope: StorageScope.Secure,
    defaultValue: "",
  }),
);

function readScopeSizes() {
  return {
    disk: storage.size(StorageScope.Disk),
    memory: storage.size(StorageScope.Memory),
  };
}

function useScopeSizes() {
  const [sizes, setSizes] = useState(readScopeSizes);

  useEffect(() => {
    let active = true;
    let pending = false;
    const schedule = () => {
      if (pending) {
        return;
      }
      pending = true;
      queueMicrotask(() => {
        pending = false;
        if (active) {
          setSizes(readScopeSizes());
        }
      });
    };
    const unsubscribers = [StorageScope.Memory, StorageScope.Disk].map(
      (scope) => storage.subscribe(scope, schedule),
    );
    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => {
        unsubscribe();
      });
    };
  }, []);

  return {
    ...sizes,
    refresh: () => {
      setSizes(readScopeSizes());
    },
  };
}

export function StorageUtilsCard() {
  const { disk, memory, refresh } = useScopeSizes();

  return (
    <Card title="Storage Utils" subtitle="Introspection and wipe">
      <Section title="Key counts">
        <StatusRow
          testID="util-disk-size"
          label="Disk size()"
          value={String(disk)}
        />
        <StatusRow
          testID="util-memory-size"
          label="Memory size()"
          value={String(memory)}
        />
      </Section>
      <Section title="Actions">
        <View style={styles.row}>
          <Button
            testID="util-wipe-memory"
            title="Wipe Memory"
            onPress={() => {
              storage.clear(StorageScope.Memory);
              refresh();
            }}
            variant="secondary"
            size="sm"
            style={styles.flex1}
          />
          <Button
            testID="util-wipe-disk"
            title="Wipe Disk"
            onPress={() => {
              storage.clear(StorageScope.Disk);
              refresh();
            }}
            variant="secondary"
            size="sm"
            style={styles.flex1}
          />
        </View>
        <Button
          testID="util-reset-all"
          title="Reset All"
          onPress={() => {
            storage.clearAll();
            refresh();
          }}
          variant="danger"
          size="sm"
        />
      </Section>
    </Card>
  );
}

export function ScopeControlCard() {
  const { disk, memory, refresh } = useScopeSizes();

  return (
    <Card
      title="Scope Control"
      subtitle="Key counts and clear"
      indicatorColor={Colors.danger}
    >
      <StatusRow
        testID="scope-disk-keys"
        label="Disk keys"
        value={String(disk)}
      />
      <StatusRow
        testID="scope-memory-keys"
        label="Memory keys"
        value={String(memory)}
      />
      <View style={styles.row}>
        <Button
          testID="scope-clear-disk"
          title="Clear Disk"
          onPress={() => {
            storage.clear(StorageScope.Disk);
            refresh();
          }}
          variant="secondary"
          size="sm"
          style={styles.flex1}
        />
        <Button
          testID="scope-clear-memory"
          title="Clear Memory"
          onPress={() => {
            storage.clear(StorageScope.Memory);
            refresh();
          }}
          variant="secondary"
          size="sm"
          style={styles.flex1}
        />
      </View>
      <Button
        testID="scope-reset-all"
        title="Reset All"
        onPress={() => {
          storage.clearAll();
          refresh();
        }}
        variant="danger"
        size="sm"
      />
    </Card>
  );
}

export function CapabilitiesCard() {
  const [classifiedErrorCode, setClassifiedErrorCode] = useState("(none)");
  const capabilities = storage.getCapabilities();
  const securityCapabilities = storage.getSecurityCapabilities();

  return (
    <Card
      title="Runtime Capabilities"
      subtitle="Backend metadata and structured error codes"
      indicatorColor={Colors.secure}
    >
      <StatusRow
        testID="capabilities-platform"
        label="Platform"
        value={capabilities.platform}
      />
      <StatusRow
        testID="capabilities-disk-backend"
        label="Disk backend"
        value={capabilities.backend.disk}
      />
      <StatusRow
        testID="capabilities-secure-backend"
        label="Secure backend"
        value={capabilities.backend.secure}
      />
      <StatusRow
        testID="capabilities-secure-encrypted"
        label="Secure encrypted"
        value={securityCapabilities.secureStorage.encrypted}
      />
      <StatusRow
        testID="capabilities-biometric-prompt"
        label="Biometric prompt"
        value={securityCapabilities.biometric.prompt}
      />
      <StatusRow
        testID="capabilities-buffering"
        label="Write buffering"
        value={`disk=${String(capabilities.writeBuffering.disk)} secure=${String(capabilities.writeBuffering.secure)}`}
      />
      <StatusRow
        testID="capabilities-error-code"
        label="Sample error code"
        value={classifiedErrorCode}
      />
      <Button
        testID="classify-storage-error"
        title="Classify Tagged Error"
        onPress={() => {
          setClassifiedErrorCode(
            getStorageErrorCode(
              new Error(
                "[nitro-error:authentication_required] NitroStorage: auth required",
              ),
            ) ?? "(none)",
          );
        }}
        size="sm"
      />
    </Card>
  );
}

type RuntimeBenchmarkResult = {
  label: string;
  operations: number;
  durationMs: number;
};

function measureRuntime(
  label: string,
  operations: number,
  run: () => void,
): RuntimeBenchmarkResult {
  const start = nowMs();
  run();
  return {
    label,
    operations,
    durationMs: nowMs() - start,
  };
}

function formatRuntimeBenchmarkResult(result: RuntimeBenchmarkResult) {
  const opsPerSecond =
    result.durationMs > 0
      ? Math.round((result.operations / result.durationMs) * 1000)
      : result.operations;

  return `${result.label}: ${result.operations} ops in ${result.durationMs.toFixed(2)} ms (${opsPerSecond.toLocaleString()} ops/s)`;
}

function runRuntimeBenchmark() {
  const memoryKeys = Array.from(
    { length: 64 },
    (_, index) => `bench:mem:${index}`,
  );
  const memoryResults: RuntimeBenchmarkResult[] = [];

  storage.resetMetrics();
  storage.setMetricsObserver(() => {});

  try {
    memoryResults.push(
      measureRuntime("memory set/get", 4_000, () => {
        for (let index = 0; index < 2_000; index += 1) {
          const key = memoryKeys[index % memoryKeys.length];
          storage.setString(key, `value-${index}`, StorageScope.Memory);
          storage.getString(key, StorageScope.Memory);
        }
      }),
    );

    memoryResults.push(
      measureRuntime("disk batch", 1_440, () => {
        for (let index = 0; index < 20; index += 1) {
          setBatch(
            benchmarkDiskItems.map((item, keyIndex) => ({
              item,
              value: `disk-${index}-${keyIndex}`,
            })),
            StorageScope.Disk,
          );
          getBatch(benchmarkDiskItems, StorageScope.Disk);
          removeBatch(benchmarkDiskItems, StorageScope.Disk);
        }
      }),
    );

    memoryResults.push(
      measureRuntime("secure batch", 72, () => {
        for (let index = 0; index < 4; index += 1) {
          setBatch(
            benchmarkSecureItems.map((item, keyIndex) => ({
              item,
              value: `secure-${index}-${keyIndex}`,
            })),
            StorageScope.Secure,
          );
          getBatch(benchmarkSecureItems, StorageScope.Secure);
          removeBatch(benchmarkSecureItems, StorageScope.Secure);
        }
      }),
    );

    const metrics = Object.values(storage.getMetricsSnapshot()).reduce(
      (summary, metric) => ({
        totalOperations: summary.totalOperations + metric.count,
        totalDurationMs: summary.totalDurationMs + metric.totalDurationMs,
      }),
      { totalOperations: 0, totalDurationMs: 0 },
    );
    const averageMetricMs =
      metrics.totalOperations > 0
        ? metrics.totalDurationMs / metrics.totalOperations
        : 0;
    return [
      ...memoryResults.map(formatRuntimeBenchmarkResult),
      `native metrics: ${metrics.totalOperations} ops, avg ${averageMetricMs.toFixed(3)} ms`,
    ].join("\n");
  } finally {
    storage.setMetricsObserver(undefined);
    memoryKeys.forEach((key) => {
      storage.deleteString(key, StorageScope.Memory);
    });
    removeBatch(benchmarkDiskItems, StorageScope.Disk);
    removeBatch(benchmarkSecureItems, StorageScope.Secure);
  }
}

export function RuntimeBenchmarkCard() {
  const [runtimeBenchmarkResult, setRuntimeBenchmarkResult] =
    useState("(not run)");

  return (
    <Card
      title="Runtime Benchmark"
      subtitle="Native memory, disk batch, and secure batch"
      indicatorColor={Colors.primary}
    >
      <Button
        testID="runtime-benchmark-run"
        title="Run Benchmark"
        onPress={() => {
          try {
            setRuntimeBenchmarkResult(runRuntimeBenchmark());
          } catch (error) {
            setRuntimeBenchmarkResult(
              `Benchmark failed: ${describeStorageError(error)}`,
            );
          }
        }}
      />
      <CodeBlock testID="runtime-benchmark-result">
        {runtimeBenchmarkResult}
      </CodeBlock>
    </Card>
  );
}

export function WebBackendCard() {
  const [webBackendStatus, setWebBackendStatus] = useState(
    isWebRuntime ? "default localStorage backends" : "native platform backends",
  );

  const installWebBackends = () => {
    if (!isWebRuntime) {
      setWebBackendStatus("native platforms ignore web backend overrides");
      return;
    }

    const diskStore = new Map<string, string>();
    const secureStore = new Map<string, string>();
    const createBackend = (
      name: string,
      store: Map<string, string>,
    ): WebDiskStorageBackend | WebSecureStorageBackend => ({
      name,
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      getAllKeys: () => Array.from(store.keys()),
      flush: async () => {},
    });

    const diskBackend = createBackend("example-web-disk", diskStore);
    const secureBackend = createBackend("example-web-secure", secureStore);
    setWebDiskStorageBackend(diskBackend);
    setWebSecureStorageBackend(secureBackend);
    storage.setString("web-backend-disk", "disk", StorageScope.Disk);
    storage.setString("web-backend-secure", "secure", StorageScope.Secure);
    void flushWebStorageBackends().then(() => {
      const diskName = getWebDiskStorageBackend()?.name ?? "none";
      const secureName = getWebSecureStorageBackend()?.name ?? "none";
      setWebBackendStatus(`${diskName} / ${secureName}`);
    });
  };

  const resetWebBackends = () => {
    setWebDiskStorageBackend(undefined);
    setWebSecureStorageBackend(undefined);
    setWebBackendStatus(
      isWebRuntime
        ? "default localStorage backends"
        : "native platform backends",
    );
  };

  return (
    <Card
      title="Web Backend Overrides"
      subtitle="custom disk and secure adapters on web"
      indicatorColor={Colors.disk}
    >
      <StatusRow
        testID="web-backend-platform"
        label="Platform"
        value={Platform.OS}
      />
      <StatusRow
        testID="web-backend-status"
        label="Backend"
        value={webBackendStatus}
      />
      <View style={styles.row}>
        <Button
          testID="web-backend-install"
          title="Install"
          onPress={installWebBackends}
          style={styles.flex1}
        />
        <Button
          testID="web-backend-reset"
          title="Reset"
          variant="secondary"
          onPress={resetWebBackends}
          style={styles.flex1}
        />
      </View>
    </Card>
  );
}

export function DiskBufferingCard() {
  const [diskBufferingEnabled, setDiskBufferingEnabled] = useState(false);
  const [diskBufferedPreview, setDiskBufferedPreview] = useState("(empty)");

  return (
    <Card
      title="Disk Write Buffering"
      subtitle="Buffered disk writes with explicit flush"
      indicatorColor={Colors.disk}
    >
      <StatusRow
        testID="disk-buffer-enabled"
        label="Global buffering"
        value={diskBufferingEnabled ? "enabled" : "disabled"}
      />
      <StatusRow
        testID="disk-buffer-preview"
        label="Buffered preview"
        value={diskBufferedPreview}
      />
      <View style={styles.row}>
        <Button
          testID="disk-buffer-toggle"
          title={diskBufferingEnabled ? "Disable" : "Enable"}
          onPress={() => {
            const next = !diskBufferingEnabled;
            storage.setDiskWritesAsync(next);
            setDiskBufferingEnabled(next);
          }}
          style={styles.flex1}
        />
        <Button
          testID="disk-buffer-raw"
          title="Queue Raw"
          variant="secondary"
          onPress={() => {
            storage.setString(
              "disk-buffer-raw",
              "buffered-raw",
              StorageScope.Disk,
            );
            setDiskBufferedPreview(
              storage.getString("disk-buffer-raw", StorageScope.Disk) ??
                "(empty)",
            );
          }}
          style={styles.flex1}
        />
      </View>
      <View style={styles.row}>
        <Button
          testID="disk-buffer-item"
          title="Queue Item"
          variant="secondary"
          onPress={() => {
            bufferedDiskItem.set("buffered-item");
            setDiskBufferedPreview(bufferedDiskItem.get() || "(empty)");
          }}
          style={styles.flex1}
        />
        <Button
          testID="disk-buffer-flush"
          title="Flush"
          onPress={() => {
            storage.flushDiskWrites();
            setDiskBufferedPreview(
              storage.getString("disk-buffer-raw", StorageScope.Disk) ??
                bufferedDiskItem.get() ??
                "(empty)",
            );
          }}
          style={styles.flex1}
        />
      </View>
    </Card>
  );
}
