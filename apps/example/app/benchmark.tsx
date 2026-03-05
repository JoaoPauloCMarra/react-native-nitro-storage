import { memo, useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  createStorageItem,
  StorageScope,
  type StorageItem,
} from "react-native-nitro-storage";
import {
  Badge,
  Button,
  Card,
  Colors,
  Page,
  StatusRow,
  styles,
} from "../components/shared";

const diskItem = createStorageItem({
  key: "bench-disk",
  scope: StorageScope.Disk,
  defaultValue: "",
});
const secureItem = createStorageItem({
  key: "bench-sec",
  scope: StorageScope.Secure,
  defaultValue: "",
});
const memoryItem = createStorageItem({
  key: "bench-mem",
  scope: StorageScope.Memory,
  defaultValue: "",
});

type BenchResult = {
  write: number;
  read: number;
  ops: number;
};

const ResultCard = memo(
  ({
    title,
    result,
    color,
    onRun,
    running,
    disabled,
    testID,
  }: {
    title: string;
    result: BenchResult | null;
    color: string;
    onRun: () => void;
    running: boolean;
    disabled: boolean;
    testID?: string;
  }) => (
    <Card
      title={title}
      subtitle={running ? "running" : "latency metrics"}
      indicatorColor={color}
    >
      {result ? (
        <View style={styles.panel}>
          <StatusRow
            label={`write ${result.ops} ops`}
            value={`${result.write.toFixed(2)}ms`}
            color={color}
            testID={testID ? `${testID}-write` : undefined}
          />
          <StatusRow
            label={`read ${result.ops} ops`}
            value={`${result.read.toFixed(2)}ms`}
            color={color}
            testID={testID ? `${testID}-read` : undefined}
          />
          <View style={s.avgRow}>
            <Text style={s.avgLabel}>avg latency</Text>
            <Badge
              label={`${((result.write + result.read) / (result.ops * 2)).toFixed(4)}ms`}
              color={color}
            />
          </View>
        </View>
      ) : (
        <Text style={styles.helperText}>Ready to run.</Text>
      )}

      <Button
        title={running ? "Running..." : "Run scope"}
        onPress={onRun}
        variant="ghost"
        disabled={disabled}
        testID={testID}
      />
    </Card>
  ),
);
ResultCard.displayName = "ResultCard";

export default function BenchmarkScreen() {
  const [memResult, setMemResult] = useState<BenchResult | null>(null);
  const [diskResult, setDiskResult] = useState<BenchResult | null>(null);
  const [secResult, setSecResult] = useState<BenchResult | null>(null);
  const [runningType, setRunningType] = useState<string | null>(null);
  const [runAll, setRunAll] = useState(false);

  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const bench = useCallback(
    async (
      item: StorageItem<string>,
      setResult: (result: BenchResult) => void,
      type: string,
    ) => {
      setRunningType(type);
      await delay(120);

      const ops = 1_000;
      const payload = JSON.stringify({ test: "data", ts: Date.now() });

      const writeStart = performance.now();
      for (let i = 0; i < ops; i += 1) {
        item.set(payload);
      }
      const writeDuration = performance.now() - writeStart;

      const readStart = performance.now();
      for (let i = 0; i < ops; i += 1) {
        item.get();
      }
      const readDuration = performance.now() - readStart;

      setResult({
        write: writeDuration,
        read: readDuration,
        ops,
      });
      setRunningType(null);
    },
    [],
  );

  const stressAll = async () => {
    setRunAll(true);
    setMemResult(null);
    setDiskResult(null);
    setSecResult(null);

    await delay(220);
    await bench(memoryItem, setMemResult, "mem");
    await delay(140);
    await bench(diskItem, setDiskResult, "disk");
    await delay(140);
    await bench(secureItem, setSecResult, "secure");

    setRunAll(false);
  };

  const busy = runAll || !!runningType;

  return (
    <Page
      title="Benchmark"
      subtitle="Quick JSI throughput check per storage scope"
    >
      <Card title="Run Profile" subtitle="1,000 sequential write + read ops">
        <Text style={styles.helperText}>
          This stress run compares memory, disk, and secure storage under equal
          synchronous load.
        </Text>
        <Button
          title={busy ? "Running..." : "Stress Test All Scopes"}
          onPress={() => {
            void stressAll();
          }}
          disabled={busy}
          size="lg"
          testID="bench-run-all"
        />
      </Card>

      <ResultCard
        title="Memory"
        result={memResult}
        color={Colors.memory}
        onRun={() => {
          void bench(memoryItem, setMemResult, "mem");
        }}
        running={runningType === "mem"}
        disabled={busy}
        testID="bench-run-memory"
      />

      <ResultCard
        title="Disk"
        result={diskResult}
        color={Colors.disk}
        onRun={() => {
          void bench(diskItem, setDiskResult, "disk");
        }}
        running={runningType === "disk"}
        disabled={busy}
        testID="bench-run-disk"
      />

      <ResultCard
        title="Secure"
        result={secResult}
        color={Colors.secure}
        onRun={() => {
          void bench(secureItem, setSecResult, "secure");
        }}
        running={runningType === "secure"}
        disabled={busy}
        testID="bench-run-secure"
      />
    </Page>
  );
}

const s = StyleSheet.create({
  avgRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 10,
    marginTop: 2,
  },
  avgLabel: {
    color: Colors.text,
    fontWeight: "800",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
