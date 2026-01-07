import { View, Text } from "react-native";
import {
  createStorageItem,
  useStorage,
  StorageScope,
} from "react-native-nitro-storage";
import { Button, Page, Card, Colors, styles } from "../components/shared";

const memoryCounter = createStorageItem({
  key: "counter",
  scope: StorageScope.Memory,
  defaultValue: 0,
});

export default function MemoryDemo() {
  const [counter, setCounter] = useStorage(memoryCounter);

  return (
    <Page title="Memory" subtitle="Pure JS Global State">
      <Card
        title="State Controller"
        subtitle="Scope: Memory"
        indicatorColor={Colors.memory}
      >
        <Text style={{ fontSize: 14, color: Colors.muted, lineHeight: 20 }}>
          Synchronous, in-memory state. Faster than React Context & Redux.
          Supports any JS object including functions and JSX.
        </Text>

        <View
          style={{
            backgroundColor: Colors.background,
            borderRadius: 20,
            padding: 40,
            alignItems: "center",
            borderWidth: 1,
            borderColor: Colors.border,
            marginVertical: 10,
          }}
        >
          <Text
            style={{
              fontSize: 80,
              fontWeight: "900",
              color: Colors.text,
              fontVariant: ["tabular-nums"],
            }}
          >
            {counter}
          </Text>
        </View>

        <View style={styles.row}>
          <Button
            title="-"
            onPress={() => setCounter(counter - 1)}
            variant="danger"
            style={styles.flex1}
          />
          <Button
            title="Reset"
            onPress={() => setCounter(0)}
            variant="secondary"
            style={styles.flex1}
          />
          <Button
            title="+"
            onPress={() => setCounter(counter + 1)}
            variant="primary"
            style={styles.flex1}
          />
        </View>
      </Card>

      <Card title="Quick Tips">
        <Text style={{ color: Colors.muted }}>
          • Updates are synchronous via JSI
        </Text>
        <Text style={{ color: Colors.muted }}>• Zero bridge overhead</Text>
        <Text style={{ color: Colors.muted }}>
          • Use for ephemeral global state
        </Text>
      </Card>
    </Page>
  );
}
