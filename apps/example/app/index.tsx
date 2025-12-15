import { ScrollView, View, Text } from "react-native";
import {
  createStorageItem,
  useStorage,
  StorageScope,
} from "react-native-nitro-storage";
import { Button, styles } from "../components/shared";

const memoryCounter = createStorageItem({
  key: "counter",
  scope: StorageScope.Memory,
  defaultValue: 0,
});

export default function MemoryDemo() {
  const [counter, setCounter] = useStorage(memoryCounter);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.indicator, { backgroundColor: "#EAB308" }]} />
            <Text style={styles.cardTitle}>Memory Storage</Text>
          </View>
          <Text style={styles.description}>
            Synchronous, in-memory state. Faster than Context. Persists only
            while the app is alive.
          </Text>

          <View style={styles.counterWrapper}>
            <Text style={styles.counterValue}>{counter}</Text>
            <View style={styles.counterControls}>
              <Button
                title="-"
                onPress={() => setCounter(counter - 1)}
                variant="danger"
                style={{ minWidth: 50 }}
              />
              <Button
                title="Reset"
                onPress={() => setCounter(0)}
                variant="secondary"
              />
              <Button
                title="+"
                onPress={() => setCounter(counter + 1)}
                variant="primary"
                style={{ minWidth: 50 }}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
