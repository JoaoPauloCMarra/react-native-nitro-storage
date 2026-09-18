import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  createStorageItem,
  runTransaction,
  storage,
  StorageScope,
} from "react-native-nitro-storage";
import { Card, Page, StatusRow } from "../components/shared";

type CaseStatus = "pass" | "fail" | "skip";
type LabCase = {
  name: string;
  status: CaseStatus;
  detail?: string;
};

type IntegrityReport = {
  fail: number;
  pass: number;
  skip: number;
  cases: LabCase[];
};

declare global {
  var __integrityReport: IntegrityReport | undefined;
}

function runCase(name: string, fn: () => string | void): LabCase {
  try {
    const detail = fn();
    return { name, status: "pass", detail: detail ?? "ok" };
  } catch (error) {
    return {
      name,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runIntegritySweep(): IntegrityReport {
  const persistKey = "__integrity_disk_persist__";
  const previousPersist = storage.getString(persistKey, StorageScope.Disk);
  const cases: LabCase[] = [
    runCase("disk-write-read", () => {
      const item = createStorageItem({
        key: "__integrity_disk__",
        scope: StorageScope.Disk,
        defaultValue: "",
      });
      item.set("disk-ok");
      assert(item.get() === "disk-ok", `got ${item.get()}`);
      assert(
        storage.getString("__integrity_disk__", StorageScope.Disk) ===
          "disk-ok",
        "raw disk mismatch",
      );
      item.delete();
    }),
    runCase("secure-write-read", () => {
      const item = createStorageItem({
        key: "__integrity_secure__",
        scope: StorageScope.Secure,
        defaultValue: "",
      });
      item.set("secure-ok");
      assert(item.get() === "secure-ok", `got ${item.get()}`);
      item.delete();
    }),
    runCase("import-then-flush", () => {
      storage.import({ __integrity_import__: "imported" }, StorageScope.Disk);
      storage.flushDiskWrites();
      assert(
        storage.getString("__integrity_import__", StorageScope.Disk) ===
          "imported",
        "import missing after flush",
      );
      storage.deleteString("__integrity_import__", StorageScope.Disk);
      storage.flushDiskWrites();
    }),
    runCase("tx-rollback", () => {
      const item = createStorageItem({
        key: "__integrity_tx__",
        scope: StorageScope.Disk,
        defaultValue: "",
      });
      item.set("committed");
      let rolledBack = false;
      try {
        runTransaction(StorageScope.Disk, (tx) => {
          tx.setItem(item, "should-rollback");
          throw new Error("rollback");
        });
      } catch {
        rolledBack = true;
      }
      assert(rolledBack, "expected throw");
      assert(item.get() === "committed", `got ${item.get()}`);
      item.delete();
    }),
    runCase("renameFrom", () => {
      storage.setString(
        "e2e-integrity-legacy",
        "migrated-value",
        StorageScope.Disk,
      );
      const renamed = createStorageItem({
        key: "e2e-integrity-renamed",
        scope: StorageScope.Disk,
        defaultValue: "",
        renameFrom: "e2e-integrity-legacy",
      });
      assert(renamed.get() === "migrated-value", `got ${renamed.get()}`);
      renamed.delete();
      storage.deleteString("e2e-integrity-legacy", StorageScope.Disk);
    }),
    runCase("namespace-isolation", () => {
      const namespaced = createStorageItem({
        key: "pref",
        namespace: "integrity",
        scope: StorageScope.Disk,
        defaultValue: "",
      });
      namespaced.set("ns-ok");
      assert(
        storage.getString("integrity:pref", StorageScope.Disk) === "ns-ok",
        "namespaced key missing",
      );
      assert(
        storage.getString("pref", StorageScope.Disk) !== "ns-ok",
        "plain key leaked into namespace",
      );
      namespaced.delete();
    }),
    runCase("cache-metrics", () => {
      storage.resetMetrics();
      const item = createStorageItem({
        key: "__integrity_cache__",
        scope: StorageScope.Disk,
        defaultValue: "",
        readCache: true,
      });
      item.get();
      item.set("cached");
      item.get();
      const metrics = storage.getCacheMetrics();
      assert(metrics.cacheMisses > 0, "expected a miss");
      assert(metrics.cacheHits > 0, "expected a hit");
      assert(metrics.cacheEntries > 0, "expected cache entries");
      item.delete();
    }),
    previousPersist === "persist-v1"
      ? {
          name: "disk-persist-reload",
          status: "pass",
          detail: "found persist-v1",
        }
      : runCase("disk-persist-seed", () => {
          storage.setString(persistKey, "persist-v1", StorageScope.Disk);
          storage.flushDiskWrites();
          assert(
            storage.getString(persistKey, StorageScope.Disk) === "persist-v1",
            "persist seed failed",
          );
          return "seeded persist-v1";
        }),
  ];

  const report: IntegrityReport = {
    fail: cases.filter((item) => item.status === "fail").length,
    pass: cases.filter((item) => item.status === "pass").length,
    skip: cases.filter((item) => item.status === "skip").length,
    cases,
  };
  globalThis.__integrityReport = report;
  return report;
}

export default function IntegrityLabScreen() {
  const [report, setReport] = useState<IntegrityReport | null>(null);

  useEffect(() => {
    setReport(runIntegritySweep());
  }, []);

  const summary = report
    ? `fail=${report.fail} pass=${report.pass} skip=${report.skip}`
    : "running";

  return (
    <View
      testID="e2e-integrity-screen"
      style={{ flex: 1 }}
      accessibilityLabel="Integrity lab"
    >
      <Page
        title="Integrity lab"
        subtitle="Deep link nitrostorage://e2e-integrity"
      >
        <StatusRow testID="e2e-integrity-ready" label="state" value="ready" />
        <StatusRow
          testID="e2e-integrity-summary"
          label="summary"
          value={summary}
        />
        <Card title="Cases" subtitle="Disk, Secure, import, tx, rename, cache">
          {(report?.cases ?? []).map((item) => (
            <StatusRow
              key={item.name}
              testID={`e2e-integrity-${item.name}`}
              label={item.name}
              value={`${item.status}:${item.detail ?? ""}`}
            />
          ))}
        </Card>
      </Page>
    </View>
  );
}
