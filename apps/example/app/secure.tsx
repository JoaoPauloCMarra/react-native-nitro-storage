import { useState } from "react";
import { View, Text } from "react-native";
import {
  createStorageItem,
  useStorage,
  StorageScope,
} from "react-native-nitro-storage";
import {
  Button,
  Page,
  Card,
  Colors,
  Input,
  styles,
} from "../components/shared";

const secureToken = createStorageItem({
  key: "auth-token",
  scope: StorageScope.Secure,
  defaultValue: "",
});

export default function SecureDemo() {
  const [token, setToken] = useStorage(secureToken);
  const [tempToken, setTempToken] = useState("");
  const canStore = tempToken.trim().length > 0;

  return (
    <Page title="Secure" subtitle="Hardware Encrypted">
      <Card
        title="Security Vault"
        subtitle="Scope: Secure"
        indicatorColor={Colors.secure}
      >
        <Text style={{ fontSize: 14, color: Colors.muted }}>
          Encrypted with AES-256 GCM. Stored in iOS Keychain or Android
          EncryptedSharedPreferences.
        </Text>

        <Input
          label="Secret Token"
          value={tempToken}
          onChangeText={setTempToken}
          placeholder="Paste sensitive value"
          secureTextEntry
          autoCapitalize="none"
        />
        <Text style={{ color: Colors.muted, fontSize: 12 }}>
          Stored in encrypted platform key storage.
        </Text>

        <View style={styles.row}>
          <Button
            title="Lock in Vault"
            onPress={() => {
              setToken(tempToken.trim());
              setTempToken("");
            }}
            variant="success"
            style={styles.flex1}
            disabled={!canStore}
          />
          <Button
            title="Wipe"
            variant="danger"
            onPress={() => {
              secureToken.delete();
            }}
          />
        </View>

        {token ? (
          <View
            style={{
              marginTop: 10,
              padding: 16,
              backgroundColor: Colors.secure + "15",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Colors.secure + "30",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: Colors.secure,
                fontWeight: "800",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              Encrypted Value
            </Text>
            <Text
              style={{ fontSize: 18, color: Colors.text, fontWeight: "600" }}
            >
              ••••••••••••••••
            </Text>
            <Text style={{ fontSize: 12, color: Colors.muted, marginTop: 4 }}>
              Raw: {token.substring(0, 4)}...
            </Text>
          </View>
        ) : null}
      </Card>

      <Card title="Security Info">
        <Text style={{ color: Colors.muted }}>
          • Hardware-backed encryption
        </Text>
        <Text style={{ color: Colors.muted }}>
          • Biometric-ready (Coming soon)
        </Text>
        <Text style={{ color: Colors.muted }}>• No plain text on disk</Text>
      </Card>
    </Page>
  );
}
