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

const diskUsername = createStorageItem({
  key: "username",
  scope: StorageScope.Disk,
  defaultValue: "",
});

export default function DiskDemo() {
  const [username, setUsername] = useStorage(diskUsername);
  const [tempUsername, setTempUsername] = useState("");
  const canSave = tempUsername.trim().length > 0;

  return (
    <Page title="Disk" subtitle="MMKV-style Persistence">
      <Card
        title="User Settings"
        subtitle="Scope: Disk"
        indicatorColor={Colors.disk}
      >
        <Text style={{ fontSize: 14, color: Colors.muted }}>
          Persisted to platform-native storage (UserDefaults/SharedPreferences).
          Survives app restarts.
        </Text>

        <Input
          label="Display Name"
          value={tempUsername}
          onChangeText={setTempUsername}
          placeholder="Enter a display name"
          autoCapitalize="words"
        />
        <Text style={{ color: Colors.muted, fontSize: 12 }}>
          Persisted across app restarts.
        </Text>

        <View style={styles.row}>
          <Button
            title="Save to Disk"
            onPress={() => {
              setUsername(tempUsername.trim());
              setTempUsername("");
            }}
            style={styles.flex1}
            disabled={!canSave}
          />
          <Button
            title="Delete"
            variant="danger"
            onPress={() => {
              diskUsername.delete();
            }}
          />
        </View>

        {username ? (
          <View
            style={{
              marginTop: 10,
              padding: 16,
              backgroundColor: Colors.disk + "15",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: Colors.disk + "30",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                color: Colors.disk,
                fontWeight: "800",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              Stored on Device
            </Text>
            <Text
              style={{ fontSize: 18, color: Colors.text, fontWeight: "600" }}
            >
              {username}
            </Text>
          </View>
        ) : (
          <View
            style={{
              marginTop: 10,
              padding: 16,
              backgroundColor: Colors.border,
              borderRadius: 16,
              borderStyle: "dashed",
              borderWidth: 1,
              borderColor: Colors.muted + "40",
            }}
          >
            <Text
              style={{ fontSize: 14, color: Colors.muted, textAlign: "center" }}
            >
              No data stored yet
            </Text>
          </View>
        )}
      </Card>

      <Card title="Performance">
        <Text style={{ color: Colors.muted }}>• Read: ~0.08ms</Text>
        <Text style={{ color: Colors.muted }}>• Write: ~0.10ms</Text>
      </Card>
    </Page>
  );
}
