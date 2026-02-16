import { memo, useCallback, useState } from "react";
import { View, Text } from "react-native";
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
  StatusRow,
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
  }: {
    title: string;
    result: BenchResult | null;
    color: string;
    onRun: () => void;
    running: boolean;
    disabled: boolean;
  }) => (
    <Card
      title={title}
      subtitle={running ? "RUNNING..." : "LATENCY METRICS"}
      indicatorColor={color}
    >
      {result ? (
        <View style={{ gap: 6 }}>
          <StatusRow
            label={`Write ${result.ops} ops`}
            value={`${result.write.toFixed(2)}ms`}
            color={color}
          />
          <StatusRow
            label={`Read ${result.ops} ops`}
            value={`${result.read.toFixed(2)}ms`}
            color={color}
          />
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 6,
              paddingTop: 10,
              borderTopWidth: 1,
              borderTopColor: Colors.border,
            }}
          >
            <Text
              style={{ color: Colors.text, fontWeight: "800", fontSize: 12 }}
            >
              AVG LATENCY
            </Text>
            <Badge
              label={`${((result.write + result.read) / (result.ops * 2)).toFixed(4)}ms`}
              color={color}
            />
          </View>
        </View>
      ) : (
        <Text style={{ color: Colors.muted, fontStyle: "italic" }}>Ready…</Text>
      )}
      <Button
        title={running ? "Running…" : "Start"}
        onPress={onRun}
        variant="ghost"
        disabled={disabled}
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

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const bench = useCallback(
    async (
      item: StorageItem<string>,
      set: (r: BenchResult) => void,
      type: string,
    ) => {
      setRunningType(type);
      await delay(120);
      const ops = 1_000;
      const data = JSON.stringify({ test: "data", ts: Date.now() });
      const ws = performance.now();
      for (let i = 0; i < ops; i++) item.set(data);
      const wt = performance.now() - ws;
      const rs = performance.now();
      for (let i = 0; i < ops; i++) item.get();
      const rt = performance.now() - rs;
      set({ write: wt, read: rt, ops });
      setRunningType(null);
    },
    [],
  );

  const stressAll = async () => {
    setRunAll(true);
    setMemResult(null);
    setDiskResult(null);
    setSecResult(null);
    await delay(250);
    await bench(memoryItem, setMemResult, "mem");
    await delay(150);
    await bench(diskItem, setDiskResult, "disk");
    await delay(150);
    await bench(secureItem, setSecResult, "sec");
    setRunAll(false);
  };

  const busy = runAll || !!runningType;

  return (
    <Page title="Benchmark" subtitle="JSI performance stress test">
      <Text style={{ color: Colors.muted, fontSize: 13, marginBottom: 4 }}>
        1,000 sequential read/write ops per scope. Measures raw JSI throughput.
      </Text>
      <Button
        title={busy ? "Running…" : "Stress Test All Scopes"}
        onPress={stressAll}
        disabled={busy}
        size="lg"
        style={{ marginBottom: 8 }}
      />

      <ResultCard
        title="Memory"
        result={memResult}
        color={Colors.memory}
        onRun={() => bench(memoryItem, setMemResult, "mem")}
        running={runningType === "mem"}
        disabled={busy}
      />
      <ResultCard
        title="Disk"
        result={diskResult}
        color={Colors.disk}
        onRun={() => bench(diskItem, setDiskResult, "disk")}
        running={runningType === "disk"}
        disabled={busy}
      />
      <ResultCard
        title="Secure"
        result={secResult}
        color={Colors.secure}
        onRun={() => bench(secureItem, setSecResult, "sec")}
        running={runningType === "sec"}
        disabled={busy}
      />
    </Page>
  );
}
