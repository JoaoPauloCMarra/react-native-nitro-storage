import { useRef, useState } from "react";
import { View } from "react-native";
import {
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
  useStorageSelector,
} from "react-native-nitro-storage";
import { configItem } from "./home-scope-cards";
import {
  Button,
  Card,
  CodeBlock,
  Colors,
  Input,
  StatusRow,
  styles,
} from "./shared";

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
  validate: (v): v is number => typeof v === "number" && v >= 13 && v <= 120,
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

const HOOK_LABELS = ["initial", "alpha", "beta", "gamma", "delta"];

export function HooksCard() {
  const [hookCount, setHookCount] = useStorage(hookCountItem);
  const [hookLabel, setHookLabel] = useStorage(hookLabelItem);
  const [hookLabelIdx, setHookLabelIdx] = useState(0);
  const [selectedTheme] = useStorageSelector(configItem, (c) => c.theme);

  return (
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
        onPress={() => {
          setHookCount(hookCount + 1);
        }}
        style={styles.flex1}
      />
      <StatusRow testID="hook-label-value" label="label" value={hookLabel} />
      <Button
        testID="hook-label-change"
        title="Change Label"
        onPress={() => {
          const next = (hookLabelIdx + 1) % HOOK_LABELS.length;
          setHookLabelIdx(next);
          setHookLabel(HOOK_LABELS[next]);
        }}
        variant="secondary"
      />
      <StatusRow
        testID="hook-selected-theme"
        label="selector(theme)"
        value={selectedTheme}
      />
    </Card>
  );
}

export function ValidationCard() {
  const [age] = useStorage(ageItem);
  const [ageInput, setAgeInput] = useState(String(age));
  const ageInputRef = useRef(String(age));

  return (
    <Card
      title="Validation"
      subtitle="validate / onValidationError"
      indicatorColor={Colors.warning}
    >
      <Input
        testID="val-age-input"
        label="Age (13–120)"
        value={ageInput}
        onChangeText={(t) => {
          ageInputRef.current = t;
          setAgeInput(t);
        }}
        placeholder="Enter age"
        keyboardType="numeric"
        autoCapitalize="none"
      />
      <View style={styles.row}>
        <Button
          testID="val-save"
          title="Save"
          onPress={() => {
            const n = Number(ageInputRef.current);
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
  );
}

export function TtlCard() {
  const [ttlVal, setTtlVal] = useState(() => ttlItem.get());

  return (
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
  );
}

export function TransactionsCard() {
  const [balance] = useStorage(balanceItem);
  const [txLog] = useStorage(txLogItem);

  return (
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
              txLogItem.set("Rollback restored previous balance");
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
  );
}

export function MigrationsCard() {
  const [migResult, setMigResult] = useState("(not run)");

  return (
    <Card title="Migrations" subtitle="registerMigration / migrateToLatest">
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
            const current = migrateToLatest(StorageScope.Disk);
            registerMigration(current + 1, ({ getRaw, setRaw }) => {
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
      <StatusRow testID="mig-result" label="Result" value={migResult} />
    </Card>
  );
}

export function BatchCard() {
  const [v1] = useStorage(batch1);
  const [v2] = useStorage(batch2);
  const [v3] = useStorage(batch3);
  const [batchResponse, setBatchResponse] = useState<string | null>(null);

  return (
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
  );
}

export function RawStringCard() {
  const [rawValue, setRawValue] = useState<string | undefined>();

  return (
    <Card
      title="Raw String API"
      subtitle="getString / setString / deleteString"
      indicatorColor={Colors.accent}
    >
      <View style={styles.row}>
        <Button
          testID="raw-set"
          title="Set"
          onPress={() => {
            storage.setString("raw-demo", "hello-world", StorageScope.Memory);
            setRawValue(
              storage.getString("raw-demo", StorageScope.Memory) ?? undefined,
            );
          }}
          style={styles.flex1}
        />
        <Button
          testID="raw-delete"
          title="Delete"
          variant="danger"
          onPress={() => {
            storage.deleteString("raw-demo", StorageScope.Memory);
            setRawValue(undefined);
          }}
        />
      </View>
      <StatusRow
        testID="raw-value"
        label="Value"
        value={rawValue ?? "(empty)"}
        color={rawValue ? Colors.text : Colors.muted}
      />
    </Card>
  );
}

export function PrefixKeysCard() {
  const [prefixKeys, setPrefixKeys] = useState<string[]>([]);
  const [allMemoryKeys, setAllMemoryKeys] = useState<string[]>([]);

  return (
    <Card
      title="Prefix & Keys"
      subtitle="getAllKeys / getKeysByPrefix"
      indicatorColor={Colors.primary}
    >
      <Button
        testID="prefix-seed"
        title="Seed Keys"
        onPress={() => {
          storage.setString("pfx_a", "1", StorageScope.Memory);
          storage.setString("pfx_b", "2", StorageScope.Memory);
          storage.setString("pfx_c", "3", StorageScope.Memory);
          setAllMemoryKeys(storage.getAllKeys(StorageScope.Memory));
          setPrefixKeys(storage.getKeysByPrefix("pfx_", StorageScope.Memory));
        }}
      />
      <StatusRow
        testID="prefix-count"
        label="Prefix keys (pfx_)"
        value={String(prefixKeys.length)}
      />
      <StatusRow
        testID="all-keys-count"
        label="All memory keys"
        value={String(allMemoryKeys.length)}
      />
      <Button
        testID="prefix-refresh"
        title="Refresh Counts"
        variant="secondary"
        size="sm"
        onPress={() => {
          setAllMemoryKeys(storage.getAllKeys(StorageScope.Memory));
          setPrefixKeys(storage.getKeysByPrefix("pfx_", StorageScope.Memory));
        }}
      />
    </Card>
  );
}
