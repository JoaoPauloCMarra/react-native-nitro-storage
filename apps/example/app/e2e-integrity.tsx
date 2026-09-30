import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  createStorageItem,
  createSetItem,
  getBatch,
  removeBatch,
  runTransaction,
  setBatch,
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

function seedPersistCase(persistKey: string): LabCase {
  const seeded = runCase("disk-persist-seed", () => {
    storage.setString(persistKey, "persist-v1", StorageScope.Disk);
    storage.flushDiskWrites();
    assert(
      storage.getString(persistKey, StorageScope.Disk) === "persist-v1",
      "persist seed failed",
    );
  });
  return seeded.status === "pass"
    ? { ...seeded, status: "skip", detail: "seeded; relaunch to verify" }
    : seeded;
}

function runIntegritySweep(): IntegrityReport {
  const persistKey = "__integrity_disk_persist__";
  const previousPersist = storage.getString(persistKey, StorageScope.Disk);
  const cases: LabCase[] = [
    runCase("audit-prefix-case", () => {
      const upper = "__audit_User";
      const lower = "__audit_user";
      try {
        storage.setString(`${upper}::token`, "upper", StorageScope.Disk);
        storage.setString(`${lower}::token`, "lower", StorageScope.Disk);
        storage.flushDiskWrites();
        const keys = storage.getKeysByPrefix(`${upper}::`, StorageScope.Disk);
        assert(
          keys.length === 1 && keys[0] === `${upper}::token`,
          "prefix folded case",
        );
        storage.clearNamespace(upper, StorageScope.Disk);
        storage.flushDiskWrites();
        assert(
          storage.getString(`${upper}::token`, StorageScope.Disk) == null,
          "upper survived clear",
        );
        assert(
          storage.getString(`${lower}::token`, StorageScope.Disk) === "lower",
          "lower namespace removed",
        );
      } finally {
        storage.deleteString(`${upper}::token`, StorageScope.Disk);
        storage.deleteString(`${lower}::token`, StorageScope.Disk);
        storage.flushDiskWrites();
      }
    }),
    runCase("audit-memory-raw-and-set", () => {
      const key = "__audit_raw__";
      const literal = "__nitro_storage_primitive__:literal";
      const item = createSetItem<string>({
        key: "__audit_set__",
        scope: StorageScope.Memory,
        defaultValue: ["__proto__"],
      });
      try {
        storage.setString(key, literal, StorageScope.Memory);
        assert(
          storage.getByPrefix(key, StorageScope.Memory)[key] === literal,
          "raw escape leaked",
        );
        item.add("constructor");
        item.add("toString");
        for (const member of ["__proto__", "constructor", "toString"]) {
          assert(
            item.has(member) && Object.hasOwn(item.get(), member),
            "set member missing",
          );
        }
      } finally {
        storage.deleteString(key, StorageScope.Memory);
        item.item.delete();
      }
    }),
    runCase("audit-prefix-literals", () => {
      const prefixes = [
        "__audit_%",
        "__audit__",
        "__audit_\\",
        "__audit_café",
        "__audit_nul\0",
      ];
      for (const prefix of prefixes) {
        const key = `${prefix}::value`;
        const decoy = "__audit_decoy::value";
        try {
          storage.setString(key, "value", StorageScope.Disk);
          storage.setString(decoy, "keep", StorageScope.Disk);
          storage.flushDiskWrites();
          const matches = storage.getKeysByPrefix(prefix, StorageScope.Disk);
          assert(
            matches.length === 1 && matches[0] === key,
            `literal prefix mismatch: ${JSON.stringify({ prefix, key, matches })}`,
          );
        } finally {
          storage.deleteString(key, StorageScope.Disk);
          storage.deleteString(decoy, StorageScope.Disk);
          storage.flushDiskWrites();
        }
      }
    }),
    runCase("audit-nul-roundtrip", () => {
      for (const scope of [StorageScope.Disk, StorageScope.Secure]) {
        const prefix = "__audit_roundtrip__";
        const key = prefix + "\0café😀";
        const batchKey = prefix + "\0batch";
        const value = "before\0after café😀";
        const scopeName = StorageScope[scope];
        try {
          storage.setString(prefix, "decoy", scope);
          storage.setString(key, value, scope);
          storage.flushDiskWrites();
          storage.flushSecureWrites();
          assert(
            storage.getString(key, scope) === value,
            scopeName + " scalar NUL roundtrip",
          );
          assert(
            storage.getString(prefix, scope) === "decoy",
            scopeName + " NUL key collision",
          );
          storage.import({ [batchKey]: value }, scope);
          storage.flushDiskWrites();
          storage.flushSecureWrites();
          assert(
            storage.getString(batchKey, scope) === value,
            scopeName + " batch NUL roundtrip",
          );
          assert(
            storage.getAllKeys(scope).includes(key),
            scopeName + " all keys truncated",
          );
          const selected = storage.getByPrefix(prefix + "\0", scope);
          assert(
            selected[key] === value &&
              selected[batchKey] === value &&
              !Object.hasOwn(selected, prefix),
            scopeName + " prefix values truncated",
          );
        } finally {
          storage.deleteString(key, scope);
          storage.deleteString(batchKey, scope);
          storage.deleteString(prefix, scope);
          storage.flushDiskWrites();
          storage.flushSecureWrites();
        }
      }
    }),
    runCase("disk-write-read", () => {
      storage.setString("__integrity_disk__", "disk-ok", StorageScope.Disk);
      const item = createStorageItem({
        key: "__integrity_disk_item__",
        scope: StorageScope.Disk,
        defaultValue: "",
      });
      item.set("disk-item-ok");
      assert(item.get() === "disk-item-ok", `got ${item.get()}`);
      assert(
        storage.getString("__integrity_disk__", StorageScope.Disk) ===
          "disk-ok",
        "raw disk mismatch",
      );
      item.delete();
      storage.deleteString("__integrity_disk__", StorageScope.Disk);
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
      assert(namespaced.get() === "ns-ok", `got ${namespaced.get()}`);
      storage.setString("integrity:pref-raw", "ns-raw", StorageScope.Disk);
      assert(
        storage.getString("integrity:pref-raw", StorageScope.Disk) === "ns-raw",
        "namespaced raw key missing",
      );
      assert(
        storage.getString("pref", StorageScope.Disk) !== "ns-raw",
        "plain key leaked into namespace",
      );
      namespaced.delete();
      storage.deleteString("integrity:pref-raw", StorageScope.Disk);
    }),
    runCase("cache-metrics", () => {
      storage.resetMetrics();
      const key = `__integrity_cache_${Date.now()}__`;
      const item = createStorageItem({
        key,
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
      storage.flushDiskWrites();
    }),
    runCase("disk-ttl", () => {
      const item = createStorageItem({
        key: "__integrity_ttl__",
        scope: StorageScope.Disk,
        defaultValue: "expired-default",
        expiration: { ttlMs: 1 },
      });
      item.set("fresh");
      storage.flushDiskWrites();
      const started = Date.now();
      while (Date.now() - started < 5) {}
      assert(item.get() === "expired-default", `got ${item.get()}`);
      item.delete();
      storage.flushDiskWrites();
    }),
    runCase("secure-batch", () => {
      const a = createStorageItem({
        key: "__integrity_sb_a__",
        scope: StorageScope.Secure,
        defaultValue: "",
      });
      const b = createStorageItem({
        key: "__integrity_sb_b__",
        scope: StorageScope.Secure,
        defaultValue: "",
      });
      setBatch(
        [
          { item: a, value: "a" },
          { item: b, value: "b" },
        ],
        StorageScope.Secure,
      );
      storage.flushSecureWrites();
      const [va, vb] = getBatch([a, b], StorageScope.Secure);
      assert(va === "a" && vb === "b", `got ${String(va)},${String(vb)}`);
      removeBatch([a, b], StorageScope.Secure);
      storage.flushSecureWrites();
    }),
    runCase("secure-tx-rollback", () => {
      const item = createStorageItem({
        key: "__integrity_stx__",
        scope: StorageScope.Secure,
        defaultValue: "",
      });
      item.set("committed");
      storage.flushSecureWrites();
      let rolledBack = false;
      try {
        runTransaction(StorageScope.Secure, (tx) => {
          tx.setItem(item, "should-rollback");
          throw new Error("rollback");
        });
      } catch {
        rolledBack = true;
      }
      assert(rolledBack, "expected throw");
      assert(item.get() === "committed", `got ${item.get()}`);
      item.delete();
      storage.flushSecureWrites();
    }),
    runCase("disk-prefix", () => {
      storage.setString("__pfx_keep__", "1", StorageScope.Disk);
      storage.setString("__pfx_drop_a__", "2", StorageScope.Disk);
      storage.flushDiskWrites();
      const keys = storage.getKeysByPrefix("__pfx_", StorageScope.Disk);
      assert(keys.includes("__pfx_keep__"), "keep missing");
      assert(keys.includes("__pfx_drop_a__"), "drop missing");
      for (const key of storage.getKeysByPrefix(
        "__pfx_drop_",
        StorageScope.Disk,
      )) {
        storage.deleteString(key, StorageScope.Disk);
      }
      storage.flushDiskWrites();
      assert(
        storage.getString("__pfx_keep__", StorageScope.Disk) === "1",
        "keep removed",
      );
      assert(
        storage.getString("__pfx_drop_a__", StorageScope.Disk) == null,
        "drop still present",
      );
      storage.deleteString("__pfx_keep__", StorageScope.Disk);
      storage.flushDiskWrites();
    }),
    previousPersist === "persist-v1"
      ? {
          name: "disk-persist-reload",
          status: "pass",
          detail: "found persist-v1",
        }
      : seedPersistCase(persistKey),
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
