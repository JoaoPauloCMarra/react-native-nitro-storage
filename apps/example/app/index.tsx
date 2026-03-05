import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  createSecureAuthStorage,
  createStorageItem,
  getBatch,
  migrateToLatest,
  registerMigration,
  removeBatch,
  runTransaction,
  setBatch,
  storage,
  StorageScope,
  useStorage,
} from "react-native-nitro-storage";
import {
  Button,
  Card,
  CodeBlock,
  Colors,
  Input,
  Page,
  Section,
  StatusRow,
  styles,
} from "../components/shared";

// ─── Module-level storage items ───────────────────────────────────────────────

const counterItem = createStorageItem({
  key: "counter",
  scope: StorageScope.Memory,
  defaultValue: 0,
});

const diskNameItem = createStorageItem({
  key: "disk-name",
  scope: StorageScope.Disk,
  defaultValue: "",
});

const secureTokenItem = createStorageItem({
  key: "secure-token",
  scope: StorageScope.Secure,
  defaultValue: "",
});

const namespacedItem = createStorageItem({
  key: "user-pref",
  namespace: "settings",
  scope: StorageScope.Disk,
  defaultValue: "",
});

type AppConfig = { theme: "dark" | "light"; notifications: boolean };

const configItem = createStorageItem<AppConfig>({
  key: "app-config",
  scope: StorageScope.Disk,
  defaultValue: { theme: "dark", notifications: true },
});

const authStorage = createSecureAuthStorage(
  { accessToken: {}, refreshToken: {} },
);

const nsAuthStorage = createSecureAuthStorage(
  { accessToken: {}, refreshToken: {} },
  { namespace: "app-auth" },
);

const hookCountItem = createStorageItem({
  key: "hook-count",
  scope: StorageScope.Memory,
  defaultValue: 0,
});

const hookLabelItem = createStorageItem({
  key: "hook-label",
  scope: StorageScope.Memory,
  defaultValue: "initial",
});

const ageItem = createStorageItem<number>({
  key: "user-age",
  scope: StorageScope.Disk,
  defaultValue: 21,
  validate: (v): v is number =>
    typeof v === "number" && v >= 13 && v <= 120,
  onValidationError: () => 21,
});

const ttlItem = createStorageItem({
  key: "ttl-demo",
  scope: StorageScope.Memory,
  defaultValue: "",
  expiration: { ttlMs: 5000 },
});

const balanceItem = createStorageItem({
  key: "tx-balance",
  scope: StorageScope.Memory,
  defaultValue: 0,
});

const txLogItem = createStorageItem({
  key: "tx-log",
  scope: StorageScope.Memory,
  defaultValue: "",
});

const migrationNameItem = createStorageItem({
  key: "mig-name",
  scope: StorageScope.Disk,
  defaultValue: "",
  serialize: (v) => v,
  deserialize: (v) => v,
});

const batch1 = createStorageItem({
  key: "batch-key-1",
  scope: StorageScope.Disk,
  defaultValue: "-",
});

const batch2 = createStorageItem({
  key: "batch-key-2",
  scope: StorageScope.Disk,
  defaultValue: "-",
});

const batch3 = createStorageItem({
  key: "batch-key-3",
  scope: StorageScope.Disk,
  defaultValue: "-",
});

// ─── Component ────────────────────────────────────────────────────────────────

const HOOK_LABELS = ["initial", "alpha", "beta", "gamma", "delta"];

let migVer = 30_000;

export default function HomeScreen() {
  // 1. Memory Scope
  const [counter, setCounter] = useStorage(counterItem);

  // 2. Disk Scope
  const [diskName, setDiskName] = useStorage(diskNameItem);
  const [tempDiskName, setTempDiskName] = useState("");

  // 3. Secure Scope
  const [token, setToken] = useStorage(secureTokenItem);
  const [tempToken, setTempToken] = useState("");

  // 4. Namespaces
  const [nsPref, setNsPref] = useStorage(namespacedItem);
  const [tempNsPref, setTempNsPref] = useState("");

  // 5. JSON Objects
  const [config, setConfig] = useStorage(configItem);

  // 6. Auth Storage Factory
  const [atValue] = useStorage(authStorage.accessToken);
  const [rtValue] = useStorage(authStorage.refreshToken);

  // 7. Namespaced Auth Storage
  const [nsAtValue] = useStorage(nsAuthStorage.accessToken);
  const [nsRtValue] = useStorage(nsAuthStorage.refreshToken);

  // 9. Hooks
  const [hookCount, setHookCount] = useStorage(hookCountItem);
  const [hookLabel, setHookLabel] = useStorage(hookLabelItem);
  const [hookLabelIdx, setHookLabelIdx] = useState(0);

  // 10. Validation
  const [age] = useStorage(ageItem);
  const [ageInput, setAgeInput] = useState(String(age));

  // 11. TTL
  const [ttlVal, setTtlVal] = useState(() => ttlItem.get());

  // 12. Transactions
  const [balance] = useStorage(balanceItem);
  const [txLog] = useStorage(txLogItem);

  // 13. Migrations
  const [migResult, setMigResult] = useState("(not run)");

  // 14. Batch Operations
  const [v1] = useStorage(batch1);
  const [v2] = useStorage(batch2);
  const [v3] = useStorage(batch3);
  const [batchResponse, setBatchResponse] = useState<string | null>(null);

  return (
    <Page
      title="Nitro Storage"
      subtitle="Complete feature showcase"
    >
      {/* 1. Memory Scope */}
      <Card
        title="Memory Scope"
        subtitle="In-process ephemeral storage"
        indicatorColor={Colors.memory}
      >
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Counter value</Text>
          <Text testID="counter-value" style={styles.panelValue}>
            {counter}
          </Text>
        </View>
        <View style={styles.row}>
          <Button
            testID="counter-decrement"
            title="-1"
            onPress={() => setCounter(counter - 1)}
            variant="danger"
            style={styles.flex1}
          />
          <Button
            testID="counter-reset"
            title="Reset"
            onPress={() => setCounter(0)}
            variant="secondary"
            style={styles.flex1}
          />
          <Button
            testID="counter-increment"
            title="+1"
            onPress={() => setCounter(counter + 1)}
            style={styles.flex1}
          />
        </View>
      </Card>

      {/* 2. Disk Scope */}
      <Card
        title="Disk Scope"
        subtitle="Persistent storage"
        indicatorColor={Colors.disk}
      >
        <Input
          testID="disk-name-input"
          label="Display name"
          value={tempDiskName}
          onChangeText={setTempDiskName}
          placeholder="Enter a name"
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <Button
            testID="disk-save"
            title="Save"
            onPress={() => {
              setDiskName(tempDiskName.trim());
              setTempDiskName("");
            }}
            style={styles.flex1}
            disabled={!tempDiskName.trim()}
          />
          <Button
            testID="disk-delete"
            title="Delete"
            variant="danger"
            onPress={() => {
              diskNameItem.delete();
            }}
          />
        </View>
        <StatusRow
          testID="disk-stored-value"
          label="Stored"
          value={diskName || "(empty)"}
          color={diskName ? Colors.disk : Colors.muted}
        />
        <StatusRow
          testID="disk-has-value"
          label="has()"
          value={String(diskNameItem.has())}
          color={diskNameItem.has() ? Colors.success : Colors.muted}
        />
      </Card>

      {/* 3. Secure Scope */}
      <Card
        title="Secure Scope"
        subtitle="Hardware encrypted"
        indicatorColor={Colors.secure}
      >
        <Input
          testID="secure-token-input"
          label="Secret value"
          value={tempToken}
          onChangeText={setTempToken}
          placeholder="Paste a token or secret"
          secureTextEntry
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <Button
            testID="secure-lock"
            title="Lock"
            onPress={() => {
              setToken(tempToken.trim());
              setTempToken("");
            }}
            variant="success"
            style={styles.flex1}
            disabled={!tempToken.trim()}
          />
          <Button
            testID="secure-wipe"
            title="Wipe"
            variant="danger"
            onPress={() => {
              secureTokenItem.delete();
            }}
          />
        </View>
        {token ? (
          <StatusRow
            testID="secure-encrypted-value"
            label="Encrypted"
            value={`${token.slice(0, 6)}....`}
            color={Colors.secure}
          />
        ) : null}
      </Card>

      {/* 4. Namespaces */}
      <Card
        title="Namespaces"
        subtitle="Scoped key isolation"
        indicatorColor={Colors.accent}
      >
        <Input
          testID="ns-pref-input"
          label="Preference value"
          value={tempNsPref}
          onChangeText={setTempNsPref}
          placeholder="Set a namespaced value"
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <Button
            testID="ns-save"
            title="Save"
            onPress={() => {
              setNsPref(tempNsPref.trim());
              setTempNsPref("");
            }}
            style={styles.flex1}
            disabled={!tempNsPref.trim()}
          />
          <Button
            testID="ns-clear-namespace"
            title="Clear Namespace"
            variant="secondary"
            onPress={() => {
              storage.clearNamespace("settings", StorageScope.Disk);
            }}
            style={styles.flex1}
          />
        </View>
        <StatusRow
          testID="ns-pref-value"
          label="Value"
          value={nsPref || "(empty)"}
        />
      </Card>

      {/* 5. JSON Objects */}
      <Card
        title="JSON Objects"
        subtitle="Typed serialization"
        indicatorColor={Colors.primary}
      >
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Theme</Text>
          <Button
            testID="json-theme-toggle"
            title={config.theme.toUpperCase()}
            onPress={() => {
              setConfig((prev) => ({
                ...prev,
                theme: prev.theme === "dark" ? "light" : "dark",
              }));
            }}
            variant="secondary"
            size="sm"
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Notifications</Text>
          <Button
            testID="json-notif-toggle"
            title={config.notifications ? "ON" : "OFF"}
            onPress={() => {
              setConfig((prev) => ({
                ...prev,
                notifications: !prev.notifications,
              }));
            }}
            variant={config.notifications ? "success" : "secondary"}
            size="sm"
          />
        </View>
        <CodeBlock testID="json-config-code">
          {JSON.stringify(config, null, 2)}
        </CodeBlock>
      </Card>

      {/* 6. Auth Storage Factory */}
      <Card
        title="Auth Storage Factory"
        subtitle="createSecureAuthStorage"
        indicatorColor={Colors.secure}
      >
        <View style={styles.row}>
          <Button
            testID="auth-set-tokens"
            title="Set Tokens"
            onPress={() => {
              const now = Date.now().toString(36);
              authStorage.accessToken.set(`at_${now}`);
              authStorage.refreshToken.set(`rt_${now}`);
            }}
            style={styles.flex1}
          />
          <Button
            testID="auth-clear"
            title="Clear"
            variant="danger"
            onPress={() => {
              authStorage.accessToken.delete();
              authStorage.refreshToken.delete();
            }}
          />
        </View>
        <StatusRow
          testID="auth-access-token-value"
          label="accessToken"
          value={atValue || "(empty)"}
        />
        <StatusRow
          testID="auth-refresh-token-value"
          label="refreshToken"
          value={rtValue || "(empty)"}
        />
      </Card>

      {/* 7. Namespaced Auth Storage */}
      <Card
        title="Namespaced Auth Storage"
        subtitle="createSecureAuthStorage + namespace"
        indicatorColor={Colors.secure}
      >
        <View style={styles.row}>
          <Button
            testID="ns-auth-set-tokens"
            title="Set Tokens"
            onPress={() => {
              const now = Date.now().toString(36);
              nsAuthStorage.accessToken.set(`ns_at_${now}`);
              nsAuthStorage.refreshToken.set(`ns_rt_${now}`);
            }}
            style={styles.flex1}
          />
          <Button
            testID="ns-auth-clear-namespace"
            title="Clear Namespace"
            variant="danger"
            onPress={() => {
              storage.clearNamespace("app-auth", StorageScope.Secure);
            }}
          />
        </View>
        <StatusRow
          testID="ns-auth-access-token-value"
          label="accessToken"
          value={nsAtValue || "(empty)"}
        />
        <StatusRow
          testID="ns-auth-refresh-token-value"
          label="refreshToken"
          value={nsRtValue || "(empty)"}
        />
      </Card>

      {/* 8. Storage Utils */}
      <Card title="Storage Utils" subtitle="Introspection and wipe">
        <Section title="Key counts">
          <StatusRow
            testID="util-disk-size"
            label="Disk size()"
            value={String(storage.size(StorageScope.Disk))}
          />
          <StatusRow
            testID="util-memory-size"
            label="Memory size()"
            value={String(storage.size(StorageScope.Memory))}
          />
        </Section>
        <Section title="Actions">
          <View style={styles.row}>
            <Button
              testID="util-wipe-memory"
              title="Wipe Memory"
              onPress={() => {
                storage.clear(StorageScope.Memory);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
            />
            <Button
              testID="util-wipe-disk"
              title="Wipe Disk"
              onPress={() => {
                storage.clear(StorageScope.Disk);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
            />
          </View>
          <Button
            testID="util-reset-all"
            title="Reset All"
            onPress={() => {
              storage.clearAll();
            }}
            variant="danger"
            size="sm"
          />
        </Section>
      </Card>

      {/* 9. Hooks */}
      <Card
        title="Hooks"
        subtitle="useStorage / useStorageSelector"
        indicatorColor={Colors.primary}
      >
        <StatusRow
          testID="hook-count-value"
          label="count"
          value={String(hookCount)}
        />
        <Button
          testID="hook-count-increment"
          title="+1"
          onPress={() => setHookCount(hookCount + 1)}
          style={styles.flex1}
        />
        <StatusRow
          testID="hook-label-value"
          label="label"
          value={hookLabel}
        />
        <Button
          testID="hook-label-change"
          title="Change Label"
          onPress={() => {
            const next = (hookLabelIdx + 1) % HOOK_LABELS.length;
            setHookLabelIdx(next);
            setHookLabel(HOOK_LABELS[next]!);
          }}
          variant="secondary"
        />
      </Card>

      {/* 10. Validation */}
      <Card
        title="Validation"
        subtitle="validate / onValidationError"
        indicatorColor={Colors.warning}
      >
        <Input
          testID="val-age-input"
          label="Age (13–120)"
          value={ageInput}
          onChangeText={setAgeInput}
          placeholder="Enter age"
          keyboardType="numeric"
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <Button
            testID="val-save"
            title="Save"
            onPress={() => {
              const n = Number(ageInput);
              if (Number.isFinite(n)) {
                ageItem.set(n);
              }
            }}
            style={styles.flex1}
          />
          <Button
            testID="val-inject"
            title="Inject Invalid"
            onPress={() => {
              runTransaction(StorageScope.Disk, (tx) => {
                tx.setRaw(ageItem.key, "-999");
              });
            }}
            variant="secondary"
            style={styles.flex1}
          />
        </View>
        <StatusRow
          testID="val-current"
          label="Current"
          value={String(age)}
          color={Colors.text}
        />
      </Card>

      {/* 11. TTL Expiration */}
      <Card
        title="TTL Expiration"
        subtitle="5-second TTL demo"
        indicatorColor={Colors.danger}
      >
        <View style={styles.row}>
          <Button
            testID="ttl-seed"
            title="Seed"
            onPress={() => {
              ttlItem.set(`session-${Date.now()}`);
              setTtlVal(ttlItem.get());
            }}
            style={styles.flex1}
          />
          <Button
            testID="ttl-refresh"
            title="Refresh"
            onPress={() => {
              setTtlVal(ttlItem.get());
            }}
            variant="secondary"
            style={styles.flex1}
          />
        </View>
        <StatusRow
          testID="ttl-value"
          label="Value"
          value={ttlVal || "(expired)"}
          color={ttlVal ? Colors.text : Colors.muted}
        />
      </Card>

      {/* 12. Transactions */}
      <Card
        title="Transactions"
        subtitle="runTransaction + rollback"
        indicatorColor={Colors.primary}
      >
        <StatusRow
          testID="tx-balance"
          label="Balance"
          value={String(balance)}
          color={Colors.text}
        />
        <StatusRow
          testID="tx-log"
          label="Last tx"
          value={txLog || "No log yet"}
        />
        <View style={styles.row}>
          <Button
            testID="tx-commit"
            title="Commit"
            onPress={() => {
              runTransaction(StorageScope.Memory, (tx) => {
                const cur = tx.getItem(balanceItem);
                tx.setItem(balanceItem, cur + 10);
                tx.setItem(
                  txLogItem,
                  `+10 at ${new Date().toLocaleTimeString()}`,
                );
              });
            }}
            style={styles.flex1}
          />
          <Button
            testID="tx-rollback"
            title="Rollback"
            onPress={() => {
              try {
                runTransaction(StorageScope.Memory, (tx) => {
                  tx.setItem(balanceItem, tx.getItem(balanceItem) - 25);
                  throw new Error("rollback-demo");
                });
              } catch {
                // intentional rollback
              }
            }}
            variant="danger"
            style={styles.flex1}
          />
        </View>
        <Button
          testID="tx-clear"
          title="Clear"
          onPress={() => {
            runTransaction(StorageScope.Memory, (tx) => {
              tx.removeItem(balanceItem);
              tx.removeItem(txLogItem);
            });
          }}
          variant="secondary"
          size="sm"
        />
      </Card>

      {/* 13. Migrations */}
      <Card
        title="Migrations"
        subtitle="registerMigration / migrateToLatest"
      >
        <View style={styles.row}>
          <Button
            testID="mig-seed"
            title="Seed Legacy"
            onPress={() => {
              migrationNameItem.set("legacy-user");
              setMigResult("Seeded");
            }}
            variant="secondary"
            style={styles.flex1}
          />
          <Button
            testID="mig-run"
            title="Run Migrations"
            onPress={() => {
              const v = ++migVer;
              registerMigration(v, ({ getRaw, setRaw }) => {
                const raw = getRaw(migrationNameItem.key);
                if (raw !== undefined) {
                  setRaw(migrationNameItem.key, raw.toUpperCase());
                }
              });
              migrateToLatest(StorageScope.Disk);
              setMigResult(migrationNameItem.get() || "(empty)");
            }}
            style={styles.flex1}
          />
        </View>
        <StatusRow
          testID="mig-result"
          label="Result"
          value={migResult}
        />
      </Card>

      {/* 14. Batch Operations */}
      <Card
        title="Batch Operations"
        subtitle="setBatch / getBatch / removeBatch"
        indicatorColor={Colors.primary}
      >
        <StatusRow
          testID="batch-v1"
          label="item 1"
          value={v1}
          color={Colors.primary}
        />
        <StatusRow
          testID="batch-v2"
          label="item 2"
          value={v2}
          color={Colors.primary}
        />
        <StatusRow
          testID="batch-v3"
          label="item 3"
          value={v3}
          color={Colors.primary}
        />
        <View style={styles.row}>
          <Button
            testID="batch-set"
            title="Batch Set"
            onPress={() => {
              const stamp = new Date().toLocaleTimeString();
              setBatch(
                [
                  { item: batch1, value: `A | ${stamp}` },
                  { item: batch2, value: `B | ${stamp}` },
                  { item: batch3, value: `C | ${stamp}` },
                ],
                StorageScope.Disk,
              );
            }}
            style={styles.flex1}
          />
          <Button
            testID="batch-get"
            title="Batch Get"
            onPress={() => {
              const values = getBatch(
                [batch1, batch2, batch3],
                StorageScope.Disk,
              );
              setBatchResponse(values.join("\n"));
            }}
            variant="success"
            style={styles.flex1}
          />
        </View>
        <Button
          testID="batch-remove"
          title="Batch Remove"
          onPress={() => {
            removeBatch([batch1, batch2, batch3], StorageScope.Disk);
            setBatchResponse(null);
          }}
          variant="secondary"
          size="sm"
        />
        {batchResponse ? (
          <CodeBlock testID="batch-response">{batchResponse}</CodeBlock>
        ) : null}
      </Card>

      {/* 15. Scope Control */}
      <Card
        title="Scope Control"
        subtitle="Key counts and clear"
        indicatorColor={Colors.danger}
      >
        <StatusRow
          testID="scope-disk-keys"
          label="Disk keys"
          value={String(storage.size(StorageScope.Disk))}
        />
        <StatusRow
          testID="scope-memory-keys"
          label="Memory keys"
          value={String(storage.size(StorageScope.Memory))}
        />
        <View style={styles.row}>
          <Button
            testID="scope-clear-disk"
            title="Clear Disk"
            onPress={() => {
              storage.clear(StorageScope.Disk);
            }}
            variant="secondary"
            size="sm"
            style={styles.flex1}
          />
          <Button
            testID="scope-clear-memory"
            title="Clear Memory"
            onPress={() => {
              storage.clear(StorageScope.Memory);
            }}
            variant="secondary"
            size="sm"
            style={styles.flex1}
          />
        </View>
        <Button
          testID="scope-reset-all"
          title="Reset All"
          onPress={() => {
            storage.clearAll();
          }}
          variant="danger"
          size="sm"
        />
      </Card>
    </Page>
  );
}

const s = StyleSheet.create({
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
  },
  toggleLabel: {
    color: Colors.text,
    fontWeight: "700",
    fontSize: 13,
  },
});
