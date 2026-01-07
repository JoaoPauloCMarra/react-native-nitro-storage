import React, { memo } from "react";
import { View, Text } from "react-native";
import { useState, useCallback } from "react";
import {
  createStorageItem,
  StorageScope,
  type StorageItem,
} from "react-native-nitro-storage";
import {
  Button,
  Page,
  Card,
  Colors,
  Badge,
  styles,
} from "../components/shared";

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

const ResultCard = memo(
  ({
    title,
    result,
    color,
    onRun,
    running,
    disabled,
  }: {
    title: string;
    result: BenchmarkResult | null;
    color: string;
    onRun: () => void;
    running: boolean;
    disabled: boolean;
  }) => (
    <Card
      title={title}
      subtitle={running ? "EXECUTING..." : "PERFORMANCE METRICS"}
      indicatorColor={color}
    >
      {result ? (
        <View style={{ gap: 8 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ color: Colors.muted, fontWeight: "600" }}>
              Write {result.ops} ops
            </Text>
            <Badge label={`${result.write.toFixed(2)}ms`} color={color} />
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ color: Colors.muted, fontWeight: "600" }}>
              Read {result.ops} ops
            </Text>
            <Badge label={`${result.read.toFixed(2)}ms`} color={color} />
          </View>
          <View
            style={{
              marginTop: 8,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: Colors.border,
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ color: Colors.text, fontWeight: "800" }}>
              AVG LATENCY
            </Text>
            <Text style={{ color, fontWeight: "900" }}>
              {((result.write + result.read) / (result.ops * 2)).toFixed(4)}ms
            </Text>
          </View>
        </View>
      ) : (
        <Text style={{ color: Colors.muted, fontStyle: "italic" }}>
          Ready for stress test...
        </Text>
      )}
      <Button
        title={running ? "Running..." : "Start Benchmark"}
        onPress={onRun}
        variant="ghost"
        disabled={disabled}
        style={{ marginTop: 12 }}
      />
    </Card>
  )
);

export default function BenchmarkScreen() {
  const [memoryResult, setMemoryResult] = useState<BenchmarkResult | null>(
    null
  );
  const [diskResult, setDiskResult] = useState<BenchmarkResult | null>(null);
  const [secureResult, setSecureResult] = useState<BenchmarkResult | null>(
    null
  );
  const [runningType, setRunningType] = useState<string | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);

  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const runBenchmark = useCallback(
    async (
      item: StorageItem<any>,
      setResult: (result: BenchmarkResult) => void,
      type: string
    ) => {
      setRunningType(type);
      await delay(150);

      const ops = 1_000;
      const data = JSON.stringify({ test: "data", timestamp: Date.now() });

      const writeStart = performance.now();
      for (let i = 0; i < ops; i++) {
        item.set(data);
      }
      const writeTime = performance.now() - writeStart;

      const readStart = performance.now();
      for (let i = 0; i < ops; i++) {
        item.get();
      }
      const readTime = performance.now() - readStart;

      setResult({ write: writeTime, read: readTime, ops });
      setRunningType(null);
    },
    []
  );

  const runAll = async () => {
    setIsRunningAll(true);
    setMemoryResult(null);
    setDiskResult(null);
    setSecureResult(null);
    await delay(300);

    await runBenchmark(memoryItem, setMemoryResult, "memory");
    await delay(200);
    await runBenchmark(diskItem, setDiskResult, "disk");
    await delay(200);
    await runBenchmark(secureItem, setSecureResult, "secure");
    setIsRunningAll(false);
  };

  const isAnyRunning = isRunningAll || !!runningType;

  return (
    <Page title="Benchmark" subtitle="JSI Speed Comparison">
      <Button
        title={isAnyRunning ? "Work in progress..." : "Stress Test All Scopes"}
        onPress={runAll}
        variant="primary"
        disabled={isAnyRunning}
        style={{ marginBottom: 24 }}
        size="lg"
      />

      <View style={{ gap: 8 }}>
        <ResultCard
          title="Memory Storage"
          result={memoryResult}
          color={Colors.memory}
          onRun={() => runBenchmark(memoryItem, setMemoryResult, "memory")}
          running={runningType === "memory"}
          disabled={isAnyRunning}
        />
        <ResultCard
          title="Disk Storage"
          result={diskResult}
          color={Colors.disk}
          onRun={() => runBenchmark(diskItem, setDiskResult, "disk")}
          running={runningType === "disk"}
          disabled={isAnyRunning}
        />
        <ResultCard
          title="Secure Storage"
          result={secureResult}
          color={Colors.secure}
          onRun={() => runBenchmark(secureItem, setSecureResult, "secure")}
          running={runningType === "secure"}
          disabled={isAnyRunning}
        />
      </View>
    </Page>
  );
}
