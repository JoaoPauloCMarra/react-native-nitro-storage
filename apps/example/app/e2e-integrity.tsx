import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  createStorageItem,
  createSetItem,
  getBatch,
  removeBatch,
  runTransaction,
  setBatch,
  storage,
  StorageScope,
  type TransactionContext,
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
  const cases: LabCase[] = [
    runCase("native-backend-capabilities", () => {
      const capabilities = storage.getCapabilities();
      assert(capabilities.platform === "native", "platform is not native");
      assert(
        capabilities.backend.disk === "sqlite",
        `Disk backend is ${capabilities.backend.disk}`,
      );
      assert(
        capabilities.backend.secure === "platform-secure-storage",
        `Secure backend is ${capabilities.backend.secure}`,
      );
      return "native:disk=sqlite:secure=platform-secure-storage";
    }),
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
        return "exact-case=upper-only:lower=preserved";
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
        return "raw-literal=preserved:set=3";
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
      return `literal-prefixes=${prefixes.length}`;
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
      return "disk+secure:nul+unicode+batch";
    }),
    runCase("disk-write-read", () => {
      const rawKey = "__integrity_disk__";
      const item = createStorageItem({
        key: "__integrity_disk_item__",
        scope: StorageScope.Disk,
        defaultValue: "",
      });
      try {
        storage.setString(rawKey, "disk-ok", StorageScope.Disk);
        item.set("disk-item-ok");
        assert(item.get() === "disk-item-ok", `got ${item.get()}`);
        assert(
          storage.getString(rawKey, StorageScope.Disk) === "disk-ok",
          "raw disk mismatch",
        );
        return "raw=disk-ok:item=disk-item-ok";
      } finally {
        item.delete();
        storage.deleteString(rawKey, StorageScope.Disk);
        storage.flushDiskWrites();
      }
    }),
    runCase("secure-write-read", () => {
      const item = createStorageItem({
        key: "__integrity_secure__",
        scope: StorageScope.Secure,
        defaultValue: "",
      });
      try {
        item.set("secure-ok");
        assert(item.get() === "secure-ok", `got ${item.get()}`);
        return "secure-ok";
      } finally {
        item.delete();
        storage.flushSecureWrites();
      }
    }),
    runCase("import-then-flush", () => {
      const key = "__integrity_import__";
      try {
        storage.import({ [key]: "imported" }, StorageScope.Disk);
        storage.flushDiskWrites();
        assert(
          storage.getString(key, StorageScope.Disk) === "imported",
          "import missing after flush",
        );
        return "imported-after-flush";
      } finally {
        storage.deleteString(key, StorageScope.Disk);
        storage.flushDiskWrites();
      }
    }),
    runCase("tx-rollback", () => {
      const item = createStorageItem({
        key: "__integrity_tx__",
        scope: StorageScope.Disk,
        defaultValue: "",
      });
      try {
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
        return "committed:rollback=true";
      } finally {
        item.delete();
        storage.flushDiskWrites();
      }
    }),
    runCase("renameFrom", () => {
      const renamed = createStorageItem({
        key: "__nitro_qa_integrity_renamed__",
        scope: StorageScope.Disk,
        defaultValue: "",
        renameFrom: "__nitro_qa_integrity_legacy__",
      });
      try {
        storage.setString(
          "__nitro_qa_integrity_legacy__",
          "migrated-value",
          StorageScope.Disk,
        );
        assert(renamed.get() === "migrated-value", `got ${renamed.get()}`);
        assert(
          storage.getString(
            "__nitro_qa_integrity_legacy__",
            StorageScope.Disk,
          ) === undefined,
          "legacy key survived rename",
        );
        return "migrated-value:legacy=missing";
      } finally {
        renamed.delete();
        storage.deleteString(
          "__nitro_qa_integrity_legacy__",
          StorageScope.Disk,
        );
        storage.flushDiskWrites();
      }
    }),
    runCase("namespace-isolation", () => {
      const namespaced = createStorageItem({
        key: "pref",
        namespace: "__nitro_qa_integrity__",
        scope: StorageScope.Disk,
        defaultValue: "",
      });
      try {
        namespaced.set("ns-ok");
        assert(namespaced.get() === "ns-ok", `got ${namespaced.get()}`);
        storage.setString(
          "__nitro_qa_integrity__:pref-raw",
          "ns-raw",
          StorageScope.Disk,
        );
        assert(
          storage.getString(
            "__nitro_qa_integrity__:pref-raw",
            StorageScope.Disk,
          ) === "ns-raw",
          "namespaced raw key missing",
        );
        assert(
          storage.getString("pref", StorageScope.Disk) !== "ns-raw",
          "plain key leaked into namespace",
        );
        return "item=ns-ok:raw=ns-raw:plain-key=isolated";
      } finally {
        namespaced.delete();
        storage.deleteString(
          "__nitro_qa_integrity__:pref-raw",
          StorageScope.Disk,
        );
        storage.flushDiskWrites();
      }
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
      try {
        item.get();
        item.set("cached");
        item.get();
        const metrics = storage.getCacheMetrics();
        assert(metrics.cacheMisses > 0, "expected a miss");
        assert(metrics.cacheHits > 0, "expected a hit");
        assert(metrics.cacheEntries > 0, "expected cache entries");
        return "cache=miss-hit-entry";
      } finally {
        item.delete();
        storage.flushDiskWrites();
      }
    }),
    runCase("disk-ttl", () => {
      const item = createStorageItem({
        key: "__integrity_ttl__",
        scope: StorageScope.Disk,
        defaultValue: "expired-default",
        expiration: { ttlMs: 1 },
      });
      try {
        item.set("fresh");
        storage.flushDiskWrites();
        const started = Date.now();
        while (Date.now() - started < 5) {}
        assert(item.get() === "expired-default", `got ${item.get()}`);
        return "expired-default";
      } finally {
        item.delete();
        storage.flushDiskWrites();
      }
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
      try {
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
        return "a,b";
      } finally {
        removeBatch([a, b], StorageScope.Secure);
        storage.flushSecureWrites();
      }
    }),
    runCase("secure-tx-rollback", () => {
      const item = createStorageItem({
        key: "__integrity_stx__",
        scope: StorageScope.Secure,
        defaultValue: "",
      });
      try {
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
        return "committed:rollback=true";
      } finally {
        item.delete();
        storage.flushSecureWrites();
      }
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
      return "keep=1:drop=missing";
    }),
    runCase("async-transaction-guard", () => {
      const key = "__integrity_async_guard__";
      for (const scope of [
        StorageScope.Memory,
        StorageScope.Disk,
        StorageScope.Secure,
      ]) {
        storage.setString(key, "original", scope);
        const captured: { context?: TransactionContext } = {};
        try {
          let rejected = false;
          try {
            // Exercise the JavaScript boundary that TypeScript rejects for callers.
            Reflect.apply(runTransaction, undefined, [
              scope,
              (context: TransactionContext) => {
                captured.context = context;
                context.setRaw(key, "must-rollback");
                return Promise.resolve();
              },
            ]);
          } catch (error) {
            rejected =
              error instanceof TypeError &&
              error.message.includes("callbacks must be synchronous");
          }
          assert(rejected, "Promise callback was not rejected synchronously");
          assert(
            storage.getString(key, scope) === "original",
            "Promise callback write was not rolled back",
          );
          const context = captured.context;
          if (!context) throw new Error("Transaction context missing");
          let closed = false;
          try {
            context.setRaw(key, "late-write");
          } catch (error) {
            closed =
              error instanceof TypeError &&
              error.message.includes("context is closed");
          }
          assert(closed, "Retained context accepted a write after rejection");
          assert(
            storage.getString(key, scope) === "original",
            "Retained context changed storage",
          );
        } finally {
          storage.deleteString(key, scope);
        }
      }
      return "memory+disk+secure:promise-rejected:rollback=original:context=closed";
    }),
    runCase("qa-key-cleanup", () => {
      const prefixes = [
        "__audit_",
        "__integrity_",
        "__pfx_",
        "__nitro_qa_integrity__:",
      ];
      for (const scope of [
        StorageScope.Memory,
        StorageScope.Disk,
        StorageScope.Secure,
      ]) {
        for (const prefix of prefixes) {
          for (const key of storage.getKeysByPrefix(prefix, scope)) {
            storage.deleteString(key, scope);
          }
        }
      }
      storage.deleteString("__nitro_qa_integrity_legacy__", StorageScope.Disk);
      storage.deleteString("__nitro_qa_integrity_renamed__", StorageScope.Disk);
      storage.flushDiskWrites();
      storage.flushSecureWrites();
      const remaining = [
        StorageScope.Memory,
        StorageScope.Disk,
        StorageScope.Secure,
      ].flatMap((scope) =>
        prefixes.flatMap((prefix) => storage.getKeysByPrefix(prefix, scope)),
      );
      assert(remaining.length === 0, "QA keys remain after cleanup");
      return "qa-keys=cleared";
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
    ? `finished:fail=${report.fail}:skip=${report.skip}`
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
          testID="e2e-integrity-finished"
          label="run"
          value={report ? "finished" : "running"}
        />
        <StatusRow
          testID="e2e-integrity-summary"
          label="summary"
          value={summary}
        />
        {report ? (
          <View
            testID="e2e-integrity-results"
            accessible
            accessibilityLabel={report.cases
              .map((item) => `${item.status}:${item.detail ?? ""}`)
              .join(" ")}
            style={styles.resultsProbe}
          />
        ) : null}
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

const styles = StyleSheet.create({
  resultsProbe: {
    height: 1,
  },
});
