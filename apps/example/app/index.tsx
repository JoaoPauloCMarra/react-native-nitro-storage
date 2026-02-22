import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  createSecureAuthStorage,
  createStorageItem,
  storage,
  StorageScope,
  useStorage,
} from "react-native-nitro-storage";
import {
  Badge,
  Button,
  Card,
  Chip,
  CodeBlock,
  Colors,
  Input,
  Page,
  Section,
  StatusRow,
  styles,
} from "../components/shared";

const memoryCounter = createStorageItem({
  key: "counter",
  scope: StorageScope.Memory,
  defaultValue: 0,
});

const diskUsername = createStorageItem({
  key: "username",
  scope: StorageScope.Disk,
  defaultValue: "",
});

const secureToken = createStorageItem({
  key: "auth-token",
  scope: StorageScope.Secure,
  defaultValue: "",
});

const namespacedItem = createStorageItem({
  key: "user-pref",
  scope: StorageScope.Disk,
  defaultValue: "",
  namespace: "settings",
});

type AppConfig = {
  theme: "dark" | "light";
  notifications: boolean;
};

const configItem = createStorageItem<AppConfig>({
  key: "app-config",
  scope: StorageScope.Disk,
  defaultValue: { theme: "dark", notifications: true },
});

const authTokens = createSecureAuthStorage({
  accessToken: { ttlMs: 60_000 },
  refreshToken: {},
});

export default function ShowcaseScreen() {
  const [counter, setCounter] = useStorage(memoryCounter);
  const [username, setUsername] = useStorage(diskUsername);
  const [token, setToken] = useStorage(secureToken);
  const [nsPref, setNsPref] = useStorage(namespacedItem);
  const [config, setConfig] = useStorage(configItem);
  const [tempName, setTempName] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [tempPref, setTempPref] = useState("");
  const [atValue] = useStorage(authTokens.accessToken);
  const [rtValue] = useStorage(authTokens.refreshToken);

  return (
    <Page
      title="Nitro Storage"
      subtitle="Synchronous memory, disk, and secure storage with a single API"
    >
      <Card
        title="Quick Snapshot"
        subtitle="Runtime overview"
        indicatorColor={Colors.primary}
      >
        <View style={styles.row}>
          <Chip label="JSI Native Path" active color={Colors.primary} />
          <Chip label="No Async Await" active color={Colors.primary} />
          <Chip label="Type Safe" active color={Colors.primary} />
        </View>
      </Card>

      <Card
        title="Memory Scope"
        subtitle="In-memory global state"
        indicatorColor={Colors.memory}
      >
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Counter value</Text>
          <Text style={styles.panelValue}>{counter}</Text>
        </View>

        <View style={styles.row}>
          <Button
            title="-"
            onPress={() => {
              setCounter(counter - 1);
            }}
            variant="danger"
            style={styles.flex1}
          />
          <Button
            title="Reset"
            onPress={() => {
              setCounter(0);
            }}
            variant="secondary"
            style={styles.flex1}
          />
          <Button
            title="+"
            onPress={() => {
              setCounter(counter + 1);
            }}
            style={styles.flex1}
          />
        </View>
      </Card>

      <Card
        title="Disk Scope"
        subtitle="Persistent storage"
        indicatorColor={Colors.disk}
      >
        <Input
          label="Display name"
          value={tempName}
          onChangeText={setTempName}
          placeholder="Enter a name"
          autoCapitalize="words"
        />
        <View style={styles.row}>
          <Button
            title="Save"
            onPress={() => {
              setUsername(tempName.trim());
              setTempName("");
            }}
            style={styles.flex1}
            disabled={!tempName.trim()}
          />
          <Button
            title="Delete"
            variant="danger"
            onPress={() => {
              diskUsername.delete();
            }}
          />
        </View>
        <StatusRow
          label="Stored"
          value={username || "(empty)"}
          color={username ? Colors.disk : Colors.muted}
        />
        <StatusRow
          label="has()"
          value={String(diskUsername.has())}
          color={diskUsername.has() ? Colors.success : Colors.muted}
        />
      </Card>

      <Card
        title="Secure Scope"
        subtitle="Hardware encrypted"
        indicatorColor={Colors.secure}
      >
        <Input
          label="Secret value"
          value={tempToken}
          onChangeText={setTempToken}
          placeholder="Paste a token or secret"
          secureTextEntry
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <Button
            title="Lock"
            onPress={() => {
              setToken(tempToken.trim());
              setTempToken("");
            }}
            variant="success"
            style={styles.flex1}
            disabled={!tempToken.trim()}
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
          <StatusRow
            label="Encrypted"
            value={`${token.slice(0, 6)}....`}
            color={Colors.secure}
          />
        ) : null}
      </Card>

      <Card
        title="Namespaces"
        subtitle="Scoped key isolation"
        indicatorColor={Colors.accent}
      >
        <Text style={styles.helperText}>
          Namespace prefixes keep feature keys isolated without manual key
          naming.
        </Text>
        <Input
          label="Preference value"
          value={tempPref}
          onChangeText={setTempPref}
          placeholder="Set a namespaced value"
        />
        <View style={styles.row}>
          <Button
            title="Save"
            onPress={() => {
              setNsPref(tempPref.trim());
              setTempPref("");
            }}
            style={styles.flex1}
            disabled={!tempPref.trim()}
          />
          <Button
            title="Clear namespace"
            variant="secondary"
            onPress={() => {
              storage.clearNamespace("settings", StorageScope.Disk);
            }}
            style={styles.flex1}
          />
        </View>
        <StatusRow
          label="Key"
          value={namespacedItem.key}
          color={Colors.accent}
        />
        <StatusRow label="Value" value={nsPref || "(empty)"} />
      </Card>

      <Card
        title="JSON Objects"
        subtitle="Typed serialization"
        indicatorColor={Colors.primary}
      >
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Theme</Text>
          <Button
            title={config.theme.toUpperCase()}
            onPress={() => {
              setConfig((prev) => ({
                ...prev,
                theme: prev.theme === "dark" ? "light" : "dark",
              }));
            }}
            variant="secondary"
            size="sm"
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Notifications</Text>
          <Button
            title={config.notifications ? "ON" : "OFF"}
            onPress={() => {
              setConfig((prev) => ({
                ...prev,
                notifications: !prev.notifications,
              }));
            }}
            variant={config.notifications ? "success" : "secondary"}
            size="sm"
          />
        </View>
        <CodeBlock>{JSON.stringify(config, null, 2)}</CodeBlock>
      </Card>

      <Card
        title="Auth Storage Factory"
        subtitle="createSecureAuthStorage"
        indicatorColor={Colors.secure}
      >
        <Text style={styles.helperText}>
          Multi-token secure storage with TTL support in one factory call.
        </Text>
        <View style={styles.row}>
          <Button
            title="Set Tokens"
            onPress={() => {
              const now = Date.now().toString(36);
              authTokens.accessToken.set(`at_${now}`);
              authTokens.refreshToken.set(`rt_${now}`);
            }}
            style={styles.flex1}
          />
          <Button
            title="Clear"
            variant="danger"
            onPress={() => {
              authTokens.accessToken.delete();
              authTokens.refreshToken.delete();
            }}
          />
        </View>
        <StatusRow label="accessToken" value={atValue || "(empty)"} />
        <StatusRow label="refreshToken" value={rtValue || "(empty)"} />
        <View style={styles.row}>
          <Badge label="Secure" color={Colors.secure} />
          <Badge label="TTL 60s" color={Colors.warning} />
          <Badge label="Namespace auth" color={Colors.accent} />
        </View>
      </Card>

      <Card title="Storage Utilities" subtitle="Introspection helpers">
        <Section title="Disk">
          <StatusRow
            label="size()"
            value={String(storage.size(StorageScope.Disk))}
          />
          <StatusRow
            label="keys"
            value={
              storage.getAllKeys(StorageScope.Disk).slice(0, 4).join(", ") ||
              "(none)"
            }
          />
        </Section>

        <Section title="Memory">
          <StatusRow
            label="size()"
            value={String(storage.size(StorageScope.Memory))}
          />
          <StatusRow
            label="keys"
            value={
              storage.getAllKeys(StorageScope.Memory).slice(0, 4).join(", ") ||
              "(none)"
            }
          />
        </Section>

        <Section title="Actions">
          <View style={styles.grid}>
            <Button
              title="Wipe Memory"
              onPress={() => {
                storage.clear(StorageScope.Memory);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
            />
            <Button
              title="Wipe Disk"
              onPress={() => {
                storage.clear(StorageScope.Disk);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
            />
          </View>
          <Button
            title="Reset Everything"
            onPress={() => {
              storage.clearAll();
            }}
            variant="danger"
            size="sm"
          />
        </Section>
      </Card>
    </Page>
  );
}

const s = StyleSheet.create({
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
  },
  toggleLabel: {
    color: Colors.text,
    fontWeight: "700",
    fontSize: 13,
  },
});
