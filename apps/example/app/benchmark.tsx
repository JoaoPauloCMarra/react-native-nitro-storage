import { ScrollView, View, Text } from "react-native";
import { useState } from "react";
import { createStorageItem, StorageScope } from "react-native-nitro-storage";
import { Button, styles } from "../components/shared";

const diskItem = createStorageItem({
  key: "benchmark-disk",
  scope: StorageScope.Disk,
  defaultValue: "",
});

const secureItem = createStorageItem({
  key: "benchmark-secure",
  scope: StorageScope.Secure,
  defaultValue: "",
});

const memoryItem = createStorageItem({
  key: "benchmark-memory",
  scope: StorageScope.Memory,
  defaultValue: "",
});

interface BenchmarkResult {
  write: number;
  read: number;
  ops: number;
}

export default function BenchmarkScreen() {
  const [memoryResult, setMemoryResult] = useState<BenchmarkResult | null>(
    null
  );
  const [diskResult, setDiskResult] = useState<BenchmarkResult | null>(null);
  const [secureResult, setSecureResult] = useState<BenchmarkResult | null>(
    null
  );
  const [running, setRunning] = useState(false);

  const runBenchmark = (
    item: typeof memoryItem,
    name: string,
    setResult: (result: BenchmarkResult) => void
  ) => {
    const ops = 1000;
    const data = JSON.stringify({ test: "data", timestamp: Date.now() });

    const writeStart = performance.now();
    for (let i = 0; i < ops; i++) {
      item.set(data);
    }
    const writeEnd = performance.now();
    const writeTime = writeEnd - writeStart;

    const readStart = performance.now();
    for (let i = 0; i < ops; i++) {
      item.get();
    }
    const readEnd = performance.now();
    const readTime = readEnd - readStart;

    setResult({
      write: writeTime,
      read: readTime,
      ops,
    });
  };

  const runAllBenchmarks = async () => {
    setRunning(true);
    setMemoryResult(null);
    setDiskResult(null);
    setSecureResult(null);

    await new Promise((resolve) => setTimeout(resolve, 100));
    runBenchmark(memoryItem, "Memory", setMemoryResult);

    await new Promise((resolve) => setTimeout(resolve, 100));
    runBenchmark(diskItem, "Disk", setDiskResult);

    await new Promise((resolve) => setTimeout(resolve, 100));
    runBenchmark(secureItem, "Secure", setSecureResult);

    setRunning(false);
  };

  const ResultCard = ({
    title,
    result,
    color,
  }: {
    title: string;
    result: BenchmarkResult | null;
    color: string;
  }) => (
    <View style={[styles.card, { opacity: result ? 1 : 0.5 }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.indicator, { backgroundColor: color }]} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {result ? (
        <>
          <View style={{ marginTop: 12, gap: 8 }}>
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Text style={styles.description}>Write {result.ops} ops:</Text>
              <Text style={[styles.description, { fontWeight: "600" }]}>
                {result.write.toFixed(2)}ms
              </Text>
            </View>
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Text style={styles.description}>Read {result.ops} ops:</Text>
              <Text style={[styles.description, { fontWeight: "600" }]}>
                {result.read.toFixed(2)}ms
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 4,
                paddingTop: 8,
                borderTopWidth: 1,
                borderTopColor: "#E5E7EB",
              }}
            >
              <Text style={[styles.description, { fontWeight: "600" }]}>
                Avg per op:
              </Text>
              <Text style={[styles.description, { fontWeight: "600", color }]}>
                {((result.write + result.read) / (result.ops * 2)).toFixed(3)}ms
              </Text>
            </View>
          </View>
        </>
      ) : (
        <Text style={[styles.description, { marginTop: 8 }]}>
          Run benchmark to see results
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={{ gap: 4 }}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Performance Benchmark</Text>
            <Text style={styles.description}>
              Measures read/write performance for 1,000 operations per storage
              type.
            </Text>
            <Button
              title={running ? "Running..." : "Run Benchmark"}
              onPress={runAllBenchmarks}
              variant="primary"
              disabled={running}
              style={{ marginTop: 16 }}
            />
          </View>

          <ResultCard
            title="Memory Storage"
            result={memoryResult}
            color="#EAB308"
          />
          <ResultCard
            title="Disk Storage"
            result={diskResult}
            color="#3B82F6"
          />
          <ResultCard
            title="Secure Storage"
            result={secureResult}
            color="#10B981"
          />
        </View>
      </ScrollView>
    </View>
  );
}
