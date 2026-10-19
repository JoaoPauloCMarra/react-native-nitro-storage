import { useEffect, useState } from "react";
import { storage, StorageScope } from "react-native-nitro-storage";
import {
  LabScreen,
  ResultsProbe,
  StatusRow,
  describeStorageError,
} from "../components/shared";

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
    return `clearall:fail=${describeStorageError(error)};`;
  }
}

export default function ClearAllScreen() {
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    setResult(runClearAll());
  }, []);

  return (
    <LabScreen
      testID="e2e-clear-all-screen"
      label="Clear all lab"
      title="Clear all lab"
      subtitle="Deep link nitrostorage://e2e-clear-all"
    >
      <ResultsProbe testID="e2e-clear-all-results" label={result ?? ""} />
      <StatusRow
        testID="e2e-clear-all-finished"
        label="run"
        value={result ? "finished" : "running"}
      />
      <StatusRow label="result" value={result ?? "running"} />
    </LabScreen>
  );
}
