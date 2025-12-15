import { useState } from "react";
import { ScrollView, View, Text, TextInput } from "react-native";
import {
  createStorageItem,
  useStorage,
  StorageScope,
} from "react-native-nitro-storage";
import { Button, styles } from "../components/shared";

const diskUsername = createStorageItem({
  key: "username",
  scope: StorageScope.Disk,
  defaultValue: "",
});

export default function DiskDemo() {
  const [username, setUsername] = useStorage(diskUsername);
  const [tempUsername, setTempUsername] = useState("");

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.indicator, { backgroundColor: "#3B82F6" }]} />
            <Text style={styles.cardTitle}>Disk Storage</Text>
          </View>
          <Text style={styles.description}>
            Persisted to disk (MMKV-style).
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={styles.input}
              value={tempUsername}
              onChangeText={setTempUsername}
              placeholder="johndoe"
              placeholderTextColor="#52525B"
            />
            <Button
              title="Save to Disk"
              onPress={() => {
                setUsername(tempUsername);
                setTempUsername("");
              }}
            />
            {username ? (
              <View style={styles.resultBadge}>
                <Text style={styles.resultLabel}>Current Value</Text>
                <Text style={styles.resultText}>{username}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
