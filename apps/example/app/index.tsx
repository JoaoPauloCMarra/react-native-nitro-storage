import { useState } from "react";
import { View, Text } from "react-native";
import {
  createStorageItem,
  createSecureAuthStorage,
  useStorage,
  StorageScope,
  storage,
} from "react-native-nitro-storage";
import {
  Button,
  Page,
  Card,
  Colors,
  Input,
  Badge,
  Chip,
  StatusRow,
  CodeBlock,
  Section,
  styles,
} from "../components/shared";

// --- Storage items ---

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

// --- Screen ---

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
      subtitle="Ultra-fast native storage for React Native — powered by JSI"
    >
      {/* Memory */}
      <Card
        title="Memory Scope"
        subtitle="In-memory global state"
        indicatorColor={Colors.memory}
      >
        <View style={styles.row}>
          <Chip label="Synchronous" active color={Colors.memory} />
          <Chip label="Zero Bridge" active color={Colors.memory} />
        </View>

        <View
          style={{
            backgroundColor: Colors.background,
            borderRadius: 14,
            paddingVertical: 22,
            alignItems: "center",
            borderWidth: 1,
            borderColor: Colors.border,
          }}
        >
          <Text style={{ color: Colors.muted, fontSize: 11, marginBottom: 4 }}>
            COUNTER VALUE
          </Text>
          <Text
            style={{
              fontSize: 56,
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
            title="−"
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
            variant="primary"
            style={styles.flex1}
          />
        </View>
      </Card>

      {/* Disk */}
      <Card
        title="Disk Scope"
        subtitle="Persistent storage"
        indicatorColor={Colors.disk}
      >
        <Input
          label="Display Name"
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

      {/* Secure */}
      <Card
        title="Secure Scope"
        subtitle="Hardware encrypted"
        indicatorColor={Colors.secure}
      >
        <Input
          label="Secret Value"
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
            value={`${token.substring(0, 6)}••••`}
            color={Colors.secure}
          />
        ) : null}
      </Card>

      {/* Namespace */}
      <Card
        title="Namespaces"
        subtitle="Scoped key isolation"
        indicatorColor={Colors.purple}
      >
        <Text style={{ color: Colors.muted, fontSize: 13 }}>
          Keys are prefixed with a namespace separator. Isolated from
          non-namespaced keys.
        </Text>
        <Input
          label="Preference Value"
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
            title="Clear Namespace"
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
          color={Colors.purple}
        />
        <StatusRow label="Value" value={nsPref || "(empty)"} />
      </Card>

      {/* Complex Object */}
      <Card
        title="JSON Objects"
        subtitle="Type-safe serialization"
        indicatorColor={Colors.primary}
      >
        <View style={{ gap: 8 }}>
          <View
            style={[
              styles.row,
              {
                justifyContent: "space-between",
                backgroundColor: Colors.card,
                padding: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: Colors.border,
              },
            ]}
          >
            <Text style={{ color: Colors.text, fontWeight: "700" }}>Theme</Text>
            <Button
              title={config.theme.toUpperCase()}
              onPress={() => {
                setConfig((p) => ({
                  ...p,
                  theme: p.theme === "dark" ? "light" : "dark",
                }));
              }}
              variant="secondary"
              size="sm"
            />
          </View>
          <View
            style={[
              styles.row,
              {
                justifyContent: "space-between",
                backgroundColor: Colors.card,
                padding: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: Colors.border,
              },
            ]}
          >
            <Text style={{ color: Colors.text, fontWeight: "700" }}>
              Notifications
            </Text>
            <Button
              title={config.notifications ? "ON" : "OFF"}
              onPress={() => {
                setConfig((p) => ({ ...p, notifications: !p.notifications }));
              }}
              variant={config.notifications ? "success" : "secondary"}
              size="sm"
            />
          </View>
        </View>
        <CodeBlock>{JSON.stringify(config, null, 2)}</CodeBlock>
      </Card>

      {/* createSecureAuthStorage */}
      <Card
        title="Auth Storage Factory"
        subtitle="createSecureAuthStorage"
        indicatorColor={Colors.secure}
      >
        <Text style={{ color: Colors.muted, fontSize: 13 }}>
          One-liner factory for multiple encrypted tokens with TTL and biometric
          support.
        </Text>
        <View style={styles.row}>
          <Button
            title="Set Tokens"
            onPress={() => {
              authTokens.accessToken.set(`at_${Date.now().toString(36)}`);
              authTokens.refreshToken.set(`rt_${Date.now().toString(36)}`);
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
        <StatusRow
          label="accessToken"
          value={atValue || "(empty)"}
          color={atValue ? Colors.secure : undefined}
        />
        <StatusRow
          label="refreshToken"
          value={rtValue || "(empty)"}
          color={rtValue ? Colors.secure : undefined}
        />
        <View style={styles.row}>
          <Badge label="Secure Scope" color={Colors.secure} />
          <Badge label="60s TTL" color={Colors.warning} />
          <Badge label={`ns: auth`} color={Colors.purple} />
        </View>
      </Card>

      {/* Storage Utilities */}
      <Card title="Storage Utilities" subtitle="Introspection helpers">
        <Section title="Disk">
          <StatusRow
            label="size()"
            value={String(storage.size(StorageScope.Disk))}
          />
          <StatusRow
            label="getAllKeys()"
            value={
              storage.getAllKeys(StorageScope.Disk).slice(0, 5).join(", ") ||
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
            label="getAllKeys()"
            value={
              storage.getAllKeys(StorageScope.Memory).slice(0, 5).join(", ") ||
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
