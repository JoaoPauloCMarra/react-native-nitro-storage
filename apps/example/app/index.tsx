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

const namespacedAuthTokens = createSecureAuthStorage(
  { accessToken: {}, refreshToken: {} },
  { namespace: "example-auth" },
);

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
  const [nsAtValue] = useStorage(namespacedAuthTokens.accessToken);
  const [nsRtValue] = useStorage(namespacedAuthTokens.refreshToken);

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
          <Text testID="counter-value" style={styles.panelValue}>{counter}</Text>
        </View>

        <View style={styles.row}>
          <Button
            testID="counter-decrement"
            title="-"
            onPress={() => {
              setCounter(counter - 1);
            }}
            variant="danger"
            style={styles.flex1}
          />
          <Button
            testID="counter-reset"
            title="Reset"
            onPress={() => {
              setCounter(0);
            }}
            variant="secondary"
            style={styles.flex1}
          />
          <Button
            testID="counter-increment"
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
          testID="disk-name-input"
          label="Display name"
          value={tempName}
          onChangeText={setTempName}
          placeholder="Enter a name"
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <Button
            testID="disk-save"
            title="Save"
            onPress={() => {
              setUsername(tempName.trim());
              setTempName("");
            }}
            style={styles.flex1}
            disabled={!tempName.trim()}
          />
          <Button
            testID="disk-delete"
            title="Delete"
            variant="danger"
            onPress={() => {
              diskUsername.delete();
            }}
          />
        </View>
        <StatusRow
          testID="disk-stored-value"
          label="Stored"
          value={username || "(empty)"}
          color={username ? Colors.disk : Colors.muted}
        />
        <StatusRow
          testID="disk-has-value"
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
          testID="secure-token-input"
          label="Secret value"
          value={tempToken}
          onChangeText={setTempToken}
          placeholder="Paste a token or secret"
          secureTextEntry
          autoCapitalize="none"
        />
        <View style={styles.row}>
          <Button
            testID="secure-lock"
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
            testID="secure-wipe"
            title="Wipe"
            variant="danger"
            onPress={() => {
              secureToken.delete();
            }}
          />
        </View>
        {token ? (
          <StatusRow
            testID="secure-encrypted-value"
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
          testID="ns-pref-input"
          label="Preference value"
          value={tempPref}
          onChangeText={setTempPref}
          placeholder="Set a namespaced value"
        />
        <View style={styles.row}>
          <Button
            testID="ns-save"
            title="Save"
            onPress={() => {
              setNsPref(tempPref.trim());
              setTempPref("");
            }}
            style={styles.flex1}
            disabled={!tempPref.trim()}
          />
          <Button
            testID="ns-clear-namespace"
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
        <StatusRow testID="ns-pref-value" label="Value" value={nsPref || "(empty)"} />
      </Card>

      <Card
        title="JSON Objects"
        subtitle="Typed serialization"
        indicatorColor={Colors.primary}
      >
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Theme</Text>
          <Button
            testID="json-theme-toggle"
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
            testID="json-notif-toggle"
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
        <CodeBlock testID="json-config-code">{JSON.stringify(config, null, 2)}</CodeBlock>
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
            testID="auth-set-tokens"
            title="Set Tokens"
            onPress={() => {
              const now = Date.now().toString(36);
              authTokens.accessToken.set(`at_${now}`);
              authTokens.refreshToken.set(`rt_${now}`);
            }}
            style={styles.flex1}
          />
          <Button
            testID="auth-clear"
            title="Clear"
            variant="danger"
            onPress={() => {
              authTokens.accessToken.delete();
              authTokens.refreshToken.delete();
            }}
          />
        </View>
        <StatusRow testID="auth-access-token-value" label="accessToken" value={atValue || "(empty)"} />
        <StatusRow testID="auth-refresh-token-value" label="refreshToken" value={rtValue || "(empty)"} />
        <View style={styles.row}>
          <Badge label="Secure" color={Colors.secure} />
          <Badge label="TTL 60s" color={Colors.warning} />
          <Badge label="Namespace auth" color={Colors.accent} />
        </View>
      </Card>

      <Card
        title="Namespaced Auth Storage"
        subtitle="createSecureAuthStorage + namespace isolation"
        indicatorColor={Colors.secure}
      >
        <Text style={styles.helperText}>
          Tokens stored under the{" "}
          <Text style={{ fontWeight: "bold" }}>"example-auth"</Text> namespace.
          Clearing the namespace removes both atomically without affecting other
          secure keys (e.g. the non-namespaced token above).
        </Text>
        <View style={styles.row}>
          <Button
            testID="ns-auth-set-tokens"
            title="Set Tokens"
            onPress={() => {
              const now = Date.now().toString(36);
              namespacedAuthTokens.accessToken.set(`ns_at_${now}`);
              namespacedAuthTokens.refreshToken.set(`ns_rt_${now}`);
            }}
            style={styles.flex1}
          />
          <Button
            testID="ns-auth-clear-namespace"
            title="Clear Namespace"
            variant="danger"
            onPress={() => {
              storage.clearNamespace("example-auth", StorageScope.Secure);
            }}
          />
        </View>
        <StatusRow testID="ns-auth-access-token-value" label="accessToken" value={nsAtValue || "(empty)"} />
        <StatusRow testID="ns-auth-refresh-token-value" label="refreshToken" value={nsRtValue || "(empty)"} />
        <StatusRow
          label="non-namespaced token (unaffected)"
          value={token || "(empty)"}
          color={token ? Colors.success : Colors.muted}
        />
        <View style={styles.row}>
          <Badge label="Secure" color={Colors.secure} />
          <Badge label="namespace: example-auth" color={Colors.accent} />
        </View>
      </Card>

      <Card title="Storage Utilities" subtitle="Introspection helpers">
        <Section title="Disk">
          <StatusRow
            testID="util-disk-size"
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
            testID="util-memory-size"
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
              testID="util-wipe-memory"
              title="Wipe Memory"
              onPress={() => {
                storage.clear(StorageScope.Memory);
              }}
              variant="secondary"
              size="sm"
              style={styles.flex1}
            />
            <Button
              testID="util-wipe-disk"
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
            testID="util-reset-all"
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
