import { useState } from "react";
import { View, Text } from "react-native";
import {
  storage,
  StorageScope,
  createStorageItem,
  getBatch,
  setBatch,
  removeBatch,
  useStorage,
} from "react-native-nitro-storage";
import {
  Button,
  Page,
  Card,
  Colors,
  Badge,
  StatusRow,
  Section,
  styles,
} from "../components/shared";

const batch1 = createStorageItem({
  key: "batch-1",
  scope: StorageScope.Disk,
  defaultValue: "—",
});
const batch2 = createStorageItem({
  key: "batch-2",
  scope: StorageScope.Disk,
  defaultValue: "—",
});
const batch3 = createStorageItem({
  key: "batch-3",
  scope: StorageScope.Disk,
  defaultValue: "—",
});

export default function ToolsScreen() {
  const [v1] = useStorage(batch1);
  const [v2] = useStorage(batch2);
  const [v3] = useStorage(batch3);
  const [batchResult, setBatchResult] = useState<string | null>(null);

  return (
    <Page title="Tools" subtitle="Batch ops & system maintenance">
      {/* Batch */}
      <Card
        title="Batch Operations"
        subtitle="Disk scope"
        indicatorColor={Colors.primary}
      >
        <View style={{ gap: 6 }}>
          {[v1, v2, v3].map((val, i) => (
            <View
              key={i}
              style={[
                styles.row,
                {
                  backgroundColor: Colors.background,
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: Colors.border,
                },
              ]}
            >
              <Badge label={`ITEM ${i + 1}`} color={Colors.primary} />
              <Text
                style={{
                  color: Colors.text,
                  marginLeft: 10,
                  fontWeight: "500",
                  flex: 1,
                }}
              >
                {val}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.row}>
          <Button
            title="Batch Set"
            onPress={() => {
              const t = new Date().toLocaleTimeString();
              setBatch(
                [
                  { item: batch1, value: `A — ${t}` },
                  { item: batch2, value: `B — ${t}` },
                  { item: batch3, value: `C — ${t}` },
                ],
                StorageScope.Disk,
              );
            }}
            style={styles.flex1}
          />
          <Button
            title="Batch Get"
            onPress={() => {
              const vals = getBatch(
                [batch1, batch2, batch3],
                StorageScope.Disk,
              );
              setBatchResult(vals.join("\n"));
            }}
            variant="success"
            style={styles.flex1}
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
        />

        {batchResult ? (
          <View
            style={{
              padding: 14,
              backgroundColor: Colors.card,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: Colors.success + "40",
            }}
          >
            <Text
              style={{
                fontSize: 11,
                color: Colors.success,
                fontWeight: "800",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Batch Response
            </Text>
            <Text style={[styles.codeText, { color: Colors.text }]}>
              {batchResult}
            </Text>
          </View>
        ) : null}
      </Card>

      {/* Scope Control */}
      <Card
        title="Scope Control"
        subtitle="Danger zone"
        indicatorColor={Colors.danger}
      >
        <Section title="Clear Individual Scopes">
          <View style={styles.grid}>
            <Button
              title="Memory"
              onPress={() => {
                storage.clear(StorageScope.Memory);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
            />
            <Button
              title="Disk"
              onPress={() => {
                storage.clear(StorageScope.Disk);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
            />
            <Button
              title="Secure"
              onPress={() => {
                storage.clear(StorageScope.Secure);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
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
        />

        <Section title="Introspection">
          <StatusRow
            label="Disk keys"
            value={String(storage.size(StorageScope.Disk))}
          />
          <StatusRow
            label="Memory keys"
            value={String(storage.size(StorageScope.Memory))}
          />
        </Section>
      </Card>
    </Page>
  );
}
