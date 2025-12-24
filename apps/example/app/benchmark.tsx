import { ScrollView, View, Text } from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
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
  const [runningMemory, setRunningMemory] = useState(false);
  const [runningDisk, setRunningDisk] = useState(false);
  const [runningSecure, setRunningSecure] = useState(false);

  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const runBenchmark = async (
    item: typeof memoryItem,
    setResult: (result: BenchmarkResult) => void,
    setRunning: (running: boolean) => void
  ) => {
    setRunning(true);
    await delay(100);

    const ops = 1_000;
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
    setRunning(false);
  };

  const runAll = async () => {
    await runBenchmark(memoryItem, setMemoryResult, setRunningMemory);
    await delay(100);
    await runBenchmark(diskItem, setDiskResult, setRunningDisk);
    await delay(100);
    await runBenchmark(secureItem, setSecureResult, setRunningSecure);
  };

  const ResultCard = ({
    title,
    result,
    color,
    onRun,
    running,
  }: {
    title: string;
    result: BenchmarkResult | null;
    color: string;
    onRun: () => void;
    running: boolean;
  }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.indicator, { backgroundColor: color }]} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {result ? (
        <View style={{ marginTop: 8, gap: 4 }}>
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
              marginTop: 2,
              paddingTop: 4,
              borderTopWidth: 1,
              borderTopColor: "#E5E7EB",
            }}
          >
            <Text style={[styles.description, { fontWeight: "600" }]}>
              Avg per op:
            </Text>
            <Text style={[styles.description, { fontWeight: "600", color }]}>
              {((result.write + result.read) / (result.ops * 2)).toFixed(4)}ms
            </Text>
          </View>
        </View>
      ) : (
        <Text style={[styles.description, { marginTop: 6 }]}>
          Run benchmark to see results
        </Text>
      )}
      <Button
        title={running ? "Running..." : "Run"}
        onPress={onRun}
        variant="primary"
        disabled={running || runningMemory || runningDisk || runningSecure}
        style={{ marginTop: 8 }}
      />
    </View>
  );

  const isAnyRunning = runningMemory || runningDisk || runningSecure;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        overScrollMode="never"
      >
        <Button
          title={isAnyRunning ? "Benchmarking..." : "Run All Benchmarks"}
          onPress={runAll}
          variant="primary"
          disabled={isAnyRunning}
          style={{ marginBottom: 16 }}
        />
        <View style={{ gap: 8 }}>
          <ResultCard
            title="Memory Storage"
            result={memoryResult}
            color="#EAB308"
            onRun={() =>
              runBenchmark(memoryItem, setMemoryResult, setRunningMemory)
            }
            running={runningMemory}
          />
          <ResultCard
            title="Disk Storage"
            result={diskResult}
            color="#3B82F6"
            onRun={() => runBenchmark(diskItem, setDiskResult, setRunningDisk)}
            running={runningDisk}
          />
          <ResultCard
            title="Secure Storage"
            result={secureResult}
            color="#10B981"
            onRun={() =>
              runBenchmark(secureItem, setSecureResult, setRunningSecure)
            }
            running={runningSecure}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
