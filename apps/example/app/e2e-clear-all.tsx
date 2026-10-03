import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  getStorageErrorCode,
  storage,
  StorageScope,
} from "react-native-nitro-storage";
import { Page, StatusRow } from "../components/shared";

const clearAllKey = "__e2e_clearall_seed";

function presence(scope: StorageScope): string {
  return storage.getString(clearAllKey, scope) === undefined
    ? "missing"
    : "present";
}

function runClearAll(): string {
  try {
    storage.setString(clearAllKey, "memory-seed", StorageScope.Memory);
    storage.setString(clearAllKey, "disk-seed", StorageScope.Disk);
    storage.setString(clearAllKey, "secure-seed", StorageScope.Secure);
    storage.flushDiskWrites();
    storage.flushSecureWrites();
    const seeded =
      presence(StorageScope.Memory) === "present" &&
      presence(StorageScope.Disk) === "present" &&
      presence(StorageScope.Secure) === "present";
    if (!seeded) {
      return "clearall:fail=seed;";
    }
    storage.clearAll();
    return `clearall:memory=${presence(StorageScope.Memory)}:disk=${presence(StorageScope.Disk)}:secure=${presence(StorageScope.Secure)};`;
  } catch (error) {
    return `clearall:fail=${getStorageErrorCode(error) ?? (error instanceof Error ? error.message : String(error))};`;
  }
}

export default function ClearAllScreen() {
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    setResult(runClearAll());
  }, []);

  return (
    <View
      testID="e2e-clear-all-screen"
      style={{ flex: 1 }}
      accessibilityLabel="Clear all lab"
    >
      <Page
        title="Clear all lab"
        subtitle="Deep link nitrostorage://e2e-clear-all"
      >
        <View
          testID="e2e-clear-all-results"
          accessible
          accessibilityLabel={result ?? ""}
          style={localStyles.resultsProbe}
        />
        <StatusRow
          testID="e2e-clear-all-finished"
          label="run"
          value={result ? "finished" : "running"}
        />
        <StatusRow label="result" value={result ?? "running"} />
      </Page>
    </View>
  );
}

const localStyles = StyleSheet.create({
  resultsProbe: {
    height: 1,
  },
});
