import React, { useState } from "react";
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
  styles,
} from "../components/shared";

// Test atoms
const batchItem1 = createStorageItem({
  key: "batch-1",
  scope: StorageScope.Disk,
  defaultValue: "Empty 1",
});
const batchItem2 = createStorageItem({
  key: "batch-2",
  scope: StorageScope.Disk,
  defaultValue: "Empty 2",
});
const batchItem3 = createStorageItem({
  key: "batch-3",
  scope: StorageScope.Disk,
  defaultValue: "Empty 3",
});

export default function ToolsScreen() {
  const [val1] = useStorage(batchItem1);
  const [val2] = useStorage(batchItem2);
  const [val3] = useStorage(batchItem3);
  const [batchGetResult, setBatchGetResult] = useState<string | null>(null);

  return (
    <Page title="Tools" subtitle="System Maintenance">
      <Card
        title="Scope Control"
        subtitle="Danger Zone"
        indicatorColor={Colors.danger}
      >
        <View style={styles.grid}>
          <Button
            title="Wipe Memory"
            onPress={() => storage.clear(StorageScope.Memory)}
            variant="secondary"
            style={{ width: "48%" }}
            size="sm"
          />
          <Button
            title="Wipe Disk"
            onPress={() => storage.clear(StorageScope.Disk)}
            variant="secondary"
            style={{ width: "48%" }}
            size="sm"
          />
          <Button
            title="Wipe Secure"
            onPress={() => storage.clear(StorageScope.Secure)}
            variant="secondary"
            style={{ width: "48%" }}
            size="sm"
          />
          <Button
            title="Reset Everything"
            onPress={() => storage.clearAll()}
            variant="danger"
            style={{ width: "48%" }}
            size="sm"
          />
        </View>
      </Card>

      <Card
        title="Batch Operations"
        subtitle="Disk Scope"
        indicatorColor={Colors.primary}
      >
        <View style={{ gap: 8, marginBottom: 16 }}>
          {[val1, val2, val3].map((val, i) => (
            <View
              key={i}
              style={[
                styles.row,
                {
                  alignItems: "center",
                  backgroundColor: Colors.background,
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: Colors.border,
                },
              ]}
            >
              <Badge label={`ITEM ${i + 1}`} color={Colors.primary} />
              <Text
                style={{
                  color: Colors.text,
                  marginLeft: 12,
                  fontWeight: "500",
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
              const now = new Date().toLocaleTimeString();
              setBatch(
                [
                  { item: batchItem1, value: `Value A - ${now}` },
                  { item: batchItem2, value: `Value B - ${now}` },
                  { item: batchItem3, value: `Value C - ${now}` },
                ],
                StorageScope.Disk
              );
            }}
            variant="primary"
            style={styles.flex1}
          />
          <Button
            title="Batch Get"
            onPress={() => {
              const values = getBatch(
                [batchItem1, batchItem2, batchItem3],
                StorageScope.Disk
              );
              setBatchGetResult(values.join("\n"));
            }}
            variant="success"
            style={styles.flex1}
          />
        </View>

        <Button
          title="Batch Remove All"
          onPress={() => {
            removeBatch(
              [batchItem1, batchItem2, batchItem3],
              StorageScope.Disk
            );
            setBatchGetResult(null);
          }}
          variant="secondary"
          size="sm"
        />

        {batchGetResult && (
          <View
            style={{
              marginTop: 10,
              padding: 16,
              backgroundColor: Colors.surface,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Colors.success,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: Colors.success,
                fontWeight: "800",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Native Batch Response
            </Text>
            <Text
              style={{
                color: Colors.text,
                fontFamily: styles.codeText.fontFamily,
              }}
            >
              {batchGetResult}
            </Text>
          </View>
        )}
      </Card>
    </Page>
  );
}
