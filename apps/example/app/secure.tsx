import { useState } from "react";
import { ScrollView, View, Text, TextInput } from "react-native";
import {
  createStorageItem,
  useStorage,
  StorageScope,
} from "react-native-nitro-storage";
import { Button, styles } from "../components/shared";

const secureToken = createStorageItem({
  key: "auth-token",
  scope: StorageScope.Secure,
  defaultValue: "",
});

export default function SecureDemo() {
  const [token, setToken] = useStorage(secureToken);
  const [tempToken, setTempToken] = useState("");

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.indicator, { backgroundColor: "#10B981" }]} />
            <Text style={styles.cardTitle}>Secure Storage</Text>
          </View>
          <Text style={styles.description}>
            Encrypted Keychain/Keystore storage.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Auth Token</Text>
            <TextInput
              style={styles.input}
              value={tempToken}
              onChangeText={setTempToken}
              placeholder="secret_token_123"
              placeholderTextColor="#52525B"
              secureTextEntry
            />
            <Button
              title="Save Securely"
              onPress={() => {
                setToken(tempToken);
                setTempToken("");
              }}
            />
            {token ? (
              <View style={[styles.resultBadge, { borderColor: "#10B981" }]}>
                <Text style={[styles.resultLabel, { color: "#10B981" }]}>
                  Stored Encrypted
                </Text>
                <Text style={styles.resultText}>
                  {token.substring(0, 8)}••••••••
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
