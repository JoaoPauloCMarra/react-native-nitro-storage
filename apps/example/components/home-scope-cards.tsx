import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  createSecureAuthStorage,
  createStorageItem,
  getStorageErrorCode,
  isStorageError,
  storage,
  StorageScope,
  useStorage,
} from "react-native-nitro-storage";
import { isWebRuntime } from "./runtime";
import {
  Button,
  Card,
  CodeBlock,
  Colors,
  Input,
  StatusRow,
  styles,
} from "./shared";

const counterItem = createStorageItem({
  key: "counter",
  scope: StorageScope.Memory,
  defaultValue: 0,
});

const diskNameItem = createStorageItem({
  key: "disk-name",
  scope: StorageScope.Disk,
  defaultValue: "",
});

const secureTokenItem = createStorageItem({
  key: "secure-token",
  scope: StorageScope.Secure,
  defaultValue: "",
});

const namespacedItem = createStorageItem({
  key: "user-pref",
  namespace: "settings",
  scope: StorageScope.Disk,
  defaultValue: "",
});

type AppConfig = { theme: "dark" | "light"; notifications: boolean };
export const configItem = createStorageItem<AppConfig>({
  key: "app-config",
  scope: StorageScope.Disk,
  defaultValue: { theme: "dark", notifications: true },
});

const authStorage = createSecureAuthStorage({
  accessToken: {},
  refreshToken: {},
});

const nsAuthStorage = createSecureAuthStorage(
  { accessToken: {}, refreshToken: {} },
  { namespace: "app-auth" },
);

function withKeychainFallback<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    if (isStorageError(error, "keychain_locked")) {
      return fallback;
    }
    throw error;
  }
}

function readSecureMetadata() {
  return {
    metadata: withKeychainFallback(
      () => storage.getSecureMetadata("secure-token"),
      undefined,
    ),
    count: withKeychainFallback(() => storage.getAllSecureMetadata().length, 0),
  };
}

function useSecureMetadata() {
  const [inventory, setInventory] = useState(readSecureMetadata);

  useEffect(() => {
    return storage.subscribe(StorageScope.Secure, () => {
      setInventory(readSecureMetadata());
    });
  }, []);

  return {
    ...inventory,
    refresh: () => {
      setInventory(readSecureMetadata());
    },
  };
}

export function MemoryScopeCard() {
  const [counter, setCounter] = useStorage(counterItem);

  return (
    <Card
      title="Memory Scope"
      subtitle="In-process ephemeral storage"
      indicatorColor={Colors.memory}
    >
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Counter value</Text>
        <Text testID="counter-value" style={styles.panelValue}>
          {counter}
        </Text>
      </View>
      <View style={styles.row}>
        <Button
          testID="counter-decrement"
          title="-1"
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
          title="+1"
          onPress={() => {
            setCounter(counter + 1);
          }}
          style={styles.flex1}
        />
      </View>
    </Card>
  );
}

export function SecureExportCard() {
  const [secureExportStatus, setSecureExportStatus] = useState("(not run)");

  return (
    <Card
      title="Secure Export Guard"
      subtitle="safe defaults for secret snapshots"
      indicatorColor={Colors.secure}
    >
      <View style={styles.row}>
        <Button
          testID="secure-export-seed"
          title="Seed Secret"
          onPress={() => {
            storage.setString(
              "secure-export-demo",
              "demo-secret",
              StorageScope.Secure,
            );
            setSecureExportStatus("seeded secure-export-demo");
          }}
          style={styles.flex1}
        />
        <Button
          testID="secure-export-guarded"
          title="Guarded Export"
          variant="secondary"
          onPress={() => {
            try {
              storage.export(StorageScope.Secure);
              setSecureExportStatus("unexpected export success");
            } catch (error) {
              setSecureExportStatus(
                getStorageErrorCode(error) ?? "blocked by secure export guard",
              );
            }
          }}
          style={styles.flex1}
        />
      </View>
      <View style={styles.row}>
        <Button
          testID="secure-export-explicit"
          title="Explicit Export"
          onPress={() => {
            const exported = storage.export(StorageScope.Secure, {
              includeSecureValues: true,
            });
            setSecureExportStatus(`${Object.keys(exported).length} keys`);
          }}
          style={styles.flex1}
        />
        <Button
          testID="secure-export-unsafe"
          title="Unsafe Helper"
          variant="danger"
          onPress={() => {
            const exported = storage.exportSecureUnsafe();
            setSecureExportStatus(`${Object.keys(exported).length} raw keys`);
          }}
          style={styles.flex1}
        />
      </View>
      <StatusRow
        testID="secure-export-status"
        label="Result"
        value={secureExportStatus}
      />
    </Card>
  );
}

export function SecureObserverCard() {
  const [secureObserverStatus, setSecureObserverStatus] = useState("(not run)");

  return (
    <Card
      title="Secure Event Observer"
      subtitle="redacted by default, raw by explicit opt-in"
      indicatorColor={Colors.secure}
    >
      <View style={styles.row}>
        <Button
          testID="event-observer-redacted"
          title="Redacted"
          onPress={() => {
            try {
              storage.setEventObserver((event) => {
                if (event.type === "key") {
                  setSecureObserverStatus(event.newValue ?? "(empty)");
                }
              });
              storage.setString(
                "secure-observer-demo",
                "observer-secret",
                StorageScope.Secure,
              );
            } finally {
              storage.setEventObserver(undefined);
            }
          }}
          style={styles.flex1}
        />
        <Button
          testID="event-observer-raw"
          title="Raw Opt-In"
          variant="secondary"
          onPress={() => {
            try {
              storage.setEventObserver(
                (event) => {
                  if (event.type === "key") {
                    setSecureObserverStatus(
                      event.newValue
                        ? `raw value observed (${event.newValue.length} chars)`
                        : "(empty)",
                    );
                  }
                },
                { redactSecureValues: false },
              );
              storage.setString(
                "secure-observer-demo",
                "observer-secret",
                StorageScope.Secure,
              );
            } finally {
              storage.setEventObserver(undefined);
            }
          }}
          style={styles.flex1}
        />
      </View>
      <StatusRow
        testID="event-observer-status"
        label="Observed newValue"
        value={secureObserverStatus}
      />
    </Card>
  );
}

export function DiskScopeCard() {
  const [diskName, setDiskName] = useStorage(diskNameItem);
  const hasDiskName = diskNameItem.has();
  const [tempDiskName, setTempDiskName] = useState("");
  const tempDiskNameRef = useRef("");

  return (
    <Card
      title="Disk Scope"
      subtitle="Persistent storage"
      indicatorColor={Colors.disk}
    >
      <Input
        testID="disk-name-input"
        label="Display name"
        value={tempDiskName}
        onChangeText={(t) => {
          tempDiskNameRef.current = t;
          setTempDiskName(t);
        }}
        placeholder="Enter a name"
        autoCapitalize="none"
      />
      <View style={styles.row}>
        <Button
          testID="disk-save"
          title="Save"
          onPress={() => {
            setDiskName(tempDiskNameRef.current.trim());
            tempDiskNameRef.current = "";
            setTempDiskName("");
          }}
          style={styles.flex1}
        />
        <Button
          testID="disk-delete"
          title="Delete"
          variant="danger"
          onPress={() => {
            diskNameItem.delete();
          }}
        />
      </View>
      <StatusRow
        testID="disk-stored-value"
        label="Stored"
        value={diskName || "(empty)"}
        color={diskName ? Colors.disk : Colors.muted}
      />
      <StatusRow
        testID="disk-has-value"
        label="has()"
        value={String(hasDiskName)}
        color={hasDiskName ? Colors.success : Colors.muted}
      />
    </Card>
  );
}

export function SecureScopeCard() {
  const [token, setToken] = useStorage(secureTokenItem);
  const [tempToken, setTempToken] = useState("");
  const tempTokenRef = useRef("");
  const {
    metadata: secureMetadata,
    count: secureMetadataCount,
    refresh: refreshSecureMetadata,
  } = useSecureMetadata();

  return (
    <Card
      title="Secure Scope"
      subtitle={isWebRuntime ? "Web secure backend" : "Keychain / Keystore"}
      indicatorColor={Colors.secure}
    >
      <Input
        testID="secure-token-input"
        label="Secret value"
        value={tempToken}
        onChangeText={(t) => {
          tempTokenRef.current = t;
          setTempToken(t);
        }}
        placeholder="Paste a token or secret"
        secureTextEntry
        autoCapitalize="none"
      />
      <View style={styles.row}>
        <Button
          testID="secure-lock"
          title="Lock"
          onPress={() => {
            setToken(tempTokenRef.current.trim());
            tempTokenRef.current = "";
            setTempToken("");
            refreshSecureMetadata();
          }}
          variant="success"
          style={styles.flex1}
        />
        <Button
          testID="secure-wipe"
          title="Wipe"
          variant="danger"
          onPress={() => {
            secureTokenItem.delete();
            refreshSecureMetadata();
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
      <StatusRow
        testID="secure-metadata-kind"
        label="Stored as"
        value={secureMetadata?.kind ?? "—"}
      />
      <StatusRow
        testID="secure-metadata-count"
        label="Secure key inventory"
        value={String(secureMetadataCount)}
      />
    </Card>
  );
}

export function NamespacesCard() {
  const [nsPref, setNsPref] = useStorage(namespacedItem);
  const [tempNsPref, setTempNsPref] = useState("");
  const tempNsPrefRef = useRef("");

  return (
    <Card
      title="Namespaces"
      subtitle="Scoped key isolation"
      indicatorColor={Colors.accent}
    >
      <Input
        testID="ns-pref-input"
        label="Preference value"
        value={tempNsPref}
        onChangeText={(t) => {
          tempNsPrefRef.current = t;
          setTempNsPref(t);
        }}
        placeholder="Set a namespaced value"
        autoCapitalize="none"
      />
      <View style={styles.row}>
        <Button
          testID="ns-save"
          title="Save"
          onPress={() => {
            setNsPref(tempNsPrefRef.current.trim());
            tempNsPrefRef.current = "";
            setTempNsPref("");
          }}
          style={styles.flex1}
        />
        <Button
          testID="ns-clear-namespace"
          title="Clear Namespace"
          variant="secondary"
          onPress={() => {
            storage.clearNamespace("settings", StorageScope.Disk);
          }}
          style={styles.flex1}
        />
      </View>
      <StatusRow
        testID="ns-pref-value"
        label="Value"
        value={nsPref || "(empty)"}
      />
    </Card>
  );
}

export function JsonObjectsCard() {
  const [config, setConfig] = useStorage(configItem);

  return (
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
      <CodeBlock testID="json-config-code">
        {JSON.stringify(config, null, 2)}
      </CodeBlock>
    </Card>
  );
}

export function AuthStorageCard() {
  const [atValue] = useStorage(authStorage.accessToken);
  const [rtValue] = useStorage(authStorage.refreshToken);

  return (
    <Card
      title="Auth Storage Factory"
      subtitle="createSecureAuthStorage"
      indicatorColor={Colors.secure}
    >
      <View style={styles.row}>
        <Button
          testID="auth-set-tokens"
          title="Set Tokens"
          onPress={() => {
            const now = Date.now().toString(36);
            authStorage.accessToken.set(`at_${now}`);
            authStorage.refreshToken.set(`rt_${now}`);
          }}
          style={styles.flex1}
        />
        <Button
          testID="auth-clear"
          title="Clear"
          variant="danger"
          onPress={() => {
            authStorage.accessToken.delete();
            authStorage.refreshToken.delete();
          }}
        />
      </View>
      <StatusRow
        testID="auth-access-token-value"
        label="accessToken"
        value={atValue || "(empty)"}
      />
      <StatusRow
        testID="auth-refresh-token-value"
        label="refreshToken"
        value={rtValue || "(empty)"}
      />
    </Card>
  );
}

export function NamespacedAuthCard() {
  const [nsAtValue] = useStorage(nsAuthStorage.accessToken);
  const [nsRtValue] = useStorage(nsAuthStorage.refreshToken);

  return (
    <Card
      title="Namespaced Auth Storage"
      subtitle="createSecureAuthStorage + namespace"
      indicatorColor={Colors.secure}
    >
      <View style={styles.row}>
        <Button
          testID="ns-auth-set-tokens"
          title="Set Tokens"
          onPress={() => {
            const now = Date.now().toString(36);
            nsAuthStorage.accessToken.set(`ns_at_${now}`);
            nsAuthStorage.refreshToken.set(`ns_rt_${now}`);
          }}
          style={styles.flex1}
        />
        <Button
          testID="ns-auth-clear-namespace"
          title="Clear Namespace"
          variant="danger"
          onPress={() => {
            storage.clearNamespace("app-auth", StorageScope.Secure);
          }}
        />
      </View>
      <StatusRow
        testID="ns-auth-access-token-value"
        label="accessToken"
        value={nsAtValue || "(empty)"}
      />
      <StatusRow
        testID="ns-auth-refresh-token-value"
        label="refreshToken"
        value={nsRtValue || "(empty)"}
      />
    </Card>
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
