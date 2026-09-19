import { useEffect, useState } from "react";
import { View } from "react-native";
import { storage, StorageScope } from "react-native-nitro-storage";
import { Card, Page, StatusRow } from "../components/shared";

type StressReport = {
  fail: number;
  diskCount: number;
  secureCount: number;
  diskP50: number;
  diskP95: number;
  secureP50: number;
  secureP95: number;
  detail: string;
};

declare global {
  var __stressReport: StressReport | undefined;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index] ?? 0;
}

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function runScope(
  scope: StorageScope,
  count: number,
  prefix: string,
): number[] {
  const durations: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = `${prefix}${index}`;
    const started = nowMs();
    storage.setString(key, `v${index}`, scope);
    const value = storage.getString(key, scope);
    if (value !== `v${index}`) {
      throw new Error(`${StorageScope[scope]} mismatch at ${key}`);
    }
    durations.push(nowMs() - started);
  }
  for (let index = 0; index < count; index += 1) {
    storage.deleteString(`${prefix}${index}`, scope);
  }
  if (scope === StorageScope.Disk) {
    storage.flushDiskWrites();
  }
  if (scope === StorageScope.Secure) {
    storage.flushSecureWrites();
  }
  return durations;
}

function runStressSweep(): StressReport {
  try {
    const disk = runScope(StorageScope.Disk, 40, "__stress_disk_");
    const secure = runScope(StorageScope.Secure, 20, "__stress_secure_");
    const report: StressReport = {
      fail: 0,
      diskCount: disk.length,
      secureCount: secure.length,
      diskP50: percentile(disk, 50),
      diskP95: percentile(disk, 95),
      secureP50: percentile(secure, 50),
      secureP95: percentile(secure, 95),
      detail: "ok",
    };
    globalThis.__stressReport = report;
    return report;
  } catch (error) {
    const report: StressReport = {
      fail: 1,
      diskCount: 0,
      secureCount: 0,
      diskP50: 0,
      diskP95: 0,
      secureP50: 0,
      secureP95: 0,
      detail: error instanceof Error ? error.message : String(error),
    };
    globalThis.__stressReport = report;
    return report;
  }
}

export default function StressLabScreen() {
  const [report, setReport] = useState<StressReport | null>(null);

  useEffect(() => {
    setReport(runStressSweep());
  }, []);

  const summary = report
    ? `fail=${report.fail} disk=${report.diskCount} secure=${report.secureCount}`
    : "running";

  return (
    <View
      testID="e2e-stress-screen"
      style={{ flex: 1 }}
      accessibilityLabel="Stress lab"
    >
      <Page title="Stress lab" subtitle="Deep link nitrostorage://e2e-stress">
        <StatusRow testID="e2e-stress-ready" label="state" value="ready" />
        <StatusRow
          testID="e2e-stress-summary"
          label="summary"
          value={summary}
        />
        <Card title="Disk + Secure batches" subtitle="40 Disk / 20 Secure">
          <StatusRow
            label="disk p50/p95"
            value={
              report
                ? `${report.diskP50.toFixed(2)}/${report.diskP95.toFixed(2)}`
                : "—"
            }
          />
          <StatusRow
            label="secure p50/p95"
            value={
              report
                ? `${report.secureP50.toFixed(2)}/${report.secureP95.toFixed(2)}`
                : "—"
            }
          />
          <StatusRow
            testID="e2e-stress-detail"
            label="detail"
            value={report?.detail ?? "running"}
          />
        </Card>
      </Page>
    </View>
  );
}
