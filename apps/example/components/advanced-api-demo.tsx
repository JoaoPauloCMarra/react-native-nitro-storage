import { useState } from "react";
import { Platform, Text, View } from "react-native";
import {
  createIndexedDBBackend,
  diskItem,
  migrateFromMMKV,
  secureItem,
  useSetStorage,
  useStorageActions,
  useStorageValue,
} from "react-native-nitro-storage";
import { Button, Card, Colors, StatusRow, styles } from "./shared";

const secureDemoItem = secureItem<string>({
  key: "advanced-secure-demo",
  defaultValue: "",
  group: "advanced-api-demo",
});

const migrationDemoItem = diskItem<string>({
  key: "advanced-mmkv-demo",
  defaultValue: "",
});

function SecureItemCard() {
  const value = useStorageValue(secureDemoItem);
  const setValue = useSetStorage(secureDemoItem);
  const actions = useStorageActions(secureDemoItem);

  return (
    <Card
      title="Secure item and hooks"
      subtitle="secureItem / useSetStorage / useStorageActions"
      indicatorColor={Colors.secure}
    >
      <StatusRow
        testID="advanced-secure-value"
        label="secure value"
        value={value || "(empty)"}
      />
      <View style={styles.row}>
        <Button
          testID="advanced-secure-set"
          title="Set"
          onPress={() => {
            setValue("demo-secret");
          }}
          style={styles.flex1}
        />
        <Button
          testID="advanced-secure-reset"
          title="Reset"
          variant="secondary"
          onPress={actions.reset}
          style={styles.flex1}
        />
        <Button
          testID="advanced-secure-remove"
          title="Remove"
          variant="danger"
          onPress={actions.remove}
          style={styles.flex1}
        />
      </View>
    </Card>
  );
}

function MmkvMigrationCard() {
  const [status, setStatus] = useState("(not run)");

  const runMigration = () => {
    const legacyValues = new Map([[migrationDemoItem.key, "legacy-value"]]);
    const migrated = migrateFromMMKV(
      {
        getString: (key) => legacyValues.get(key),
        getNumber: () => undefined,
        getBoolean: () => undefined,
        contains: (key) => legacyValues.has(key),
        delete: (key) => {
          legacyValues.delete(key);
        },
        getAllKeys: () => Array.from(legacyValues.keys()),
      },
      migrationDemoItem,
      true,
    );

    setStatus(
      migrated
        ? `${migrationDemoItem.get()} (legacy key removed)`
        : "No legacy value found",
    );
  };

  return (
    <Card
      title="MMKV migration"
      subtitle="migrateFromMMKV with cleanup"
      indicatorColor={Colors.warning}
    >
      <StatusRow testID="advanced-mmkv-status" label="result" value={status} />
      <Button
        testID="advanced-mmkv-run"
        title="Migrate legacy value"
        onPress={runMigration}
      />
    </Card>
  );
}

function IndexedDbCard() {
  const [status, setStatus] = useState(
    Platform.OS === "web" ? "ready" : "web example only",
  );

  const runIndexedDbDemo = () => {
    if (Platform.OS !== "web") {
      setStatus("Run the web example to test IndexedDB");
      return;
    }

    void (async () => {
      try {
        const backend = await createIndexedDBBackend(
          "nitro-storage-example",
          "api-demo",
        );
        backend.setItem("example-key", "indexeddb-value");
        await backend.flush?.();
        const value = backend.getItem("example-key") ?? "(missing)";
        setStatus(`${backend.name ?? "IndexedDB"}: ${value}`);
        backend.close?.();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  return (
    <Card
      title="IndexedDB backend"
      subtitle="createIndexedDBBackend for web persistence"
      indicatorColor={Colors.accent}
    >
      <StatusRow
        testID="advanced-indexeddb-status"
        label="status"
        value={status}
      />
      <Button
        testID="advanced-indexeddb-run"
        title="Test IndexedDB backend"
        onPress={runIndexedDbDemo}
      />
    </Card>
  );
}

export function AdvancedApiDemo() {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Advanced public APIs</Text>
      <SecureItemCard />
      <MmkvMigrationCard />
      <IndexedDbCard />
    </View>
  );
}
