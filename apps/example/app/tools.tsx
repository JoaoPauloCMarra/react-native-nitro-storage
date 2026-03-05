import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  createStorageItem,
  getBatch,
  removeBatch,
  setBatch,
  storage,
  StorageScope,
  useStorage,
} from "react-native-nitro-storage";
import {
  Badge,
  Button,
  Card,
  Colors,
  Page,
  Section,
  StatusRow,
  styles,
} from "../components/shared";

const batch1 = createStorageItem({
  key: "batch-1",
  scope: StorageScope.Disk,
  defaultValue: "-",
});
const batch2 = createStorageItem({
  key: "batch-2",
  scope: StorageScope.Disk,
  defaultValue: "-",
});
const batch3 = createStorageItem({
  key: "batch-3",
  scope: StorageScope.Disk,
  defaultValue: "-",
});

export default function ToolsScreen() {
  const [v1] = useStorage(batch1);
  const [v2] = useStorage(batch2);
  const [v3] = useStorage(batch3);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [secureWritesAsync, setSecureWritesAsync] = useState(false);

  const setSecureWriteMode = (enabled: boolean) => {
    storage.setSecureWritesAsync(enabled);
    setSecureWritesAsync(enabled);
  };

  return (
    <Page title="Tools" subtitle="Batch ops, maintenance, and runtime controls">
      <Card
        title="Batch Operations"
        subtitle="Disk scope"
        indicatorColor={Colors.primary}
      >
        <View style={styles.panel}>
          <StatusRow label="item 1" value={v1} color={Colors.primary} testID="tools-batch-v1" />
          <StatusRow label="item 2" value={v2} color={Colors.primary} testID="tools-batch-v2" />
          <StatusRow label="item 3" value={v3} color={Colors.primary} testID="tools-batch-v3" />
        </View>

        <View style={styles.row}>
          <Button
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
            testID="tools-batch-set"
          />
          <Button
            title="Batch Get"
            onPress={() => {
              const values = getBatch(
                [batch1, batch2, batch3],
                StorageScope.Disk,
              );
              setBatchResult(values.join("\n"));
            }}
            variant="success"
            style={styles.flex1}
            testID="tools-batch-get"
          />
        </View>

        <Button
          title="Batch Remove"
          onPress={() => {
            removeBatch([batch1, batch2, batch3], StorageScope.Disk);
            setBatchResult(null);
          }}
          variant="secondary"
          size="sm"
          testID="tools-batch-remove"
        />

        {batchResult ? (
          <View style={s.resultBlock}>
            <Text style={s.resultTitle}>Batch response</Text>
            <Text style={styles.codeText}>{batchResult}</Text>
          </View>
        ) : null}
      </Card>

      <Card
        title="Secure Write Mode"
        subtitle="Android commit/apply control"
        indicatorColor={Colors.secure}
      >
        <Text style={styles.helperText}>
          On Android, sync mode uses commit() and async mode uses apply(). On
          iOS and web, this call is a safe no-op.
        </Text>

        <View style={styles.row}>
          <Button
            title="Sync"
            onPress={() => {
              setSecureWriteMode(false);
            }}
            variant={secureWritesAsync ? "secondary" : "success"}
            style={styles.flex1}
            testID="tools-write-sync"
          />
          <Button
            title="Async"
            onPress={() => {
              setSecureWriteMode(true);
            }}
            variant={secureWritesAsync ? "success" : "secondary"}
            style={styles.flex1}
            testID="tools-write-async"
          />
        </View>

        <StatusRow
          label="Current mode"
          value={secureWritesAsync ? "Async (apply)" : "Sync (commit)"}
          color={Colors.secure}
          testID="tools-write-mode"
        />
        <Badge
          label={
            Platform.OS === "android"
              ? "Android active"
              : "No-op on this platform"
          }
          color={Platform.OS === "android" ? Colors.success : Colors.warning}
        />
      </Card>

      <Card
        title="Scope Control"
        subtitle="Danger zone"
        indicatorColor={Colors.danger}
      >
        <Section title="Clear individual scopes">
          <View style={styles.grid}>
            <Button
              title="Memory"
              onPress={() => {
                storage.clear(StorageScope.Memory);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
              testID="tools-clear-memory"
            />
            <Button
              title="Disk"
              onPress={() => {
                storage.clear(StorageScope.Disk);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
              testID="tools-clear-disk"
            />
            <Button
              title="Secure"
              onPress={() => {
                storage.clear(StorageScope.Secure);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
              testID="tools-clear-secure"
            />
          </View>
        </Section>

        <Button
          title="Reset Everything"
          onPress={() => {
            storage.clearAll();
          }}
          variant="danger"
          size="sm"
          testID="tools-reset-all"
        />

        <Section title="Introspection">
          <StatusRow
            label="Disk keys"
            value={String(storage.size(StorageScope.Disk))}
            testID="tools-disk-keys"
          />
          <StatusRow
            label="Memory keys"
            value={String(storage.size(StorageScope.Memory))}
            testID="tools-memory-keys"
          />
          <StatusRow
            label="Secure keys"
            value={String(storage.size(StorageScope.Secure))}
            testID="tools-secure-keys"
          />
        </Section>
      </Card>
    </Page>
  );
}

const s = StyleSheet.create({
  resultBlock: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${Colors.success}66`,
    padding: 12,
    gap: 6,
  },
  resultTitle: {
    color: Colors.success,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
