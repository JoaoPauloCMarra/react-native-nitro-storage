import { useCallback, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  AccessControl,
  BiometricLevel,
  createSecureAuthStorage,
  createStorageItem,
  getBatch,
  isKeychainLockedError,
  migrateToLatest,
  registerMigration,
  removeBatch,
  runTransaction,
  setBatch,
  storage,
  StorageScope,
} from "react-native-nitro-storage";
import { Button, Colors } from "./shared";

type LogEntry = {
  label: string;
  status: "pass" | "fail" | "running";
  detail?: string;
};

type TestFn = () => void;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function buildTests(): { label: string; fn: TestFn }[] {
  return [
    {
      label: "Memory: set / get / delete / has",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_mem__",
          scope: StorageScope.Memory,
          defaultValue: 0,
        });
        item.set(42);
        assert(item.get() === 42, `expected 42, got ${item.get()}`);
        assert(item.has(), "expected has() true");
        item.delete();
        assert(item.get() === 0, "expected default after delete");
        assert(!item.has(), "expected has() false after delete");
      },
    },
    {
      label: "Disk: set / get / delete / has",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_disk__",
          scope: StorageScope.Disk,
          defaultValue: "",
        });
        item.set("hello-disk");
        assert(item.get() === "hello-disk", `expected hello-disk`);
        assert(item.has(), "expected has() true");
        item.delete();
        assert(item.get() === "", "expected default after delete");
      },
    },
    {
      label: "Secure: set / get / delete",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_sec__",
          scope: StorageScope.Secure,
          defaultValue: "",
        });
        item.set("secret-123");
        assert(item.get() === "secret-123", `expected secret-123`);
        item.delete();
        assert(item.get() === "", "expected default after delete");
      },
    },
    {
      label: "Namespace: set / get / clearNamespace",
      fn: () => {
        const item = createStorageItem({
          key: "pref",
          namespace: "__smoke_ns__",
          scope: StorageScope.Disk,
          defaultValue: "",
        });
        item.set("namespaced");
        assert(item.get() === "namespaced", "expected namespaced");
        storage.clearNamespace("__smoke_ns__", StorageScope.Disk);
        assert(item.get() === "", "expected cleared");
      },
    },
    {
      label: "JSON object serialization",
      fn: () => {
        const item = createStorageItem<{ a: number; b: string }>({
          key: "__smoke_json__",
          scope: StorageScope.Memory,
          defaultValue: { a: 0, b: "" },
        });
        item.set({ a: 99, b: "test" });
        const v = item.get();
        assert(
          v.a === 99 && v.b === "test",
          `unexpected: ${JSON.stringify(v)}`,
        );
        item.delete();
      },
    },
    {
      label: "Updater function",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_updater__",
          scope: StorageScope.Memory,
          defaultValue: 10,
        });
        item.set((prev) => prev + 5);
        assert(item.get() === 15, `expected 15, got ${item.get()}`);
        item.delete();
      },
    },
    {
      label: "Auth storage factory",
      fn: () => {
        const auth = createSecureAuthStorage({
          accessToken: {},
          refreshToken: {},
        });
        auth.accessToken.set("at_smoke");
        auth.refreshToken.set("rt_smoke");
        assert(auth.accessToken.get() === "at_smoke", "accessToken mismatch");
        assert(auth.refreshToken.get() === "rt_smoke", "refreshToken mismatch");
        auth.accessToken.delete();
        auth.refreshToken.delete();
      },
    },
    {
      label: "Namespaced auth storage",
      fn: () => {
        const auth = createSecureAuthStorage(
          { token: {} },
          { namespace: "__smoke_auth_ns__" },
        );
        auth.token.set("ns_token");
        assert(auth.token.get() === "ns_token", "ns token mismatch");
        storage.clearNamespace("__smoke_auth_ns__", StorageScope.Secure);
        assert(auth.token.get() === "", "expected cleared");
      },
    },
    {
      label: "Validation: valid value",
      fn: () => {
        const item = createStorageItem<number>({
          key: "__smoke_val__",
          scope: StorageScope.Memory,
          defaultValue: 0,
          validate: (v): v is number => typeof v === "number" && v >= 0,
          onValidationError: () => 0,
        });
        item.set(50);
        assert(item.get() === 50, `expected 50`);
        item.delete();
      },
    },
    {
      label: "Validation: invalid value throws",
      fn: () => {
        const item = createStorageItem<number>({
          key: "__smoke_val_throw__",
          scope: StorageScope.Memory,
          defaultValue: 0,
          validate: (v): v is number => typeof v === "number" && v >= 0,
        });
        let threw = false;
        try {
          item.set(-1);
        } catch {
          threw = true;
        }
        assert(threw, "expected validation to throw");
        item.delete();
      },
    },
    {
      label: "TTL expiration (Memory)",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_ttl__",
          scope: StorageScope.Memory,
          defaultValue: "",
          expiration: { ttlMs: 1 },
        });
        item.set("temp");
        // Value should expire almost immediately
        const start = Date.now();
        while (Date.now() - start < 5) {
          /* spin */
        }
        const val = item.get();
        assert(val === "", `expected expired, got "${val}"`);
      },
    },
    {
      label: "Subscribe notification",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_sub__",
          scope: StorageScope.Memory,
          defaultValue: 0,
        });
        let notified = false;
        const unsub = item.subscribe(() => {
          notified = true;
        });
        item.set(1);
        assert(notified, "expected subscriber notification");
        unsub();
        notified = false;
        item.set(2);
        assert(!notified, "should not notify after unsubscribe");
        item.delete();
      },
    },
    {
      label: "Versioned writes (getWithVersion / setIfVersion)",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_ver__",
          scope: StorageScope.Memory,
          defaultValue: "v1",
        });
        item.set("v1");
        const snap = item.getWithVersion();
        assert(snap.value === "v1", "expected v1");
        const ok = item.setIfVersion(snap.version, "v2");
        assert(ok === true, "expected setIfVersion success");
        assert(item.get() === "v2", "expected v2");
        const stale = item.setIfVersion(snap.version, "v3");
        assert(
          stale === false,
          "expected setIfVersion failure on stale version",
        );
        assert(item.get() === "v2", "value should remain v2");
        item.delete();
      },
    },
    {
      label: "Batch: setBatch / getBatch / removeBatch",
      fn: () => {
        const a = createStorageItem({
          key: "__smoke_b1__",
          scope: StorageScope.Disk,
          defaultValue: "",
        });
        const b = createStorageItem({
          key: "__smoke_b2__",
          scope: StorageScope.Disk,
          defaultValue: "",
        });
        setBatch(
          [
            { item: a, value: "A" },
            { item: b, value: "B" },
          ],
          StorageScope.Disk,
        );
        const [va, vb] = getBatch([a, b], StorageScope.Disk);
        assert(va === "A" && vb === "B", `expected A,B got ${va},${vb}`);
        removeBatch([a, b], StorageScope.Disk);
        assert(
          a.get() === "" && b.get() === "",
          "expected defaults after remove",
        );
      },
    },
    {
      label: "Transaction: commit",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_tx__",
          scope: StorageScope.Memory,
          defaultValue: 0,
        });
        runTransaction(StorageScope.Memory, (tx) => {
          tx.setItem(item, 100);
        });
        assert(item.get() === 100, `expected 100, got ${item.get()}`);
        item.delete();
      },
    },
    {
      label: "Transaction: rollback",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_tx_rb__",
          scope: StorageScope.Memory,
          defaultValue: 0,
        });
        item.set(50);
        try {
          runTransaction(StorageScope.Memory, (tx) => {
            tx.setItem(item, 999);
            throw new Error("rollback");
          });
        } catch {
          // expected
        }
        assert(
          item.get() === 50,
          `expected 50 after rollback, got ${item.get()}`,
        );
        item.delete();
      },
    },
    {
      label: "Migration: registerMigration / migrateToLatest",
      fn: () => {
        const v = Date.now();
        registerMigration(v, ({ setRaw }) => {
          setRaw("__smoke_mig_key__", "migrated");
        });
        migrateToLatest(StorageScope.Disk);
        const val = storage.getString("__smoke_mig_key__", StorageScope.Disk);
        assert(val === "migrated", `expected migrated, got ${val}`);
        storage.deleteString("__smoke_mig_key__", StorageScope.Disk);
      },
    },
    {
      label: "Raw string API",
      fn: () => {
        storage.setString("__smoke_raw__", "raw-val", StorageScope.Memory);
        const v = storage.getString("__smoke_raw__", StorageScope.Memory);
        assert(v === "raw-val", `expected raw-val, got ${v}`);
        storage.deleteString("__smoke_raw__", StorageScope.Memory);
        assert(
          storage.getString("__smoke_raw__", StorageScope.Memory) === undefined,
          "expected undefined",
        );
      },
    },
    {
      label: "Prefix keys",
      fn: () => {
        storage.setString("__smoke_pfx_a__", "1", StorageScope.Memory);
        storage.setString("__smoke_pfx_b__", "2", StorageScope.Memory);
        storage.setString("__smoke_other__", "3", StorageScope.Memory);
        const keys = storage.getKeysByPrefix(
          "__smoke_pfx_",
          StorageScope.Memory,
        );
        assert(keys.length === 2, `expected 2 prefix keys, got ${keys.length}`);
        const entries = storage.getByPrefix(
          "__smoke_pfx_",
          StorageScope.Memory,
        );
        assert(Object.keys(entries).length === 2, "expected 2 entries");
        storage.deleteString("__smoke_pfx_a__", StorageScope.Memory);
        storage.deleteString("__smoke_pfx_b__", StorageScope.Memory);
        storage.deleteString("__smoke_other__", StorageScope.Memory);
      },
    },
    {
      label: "Import bulk data",
      fn: () => {
        storage.import(
          { __smoke_imp_a__: "A", __smoke_imp_b__: "B" },
          StorageScope.Memory,
        );
        assert(
          storage.getString("__smoke_imp_a__", StorageScope.Memory) === "A",
          "import A",
        );
        assert(
          storage.getString("__smoke_imp_b__", StorageScope.Memory) === "B",
          "import B",
        );
        storage.deleteString("__smoke_imp_a__", StorageScope.Memory);
        storage.deleteString("__smoke_imp_b__", StorageScope.Memory);
      },
    },
    {
      label: "Storage size / getAllKeys / getAll",
      fn: () => {
        storage.setString("__smoke_sz_1__", "x", StorageScope.Memory);
        storage.setString("__smoke_sz_2__", "y", StorageScope.Memory);
        const keys = storage.getAllKeys(StorageScope.Memory);
        assert(keys.includes("__smoke_sz_1__"), "key 1 missing");
        const all = storage.getAll(StorageScope.Memory);
        assert("__smoke_sz_1__" in all, "getAll missing key");
        const sz = storage.size(StorageScope.Memory);
        assert(sz >= 2, `expected size >= 2, got ${sz}`);
        storage.deleteString("__smoke_sz_1__", StorageScope.Memory);
        storage.deleteString("__smoke_sz_2__", StorageScope.Memory);
      },
    },
    {
      label: "Metrics observer",
      fn: () => {
        const events: string[] = [];
        storage.setMetricsObserver((e) => events.push(e.operation));
        const item = createStorageItem({
          key: "__smoke_met__",
          scope: StorageScope.Memory,
          defaultValue: 0,
        });
        item.set(1);
        item.get();
        storage.setMetricsObserver(undefined);
        assert(
          events.length >= 2,
          `expected >= 2 events, got ${events.length}`,
        );
        const snap = storage.getMetricsSnapshot();
        assert(Object.keys(snap).length > 0, "expected non-empty snapshot");
        storage.resetMetrics();
        item.delete();
      },
    },
    {
      label: "Access control enum values",
      fn: () => {
        assert(AccessControl.WhenUnlocked === 0, "WhenUnlocked");
        assert(AccessControl.AfterFirstUnlock === 1, "AfterFirstUnlock");
        assert(
          AccessControl.WhenPasscodeSetThisDeviceOnly === 2,
          "WhenPasscode",
        );
        assert(
          AccessControl.WhenUnlockedThisDeviceOnly === 3,
          "WhenUnlockedThis",
        );
        assert(
          AccessControl.AfterFirstUnlockThisDeviceOnly === 4,
          "AfterFirstThis",
        );
      },
    },
    {
      label: "BiometricLevel enum values",
      fn: () => {
        assert(BiometricLevel.None === 0, "None");
        assert(BiometricLevel.BiometryOrPasscode === 1, "BiometryOrPasscode");
        assert(BiometricLevel.BiometryOnly === 2, "BiometryOnly");
      },
    },
    {
      label: "isKeychainLockedError",
      fn: () => {
        assert(
          isKeychainLockedError(new Error("random")) === false,
          "should be false for random error",
        );
        assert(
          isKeychainLockedError(null) === false,
          "should be false for null",
        );
        assert(
          isKeychainLockedError(undefined) === false,
          "should be false for undefined",
        );
      },
    },
    {
      label: "Custom serializer",
      fn: () => {
        const item = createStorageItem<{ id: number }>({
          key: "__smoke_custom_ser__",
          scope: StorageScope.Disk,
          defaultValue: { id: 0 },
          serialize: (v) => `ID:${v.id}`,
          deserialize: (v) => ({ id: Number(v.split(":")[1]) }),
        });
        item.set({ id: 42 });
        assert(item.get().id === 42, `expected 42`);
        item.delete();
      },
    },
    {
      label: "clear(scope) individually",
      fn: () => {
        storage.setString("__smoke_clr_m__", "m", StorageScope.Memory);
        storage.setString("__smoke_clr_d__", "d", StorageScope.Disk);
        storage.clear(StorageScope.Memory);
        assert(
          storage.getString("__smoke_clr_m__", StorageScope.Memory) ===
            undefined,
          "memory not cleared",
        );
        assert(
          storage.getString("__smoke_clr_d__", StorageScope.Disk) === "d",
          "disk should survive memory clear",
        );
        storage.clear(StorageScope.Disk);
        assert(
          storage.getString("__smoke_clr_d__", StorageScope.Disk) === undefined,
          "disk not cleared",
        );
      },
    },
    {
      label: "storage.has() raw API",
      fn: () => {
        storage.setString("__smoke_has__", "yes", StorageScope.Memory);
        assert(
          storage.has("__smoke_has__", StorageScope.Memory),
          "expected has() true",
        );
        storage.deleteString("__smoke_has__", StorageScope.Memory);
        assert(
          !storage.has("__smoke_has__", StorageScope.Memory),
          "expected has() false after delete",
        );
      },
    },
    {
      label: "Disk transaction: commit + rollback",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_tx_disk__",
          scope: StorageScope.Disk,
          defaultValue: "",
        });
        runTransaction(StorageScope.Disk, (tx) => {
          tx.setItem(item, "committed");
        });
        assert(
          item.get() === "committed",
          `expected committed, got ${item.get()}`,
        );
        try {
          runTransaction(StorageScope.Disk, (tx) => {
            tx.setItem(item, "should-rollback");
            throw new Error("rollback");
          });
        } catch {
          // expected
        }
        assert(
          item.get() === "committed",
          `expected committed after rollback, got ${item.get()}`,
        );
        item.delete();
      },
    },
    {
      label: "Transaction: raw API (getRaw/setRaw/removeRaw)",
      fn: () => {
        storage.setString("__smoke_tx_raw__", "original", StorageScope.Disk);
        runTransaction(StorageScope.Disk, (tx) => {
          const v = tx.getRaw("__smoke_tx_raw__");
          assert(v === "original", `expected original, got ${v}`);
          tx.setRaw("__smoke_tx_raw__", "updated");
        });
        assert(
          storage.getString("__smoke_tx_raw__", StorageScope.Disk) === "updated",
          "expected updated",
        );
        runTransaction(StorageScope.Disk, (tx) => {
          tx.removeRaw("__smoke_tx_raw__");
        });
        assert(
          storage.getString("__smoke_tx_raw__", StorageScope.Disk) === undefined,
          "expected removed",
        );
      },
    },
    {
      label: "Updater with disk scope",
      fn: () => {
        const item = createStorageItem({
          key: "__smoke_upd_disk__",
          scope: StorageScope.Disk,
          defaultValue: 10,
        });
        item.set((prev) => prev + 5);
        assert(item.get() === 15, `expected 15, got ${item.get()}`);
        item.delete();
      },
    },
    {
      label: "clearAll wipes all scopes",
      fn: () => {
        storage.setString("__smoke_ca_m__", "m", StorageScope.Memory);
        storage.setString("__smoke_ca_d__", "d", StorageScope.Disk);
        storage.setString("__smoke_ca_s__", "s", StorageScope.Secure);
        storage.clearAll();
        assert(
          storage.getString("__smoke_ca_m__", StorageScope.Memory) ===
            undefined,
          "memory not cleared",
        );
        assert(
          storage.getString("__smoke_ca_d__", StorageScope.Disk) === undefined,
          "disk not cleared",
        );
        assert(
          storage.getString("__smoke_ca_s__", StorageScope.Secure) ===
            undefined,
          "secure not cleared",
        );
      },
    },
  ];
}

export function SmokeTestRunner() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const run = useCallback(async () => {
    setRunning(true);
    const tests = buildTests();
    const results: LogEntry[] = [];
    setLogs(tests.map((t) => ({ label: t.label, status: "running" })));

    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      results.push({ label: test.label, status: "running" });
      setLogs([
        ...results,
        ...tests
          .slice(i + 1)
          .map((t) => ({ label: t.label, status: "running" as const })),
      ]);

      // Yield to UI between tests
      await new Promise((r) => setTimeout(r, 16));

      try {
        test.fn();
        results[i] = { label: test.label, status: "pass" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results[i] = { label: test.label, status: "fail", detail: msg };
      }

      setLogs([
        ...results,
        ...tests
          .slice(i + 1)
          .map((t) => ({ label: t.label, status: "running" as const })),
      ]);
    }

    setLogs([...results]);
    setRunning(false);
  }, []);

  const passCount = logs.filter((l) => l.status === "pass").length;
  const failCount = logs.filter((l) => l.status === "fail").length;
  const total = logs.length;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.title}>Smoke Test</Text>
          {total > 0 ? (
            <Text style={s.summary}>
              {passCount}/{total} passed
              {failCount > 0 ? ` · ${failCount} failed` : ""}
            </Text>
          ) : (
            <Text style={s.summary}>Run all features sequentially</Text>
          )}
        </View>
        <Button
          testID="smoke-run-all"
          title={running ? "Running..." : "Run All"}
          onPress={run}
          disabled={running}
          variant={failCount > 0 ? "danger" : "primary"}
          size="sm"
        />
      </View>

      {logs.length > 0 ? (
        <ScrollView
          ref={scrollRef}
          style={s.logScroll}
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          {logs.map((entry, idx) => (
            <View key={idx} style={s.logRow}>
              <Text style={s.logIcon}>
                {entry.status === "pass"
                  ? "✓"
                  : entry.status === "fail"
                    ? "✗"
                    : "·"}
              </Text>
              <View style={s.logContent}>
                <Text
                  style={[
                    s.logLabel,
                    entry.status === "pass" && s.logPass,
                    entry.status === "fail" && s.logFail,
                    entry.status === "running" && s.logRunning,
                  ]}
                >
                  {entry.label}
                </Text>
                {entry.detail ? (
                  <Text style={s.logDetail}>{entry.detail}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    boxShadow: "0 12px 28px rgba(15, 23, 42, 0.09)",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    gap: 12,
  },
  headerLeft: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: Colors.text,
    letterSpacing: -0.2,
  },
  summary: {
    fontSize: 12,
    color: Colors.muted,
    fontWeight: "600",
  },
  logScroll: {
    maxHeight: 400,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  logRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  logContent: {
    flex: 1,
    gap: 2,
  },
  logIcon: {
    fontSize: 14,
    fontWeight: "800",
    width: 18,
    textAlign: "center",
    marginTop: 1,
  },
  logLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.text,
  },
  logPass: {
    color: Colors.success,
  },
  logFail: {
    color: Colors.danger,
  },
  logRunning: {
    color: Colors.muted,
  },
  logDetail: {
    fontSize: 11,
    color: Colors.danger,
    fontWeight: "500",
  },
});
