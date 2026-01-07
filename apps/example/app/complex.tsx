import { View, Text } from "react-native";
import {
  createStorageItem,
  useStorage,
  StorageScope,
} from "react-native-nitro-storage";
import { Button, Page, Card, Colors, styles } from "../components/shared";

interface Settings {
  theme: "dark" | "light";
  notifications: boolean;
  lastLogin: string;
}

const complexSettings = createStorageItem<Settings>({
  key: "app-settings",
  scope: StorageScope.Disk,
  defaultValue: {
    theme: "dark",
    notifications: true,
    lastLogin: new Date().toISOString(),
  },
});

export default function ComplexDemo() {
  const [settings, setSettings] = useStorage(complexSettings);

  const toggleTheme = () => {
    setSettings((prev) => ({
      ...prev,
      theme: prev.theme === "dark" ? "light" : "dark",
    }));
  };

  const toggleNotifications = () => {
    setSettings((prev) => ({
      ...prev,
      notifications: !prev.notifications,
    }));
  };

  return (
    <Page title="Objects" subtitle="Type-safe Complex State">
      <Card
        title="Configuration"
        subtitle="JSON Persistence"
        indicatorColor={Colors.primary}
      >
        <Text style={{ fontSize: 14, color: Colors.muted }}>
          Nitro Storage automatically serializes and deserializes complex JSON
          objects with full TypeScript inference.
        </Text>

        <View style={{ gap: 12, marginTop: 10 }}>
          <View
            style={[
              styles.row,
              {
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: Colors.border,
                padding: 16,
                borderRadius: 16,
              },
            ]}
          >
            <Text style={{ color: Colors.text, fontWeight: "700" }}>Theme</Text>
            <Button
              title={settings.theme.toUpperCase()}
              onPress={toggleTheme}
              variant="secondary"
              size="sm"
            />
          </View>

          <View
            style={[
              styles.row,
              {
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: Colors.border,
                padding: 16,
                borderRadius: 16,
              },
            ]}
          >
            <Text style={{ color: Colors.text, fontWeight: "700" }}>
              Notifications
            </Text>
            <Button
              title={settings.notifications ? "ENABLED" : "DISABLED"}
              onPress={toggleNotifications}
              variant={settings.notifications ? "success" : "secondary"}
              size="sm"
            />
          </View>
        </View>

        <View
          style={{
            marginTop: 10,
            padding: 16,
            backgroundColor: "#000",
            borderRadius: 16,
            borderWidth: 1,
            borderColor: Colors.border,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              color: Colors.primary,
              fontWeight: "800",
              marginBottom: 8,
            }}
          >
            JSON PREVIEW
          </Text>
          <Text
            style={{
              fontFamily: styles.codeText.fontFamily,
              color: Colors.muted,
              fontSize: 13,
            }}
          >
            {JSON.stringify(settings, null, 2)}
          </Text>
        </View>

        <Button
          title="Reset Defaults"
          onPress={() => complexSettings.delete()}
          variant="ghost"
          style={{ marginTop: 8 }}
        />
      </Card>
    </Page>
  );
}
