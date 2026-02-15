import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  createStorageItem,
  migrateFromMMKV,
  migrateToLatest,
  registerMigration,
  runTransaction,
  StorageScope,
  useSetStorage,
  useStorage,
  useStorageSelector,
} from "react-native-nitro-storage";
import {
  Badge,
  Button,
  Card,
  Colors,
  Input,
  Page,
  styles,
} from "../components/shared";

type HookState = {
  count: number;
  label: string;
};

type CustomCodecValue = {
  id: string;
  enabled: boolean;
};

type FakeMMKVValue = string | number | boolean;
type FakeMMKVLike = {
  getString: (key: string) => string | undefined;
  getNumber: (key: string) => number | undefined;
  getBoolean: (key: string) => boolean | undefined;
  contains: (key: string) => boolean;
  delete: (key: string) => void;
  getAllKeys: () => string[];
};

const hookStateItem = createStorageItem<HookState>({
  key: "features-hook-state",
  scope: StorageScope.Memory,
  defaultValue: { count: 0, label: "Ready" },
});

const validatedAgeItem = createStorageItem<number>({
  key: "features-validated-age",
  scope: StorageScope.Disk,
  defaultValue: 21,
  validate: (value): value is number =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 13 &&
    value <= 120,
  onValidationError: () => 21,
});

const ttlSessionItem = createStorageItem<string>({
  key: "features-ttl-session",
  scope: StorageScope.Disk,
  defaultValue: "",
  expiration: { ttlMs: 5000 },
});

const transactionBalanceItem = createStorageItem<number>({
  key: "features-transaction-balance",
  scope: StorageScope.Disk,
  defaultValue: 100,
});

const transactionLogItem = createStorageItem<string>({
  key: "features-transaction-log",
  scope: StorageScope.Disk,
  defaultValue: "No log yet",
});

const migrationNameItem = createStorageItem<string>({
  key: "features-migration-name",
  scope: StorageScope.Disk,
  defaultValue: "legacy-user",
  serialize: (value) => value,
  deserialize: (value) => value,
});

const migrationMarkerItem = createStorageItem<string>({
  key: "features-migration-marker",
  scope: StorageScope.Disk,
  defaultValue: "pending",
  serialize: (value) => value,
  deserialize: (value) => value,
});

const mmkvTargetItem = createStorageItem<string>({
  key: "features-mmkv-target",
  scope: StorageScope.Disk,
  defaultValue: "",
  serialize: (value) => value,
  deserialize: (value) => value,
});

const customCodecItem = createStorageItem<CustomCodecValue>({
  key: "features-custom-codec",
  scope: StorageScope.Disk,
  defaultValue: { id: "item-1", enabled: false },
  serialize: (value) => `${value.id}::${value.enabled ? "1" : "0"}`,
  deserialize: (value) => {
    const [id, enabledFlag] = value.split("::");
    return {
      id: id || "item-1",
      enabled: enabledFlag === "1",
    };
  },
});

const cachedReadItem = createStorageItem<string>({
  key: "features-read-cache-on",
  scope: StorageScope.Disk,
  defaultValue: "",
  readCache: true,
});

const uncachedReadItem = createStorageItem<string>({
  key: "features-read-cache-off",
  scope: StorageScope.Disk,
  defaultValue: "",
});

const secureBurstItem = createStorageItem<string>({
  key: "features-secure-burst",
  scope: StorageScope.Secure,
  defaultValue: "",
  coalesceSecureWrites: true,
});

export default function FeaturesDemo() {
  const [hookState] = useStorage(hookStateItem);
  const setHookState = useSetStorage(hookStateItem);
  const [selectedCount] = useStorageSelector(hookStateItem, (state) => state.count);

  const [age] = useStorage(validatedAgeItem);
  const [ageInput, setAgeInput] = useState(String(age));
  const [validationStatus, setValidationStatus] = useState("Ready");

  const [ttlValue, setTtlValue] = useState(() => ttlSessionItem.get());
  const [ttlStatus, setTtlStatus] = useState("No value stored");

  const [balance] = useStorage(transactionBalanceItem);
  const [transactionLog] = useStorage(transactionLogItem);
  const [transactionStatus, setTransactionStatus] = useState("No transaction yet");

  const [migrationStatus, setMigrationStatus] = useState("No migrations executed");
  const migrationVersionRef = useRef(20_000);

  const [mmkvStatus, setMmkvStatus] = useState("Fake MMKV is empty");
  const [mmkvValue] = useStorage(mmkvTargetItem);
  const fakeMMKVStore = useRef<Map<string, FakeMMKVValue>>(new Map());
  const fakeMMKV = useMemo<FakeMMKVLike>(
    () => ({
      getString: (key) => {
        const value = fakeMMKVStore.current.get(key);
        return typeof value === "string" ? value : undefined;
      },
      getNumber: (key) => {
        const value = fakeMMKVStore.current.get(key);
        return typeof value === "number" ? value : undefined;
      },
      getBoolean: (key) => {
        const value = fakeMMKVStore.current.get(key);
        return typeof value === "boolean" ? value : undefined;
      },
      contains: (key) => fakeMMKVStore.current.has(key),
      delete: (key) => {
        fakeMMKVStore.current.delete(key);
      },
      getAllKeys: () => Array.from(fakeMMKVStore.current.keys()),
    }),
    []
  );

  const [customCodecValue, setCustomCodecValue] = useStorage(customCodecItem);
  const [customCodecId, setCustomCodecId] = useState(customCodecValue.id);

  const [secureBurstValue, setSecureBurstValue] = useStorage(secureBurstItem);
  const [secureInput, setSecureInput] = useState("");

  const [readCacheResult, setReadCacheResult] = useState("Run benchmark to compare");

  const saveValidatedAge = () => {
    const parsedValue = Number(ageInput);
    if (!Number.isFinite(parsedValue)) {
      setValidationStatus("Enter a valid number");
      return;
    }

    try {
      validatedAgeItem.set(parsedValue);
      setValidationStatus(`Saved ${parsedValue}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationStatus(message);
    }
  };

  const injectInvalidAge = () => {
    runTransaction(StorageScope.Disk, (tx) => {
      tx.setRaw(validatedAgeItem.key, "-999");
    });
    setValidationStatus(
      `Injected invalid raw value, recovered to ${validatedAgeItem.get()}`
    );
  };

  const seedTtlValue = () => {
    ttlSessionItem.set(`session-${Date.now()}`);
    setTtlValue(ttlSessionItem.get());
    setTtlStatus("Saved for 5 seconds");
  };

  const refreshTtl = () => {
    const currentValue = ttlSessionItem.get();
    setTtlValue(currentValue);
    setTtlStatus(currentValue ? "Still active" : "Expired and reset to default");
  };

  const runCommittedTransaction = () => {
    runTransaction(StorageScope.Disk, (tx) => {
      const current = tx.getItem(transactionBalanceItem);
      tx.setItem(transactionBalanceItem, current + 10);
      tx.setItem(transactionLogItem, `+10 at ${new Date().toLocaleTimeString()}`);
      tx.setRaw("features-transaction-meta", String(Date.now()));
    });
    setTransactionStatus("Committed +10 transaction");
  };

  const runRollbackTransaction = () => {
    try {
      runTransaction(StorageScope.Disk, (tx) => {
        const current = tx.getItem(transactionBalanceItem);
        tx.setItem(transactionBalanceItem, current - 25);
        tx.setRaw("features-transaction-meta", "rollback");
        throw new Error("rollback-demo");
      });
    } catch {
      setTransactionStatus("Rollback triggered, persisted values unchanged");
    }
  };

  const clearTransactionLog = () => {
    runTransaction(StorageScope.Disk, (tx) => {
      tx.removeItem(transactionLogItem);
      tx.removeRaw("features-transaction-meta");
    });
    setTransactionStatus("Removed transaction log");
  };

  const seedMigrationValues = () => {
    migrationNameItem.set("legacy-user");
    migrationMarkerItem.set("pending");
    setMigrationStatus("Seeded legacy values");
  };

  const runMigrationDemo = () => {
    const v1 = migrationVersionRef.current + 1;
    const v2 = migrationVersionRef.current + 2;
    migrationVersionRef.current = v2;

    registerMigration(v1, ({ getRaw, setRaw }) => {
      const rawName = getRaw(migrationNameItem.key);
      if (rawName !== undefined) {
        setRaw(migrationNameItem.key, rawName.toUpperCase());
      }
    });

    registerMigration(v2, ({ setRaw }) => {
      setRaw(migrationMarkerItem.key, `migrated-v${v2}`);
    });

    const applied = migrateToLatest(StorageScope.Disk);
    setMigrationStatus(
      `Applied v${applied}: ${migrationNameItem.get()} / ${migrationMarkerItem.get()}`
    );
  };

  const seedFakeMMKV = () => {
    fakeMMKVStore.current.set(mmkvTargetItem.key, "legacy-mmkv-value");
    setMmkvStatus("Seeded fake MMKV with a string value");
  };

  const runMmkvMigration = () => {
    const migrated = migrateFromMMKV(fakeMMKV, mmkvTargetItem, true);
    const stillInMMKV = fakeMMKV.contains(mmkvTargetItem.key);
    setMmkvStatus(
      migrated
        ? `Migrated to Nitro Storage (deleteFromMMKV=true, stillInMMKV=${stillInMMKV})`
        : "No matching key found in fake MMKV"
    );
  };

  const runReadCacheComparison = () => {
    const payload = `value-${Date.now()}`;
    cachedReadItem.set(payload);
    uncachedReadItem.set(payload);

    const loops = 30_000;

    const cachedStart = performance.now();
    for (let index = 0; index < loops; index += 1) {
      cachedReadItem.get();
    }
    const cachedMs = performance.now() - cachedStart;

    const uncachedStart = performance.now();
    for (let index = 0; index < loops; index += 1) {
      uncachedReadItem.get();
    }
    const uncachedMs = performance.now() - uncachedStart;

    setReadCacheResult(
      `readCache=true: ${cachedMs.toFixed(2)}ms | readCache=false: ${uncachedMs.toFixed(2)}ms`
    );
  };

  const runSecureBurst = () => {
    const base = secureInput || "secure";
    secureBurstItem.set(`${base}-1`);
    secureBurstItem.set(`${base}-2`);
    secureBurstItem.set(`${base}-3`);
  };

  return (
    <Page title="Features" subtitle="Complete API Playground">
      <Card title="Hooks" subtitle="useStorage / useSetStorage / useStorageSelector">
        <Text style={{ color: Colors.muted }}>
          Selected count: {selectedCount} | label: {hookState.label}
        </Text>
        <View style={styles.row}>
          <Button
            title="Count +1"
            onPress={() =>
              setHookState((prev) => ({ ...prev, count: prev.count + 1 }))
            }
            style={styles.flex1}
          />
          <Button
            title="Change Label"
            onPress={() =>
              setHookState((prev) => ({
                ...prev,
                label: `label-${Date.now().toString().slice(-4)}`,
              }))
            }
            variant="secondary"
            style={styles.flex1}
          />
        </View>
      </Card>

      <Card title="Validation + Fallback" subtitle="validate / onValidationError">
        <Input
          label="Age (13-120)"
          value={ageInput}
          onChangeText={setAgeInput}
          placeholder="Type an age"
          keyboardType="numeric"
        />
        <View style={styles.row}>
          <Button title="Save Age" onPress={saveValidatedAge} style={styles.flex1} />
          <Button
            title="Inject Invalid Raw"
            onPress={injectInvalidAge}
            variant="secondary"
            style={styles.flex1}
          />
        </View>
        <Text style={{ color: Colors.text, fontWeight: "700" }}>Current: {age}</Text>
        <Text style={{ color: Colors.muted }}>{validationStatus}</Text>
      </Card>

      <Card title="TTL Expiration" subtitle="expiration.ttlMs (lazy read)">
        <Text style={{ color: Colors.text, fontWeight: "700" }}>
          Value: {ttlValue || "(expired/default)"}
        </Text>
        <Text style={{ color: Colors.muted }}>{ttlStatus}</Text>
        <View style={styles.row}>
          <Button title="Seed 5s Value" onPress={seedTtlValue} style={styles.flex1} />
          <Button
            title="Refresh Read"
            onPress={refreshTtl}
            variant="secondary"
            style={styles.flex1}
          />
        </View>
      </Card>

      <Card title="Transactions" subtitle="runTransaction + rollback">
        <Text style={{ color: Colors.text, fontWeight: "700" }}>
          Balance: {balance}
        </Text>
        <Text style={{ color: Colors.muted }}>Log: {transactionLog}</Text>
        <View style={styles.row}>
          <Button
            title="Commit +10"
            onPress={runCommittedTransaction}
            style={styles.flex1}
          />
          <Button
            title="Rollback Demo"
            onPress={runRollbackTransaction}
            variant="danger"
            style={styles.flex1}
          />
        </View>
        <Button
          title="Clear Log (removeItem/removeRaw)"
          onPress={clearTransactionLog}
          variant="secondary"
        />
        <Text style={{ color: Colors.muted }}>{transactionStatus}</Text>
      </Card>

      <Card title="Migrations" subtitle="registerMigration / migrateToLatest">
        <View style={styles.row}>
          <Button
            title="Seed Legacy Values"
            onPress={seedMigrationValues}
            variant="secondary"
            style={styles.flex1}
          />
          <Button
            title="Run New Migrations"
            onPress={runMigrationDemo}
            style={styles.flex1}
          />
        </View>
        <Text style={{ color: Colors.muted }}>{migrationStatus}</Text>
      </Card>

      <Card title="MMKV Migration" subtitle="migrateFromMMKV">
        <View style={styles.row}>
          <Button
            title="Seed Fake MMKV"
            onPress={seedFakeMMKV}
            variant="secondary"
            style={styles.flex1}
          />
          <Button
            title="Run Migration"
            onPress={runMmkvMigration}
            style={styles.flex1}
          />
        </View>
        <Text style={{ color: Colors.text, fontWeight: "700" }}>
          Target value: {mmkvValue || "(empty)"}
        </Text>
        <Text style={{ color: Colors.muted }}>{mmkvStatus}</Text>
      </Card>

      <Card title="Advanced Config" subtitle="custom codec / readCache / coalesced secure writes">
        <View style={styles.row}>
          <Badge
            label={customCodecValue.enabled ? "ENABLED" : "DISABLED"}
            color={customCodecValue.enabled ? Colors.success : Colors.warning}
          />
          <Text style={{ color: Colors.text, fontWeight: "700" }}>
            id: {customCodecValue.id}
          </Text>
        </View>
        <Input
          label="Custom Codec ID"
          value={customCodecId}
          onChangeText={setCustomCodecId}
          placeholder="Set custom id"
        />
        <View style={styles.row}>
          <Button
            title="Save Codec Value"
            onPress={() =>
              setCustomCodecValue((prev) => ({ ...prev, id: customCodecId || "item-1" }))
            }
            style={styles.flex1}
          />
          <Button
            title="Toggle Enabled"
            onPress={() =>
              setCustomCodecValue((prev) => ({ ...prev, enabled: !prev.enabled }))
            }
            variant="secondary"
            style={styles.flex1}
          />
        </View>
        <Button
          title="Run readCache comparison"
          onPress={runReadCacheComparison}
          variant="ghost"
        />
        <Text style={{ color: Colors.muted }}>{readCacheResult}</Text>
        <Input
          label="Secure Burst Base"
          value={secureInput}
          onChangeText={setSecureInput}
          placeholder="Optional base text"
        />
        <View style={styles.row}>
          <Button
            title="Single Secure Set"
            onPress={() => setSecureBurstValue(secureInput || "secure")}
            variant="secondary"
            style={styles.flex1}
          />
          <Button title="Burst x3" onPress={runSecureBurst} style={styles.flex1} />
        </View>
        <Text style={{ color: Colors.muted }}>Secure value: {secureBurstValue || "(empty)"}</Text>
      </Card>
    </Page>
  );
}
