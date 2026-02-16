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
  Chip,
  Colors,
  Input,
  Page,
  StatusRow,
  styles,
} from "../components/shared";

// --- Items ---

type HookState = { count: number; label: string };

const hookItem = createStorageItem<HookState>({
  key: "ft-hook",
  scope: StorageScope.Memory,
  defaultValue: { count: 0, label: "Ready" },
});

const validatedAge = createStorageItem<number>({
  key: "ft-age",
  scope: StorageScope.Disk,
  defaultValue: 21,
  validate: (v): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 13 && v <= 120,
  onValidationError: () => 21,
});

const ttlItem = createStorageItem<string>({
  key: "ft-ttl",
  scope: StorageScope.Disk,
  defaultValue: "",
  expiration: { ttlMs: 5000 },
  onExpired: () => {},
});

const txBalance = createStorageItem<number>({
  key: "ft-tx-bal",
  scope: StorageScope.Disk,
  defaultValue: 100,
});

const txLog = createStorageItem<string>({
  key: "ft-tx-log",
  scope: StorageScope.Disk,
  defaultValue: "No log yet",
});

const migName = createStorageItem<string>({
  key: "ft-mig-name",
  scope: StorageScope.Disk,
  defaultValue: "legacy-user",
  serialize: (v) => v,
  deserialize: (v) => v,
});

const migMarker = createStorageItem<string>({
  key: "ft-mig-mark",
  scope: StorageScope.Disk,
  defaultValue: "pending",
  serialize: (v) => v,
  deserialize: (v) => v,
});

type FakeMMKV = {
  getString: (key: string) => string | undefined;
  getNumber: (key: string) => number | undefined;
  getBoolean: (key: string) => boolean | undefined;
  contains: (key: string) => boolean;
  delete: (key: string) => void;
  getAllKeys: () => string[];
};

const mmkvTarget = createStorageItem<string>({
  key: "ft-mmkv",
  scope: StorageScope.Disk,
  defaultValue: "",
  serialize: (v) => v,
  deserialize: (v) => v,
});

type CodecVal = { id: string; enabled: boolean };

const codecItem = createStorageItem<CodecVal>({
  key: "ft-codec",
  scope: StorageScope.Disk,
  defaultValue: { id: "item-1", enabled: false },
  serialize: (v) => `${v.id}::${v.enabled ? "1" : "0"}`,
  deserialize: (v) => {
    const [id, flag] = v.split("::");
    return { id: id || "item-1", enabled: flag === "1" };
  },
});

const cachedRead = createStorageItem<string>({
  key: "ft-cache-on",
  scope: StorageScope.Disk,
  defaultValue: "",
  readCache: true,
});

const uncachedRead = createStorageItem<string>({
  key: "ft-cache-off",
  scope: StorageScope.Disk,
  defaultValue: "",
});

const secureBurst = createStorageItem<string>({
  key: "ft-secure-burst",
  scope: StorageScope.Secure,
  defaultValue: "",
  coalesceSecureWrites: true,
});

// --- Screen ---

export default function FeaturesScreen() {
  const [hookState] = useStorage(hookItem);
  const setHook = useSetStorage(hookItem);
  const [selectedCount] = useStorageSelector(hookItem, (s) => s.count);

  const [age] = useStorage(validatedAge);
  const [ageInput, setAgeInput] = useState(String(age));
  const [valStatus, setValStatus] = useState("Ready");

  const [ttlVal, setTtlVal] = useState(() => ttlItem.get());
  const [ttlStatus, setTtlStatus] = useState("No value");

  const [balance] = useStorage(txBalance);
  const [log] = useStorage(txLog);
  const [txStatus, setTxStatus] = useState("No transaction yet");

  const [migStatus, setMigStatus] = useState("No migrations");
  const migVer = useRef(20_000);

  const [mmkvStatus, setMmkvStatus] = useState("Empty");
  const [mmkvVal] = useStorage(mmkvTarget);
  const fakeStore = useRef<Map<string, string | number | boolean>>(new Map());
  const fakeMMKV = useMemo<FakeMMKV>(
    () => ({
      getString: (k) => {
        const v = fakeStore.current.get(k);
        return typeof v === "string" ? v : undefined;
      },
      getNumber: (k) => {
        const v = fakeStore.current.get(k);
        return typeof v === "number" ? v : undefined;
      },
      getBoolean: (k) => {
        const v = fakeStore.current.get(k);
        return typeof v === "boolean" ? v : undefined;
      },
      contains: (k) => fakeStore.current.has(k),
      delete: (k) => {
        fakeStore.current.delete(k);
      },
      getAllKeys: () => Array.from(fakeStore.current.keys()),
    }),
    [],
  );

  const [codecVal, setCodecVal] = useStorage(codecItem);
  const [codecId, setCodecId] = useState(codecVal.id);

  const [burstVal, setBurstVal] = useStorage(secureBurst);
  const [secInput, setSecInput] = useState("");

  const [cacheResult, setCacheResult] = useState("Run to compare");

  return (
    <Page title="Features" subtitle="Full API playground">
      {/* Hooks */}
      <Card
        title="Hooks"
        subtitle="useStorage / useSetStorage / useStorageSelector"
      >
        <View style={styles.row}>
          <Chip
            label={`count: ${selectedCount}`}
            active
            color={Colors.primary}
          />
          <Chip label={hookState.label} active={false} />
        </View>
        <View style={styles.row}>
          <Button
            title="Count +1"
            onPress={() => {
              setHook((p) => ({ ...p, count: p.count + 1 }));
            }}
            style={styles.flex1}
          />
          <Button
            title="Change Label"
            onPress={() => {
              setHook((p) => ({
                ...p,
                label: `lbl-${Date.now().toString().slice(-4)}`,
              }));
            }}
            variant="secondary"
            style={styles.flex1}
          />
        </View>
      </Card>

      {/* Validation */}
      <Card
        title="Validation"
        subtitle="validate / onValidationError"
        indicatorColor={Colors.warning}
      >
        <Input
          label="Age (13–120)"
          value={ageInput}
          onChangeText={setAgeInput}
          placeholder="Enter age"
          keyboardType="numeric"
        />
        <View style={styles.row}>
          <Button
            title="Save"
            onPress={() => {
              const n = Number(ageInput);
              if (!Number.isFinite(n)) {
                setValStatus("Invalid number");
                return;
              }
              try {
                validatedAge.set(n);
                setValStatus(`Saved ${n}`);
              } catch (e) {
                setValStatus(String(e));
              }
            }}
            style={styles.flex1}
          />
          <Button
            title="Inject Invalid"
            onPress={() => {
              runTransaction(StorageScope.Disk, (tx) => {
                tx.setRaw(validatedAge.key, "-999");
              });
              setValStatus(
                `Injected invalid → recovered to ${validatedAge.get()}`,
              );
            }}
            variant="secondary"
            style={styles.flex1}
          />
        </View>
        <StatusRow label="Current" value={String(age)} color={Colors.text} />
        <Text style={{ color: Colors.muted, fontSize: 12 }}>{valStatus}</Text>
      </Card>

      {/* TTL */}
      <Card
        title="TTL Expiration"
        subtitle="expiration.ttlMs + onExpired"
        indicatorColor={Colors.danger}
      >
        <View style={styles.row}>
          <Badge label="5s TTL" color={Colors.danger} />
          <Badge label="Lazy Read" color={Colors.muted} />
        </View>
        <View style={styles.row}>
          <Button
            title="Seed 5s Value"
            onPress={() => {
              ttlItem.set(`session-${Date.now()}`);
              setTtlVal(ttlItem.get());
              setTtlStatus("Stored — expires in 5s");
            }}
            style={styles.flex1}
          />
          <Button
            title="Refresh"
            onPress={() => {
              const v = ttlItem.get();
              setTtlVal(v);
              setTtlStatus(v ? "Still active" : "Expired → default");
            }}
            variant="secondary"
            style={styles.flex1}
          />
        </View>
        <StatusRow
          label="Value"
          value={ttlVal || "(expired)"}
          color={ttlVal ? Colors.text : Colors.muted}
        />
        <Text style={{ color: Colors.muted, fontSize: 12 }}>{ttlStatus}</Text>
      </Card>

      {/* Transactions */}
      <Card
        title="Transactions"
        subtitle="runTransaction + rollback"
        indicatorColor={Colors.primary}
      >
        <StatusRow
          label="Balance"
          value={String(balance)}
          color={Colors.text}
        />
        <StatusRow label="Log" value={log} />
        <View style={styles.row}>
          <Button
            title="Commit +10"
            onPress={() => {
              runTransaction(StorageScope.Disk, (tx) => {
                const cur = tx.getItem(txBalance);
                tx.setItem(txBalance, cur + 10);
                tx.setItem(txLog, `+10 at ${new Date().toLocaleTimeString()}`);
              });
              setTxStatus("Committed +10");
            }}
            style={styles.flex1}
          />
          <Button
            title="Rollback"
            onPress={() => {
              try {
                runTransaction(StorageScope.Disk, (tx) => {
                  tx.setItem(txBalance, tx.getItem(txBalance) - 25);
                  throw new Error("rollback-demo");
                });
              } catch {
                setTxStatus("Rolled back — values unchanged");
              }
            }}
            variant="danger"
            style={styles.flex1}
          />
        </View>
        <Button
          title="Clear Log"
          onPress={() => {
            runTransaction(StorageScope.Disk, (tx) => {
              tx.removeItem(txLog);
            });
            setTxStatus("Cleared");
          }}
          variant="secondary"
          size="sm"
        />
        <Text style={{ color: Colors.muted, fontSize: 12 }}>{txStatus}</Text>
      </Card>

      {/* Migrations */}
      <Card title="Migrations" subtitle="registerMigration / migrateToLatest">
        <View style={styles.row}>
          <Button
            title="Seed Legacy"
            onPress={() => {
              migName.set("legacy-user");
              migMarker.set("pending");
              setMigStatus("Seeded");
            }}
            variant="secondary"
            style={styles.flex1}
          />
          <Button
            title="Run Migrations"
            onPress={() => {
              const v1 = migVer.current + 1;
              const v2 = migVer.current + 2;
              migVer.current = v2;
              registerMigration(v1, ({ getRaw, setRaw }) => {
                const raw = getRaw(migName.key);
                if (raw !== undefined) setRaw(migName.key, raw.toUpperCase());
              });
              registerMigration(v2, ({ setRaw }) => {
                setRaw(migMarker.key, `migrated-v${v2}`);
              });
              const applied = migrateToLatest(StorageScope.Disk);
              setMigStatus(
                `Applied v${applied}: ${migName.get()} / ${migMarker.get()}`,
              );
            }}
            style={styles.flex1}
          />
        </View>
        <Text style={{ color: Colors.muted, fontSize: 12 }}>{migStatus}</Text>
      </Card>

      {/* MMKV Migration */}
      <Card title="MMKV Migration" subtitle="migrateFromMMKV">
        <View style={styles.row}>
          <Button
            title="Seed Fake MMKV"
            onPress={() => {
              fakeStore.current.set(mmkvTarget.key, "legacy-mmkv-value");
              setMmkvStatus("Seeded");
            }}
            variant="secondary"
            style={styles.flex1}
          />
          <Button
            title="Migrate"
            onPress={() => {
              const ok = migrateFromMMKV(fakeMMKV, mmkvTarget, true);
              setMmkvStatus(
                ok
                  ? `Migrated (removed from MMKV=${!fakeMMKV.contains(mmkvTarget.key)})`
                  : "No key found",
              );
            }}
            style={styles.flex1}
          />
        </View>
        <StatusRow label="Target" value={mmkvVal || "(empty)"} />
        <Text style={{ color: Colors.muted, fontSize: 12 }}>{mmkvStatus}</Text>
      </Card>

      {/* Custom Codec */}
      <Card
        title="Custom Codec"
        subtitle="serialize / deserialize"
        indicatorColor={Colors.purple}
      >
        <View style={styles.row}>
          <Badge
            label={codecVal.enabled ? "ENABLED" : "DISABLED"}
            color={codecVal.enabled ? Colors.success : Colors.warning}
          />
          <Text style={{ color: Colors.text, fontWeight: "700" }}>
            id: {codecVal.id}
          </Text>
        </View>
        <Input
          label="ID"
          value={codecId}
          onChangeText={setCodecId}
          placeholder="Custom id"
        />
        <View style={styles.row}>
          <Button
            title="Save"
            onPress={() => {
              setCodecVal((p) => ({ ...p, id: codecId || "item-1" }));
            }}
            style={styles.flex1}
          />
          <Button
            title="Toggle"
            onPress={() => {
              setCodecVal((p) => ({ ...p, enabled: !p.enabled }));
            }}
            variant="secondary"
            style={styles.flex1}
          />
        </View>
      </Card>

      {/* readCache / coalesced writes */}
      <Card title="Advanced Config" subtitle="readCache / coalesceSecureWrites">
        <Button
          title="readCache Benchmark"
          onPress={() => {
            const payload = `v-${Date.now()}`;
            cachedRead.set(payload);
            uncachedRead.set(payload);
            const loops = 30_000;
            const t1 = performance.now();
            for (let i = 0; i < loops; i++) cachedRead.get();
            const cached = performance.now() - t1;
            const t2 = performance.now();
            for (let i = 0; i < loops; i++) uncachedRead.get();
            const uncached = performance.now() - t2;
            setCacheResult(
              `cached: ${cached.toFixed(1)}ms | uncached: ${uncached.toFixed(1)}ms`,
            );
          }}
          variant="ghost"
        />
        <Text style={{ color: Colors.muted, fontSize: 12 }}>{cacheResult}</Text>

        <Input
          label="Secure Burst Base"
          value={secInput}
          onChangeText={setSecInput}
          placeholder="Optional text"
        />
        <View style={styles.row}>
          <Button
            title="Single Set"
            onPress={() => {
              setBurstVal(secInput || "secure");
            }}
            variant="secondary"
            style={styles.flex1}
          />
          <Button
            title="Burst ×3"
            onPress={() => {
              const b = secInput || "secure";
              secureBurst.set(`${b}-1`);
              secureBurst.set(`${b}-2`);
              secureBurst.set(`${b}-3`);
            }}
            style={styles.flex1}
          />
        </View>
        <StatusRow label="Secure value" value={burstVal || "(empty)"} />
      </Card>
    </Page>
  );
}
