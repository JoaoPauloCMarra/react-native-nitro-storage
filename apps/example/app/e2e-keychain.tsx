import { useEffect, useState } from "react";
import { storage, StorageScope } from "react-native-nitro-storage";
import { KeychainLifecycleProbe } from "../components/keychain-lifecycle-probe";
import {
  Card,
  LabScreen,
  StatusRow,
  describeStorageError,
  summarizeCases,
  type LabCase,
} from "../components/shared";

type KeychainReport = ReturnType<typeof summarizeCases>;

function runSecureRoundTrip(): LabCase {
  const key = "__e2e_secure_roundtrip__";
  try {
    const capabilities = storage.getCapabilities();
    if (
      capabilities.platform !== "native" ||
      capabilities.backend.secure !== "platform-secure-storage"
    ) {
      throw new Error("expected native secure backend capability");
    }
    storage.setString(key, "secure-sentinel", StorageScope.Secure);
    storage.flushSecureWrites();
    const value = storage.getString(key, StorageScope.Secure);
    const metadata = storage.getSecureMetadata(key);
    storage.deleteString(key, StorageScope.Secure);
    storage.flushSecureWrites();
    const afterDelete = storage.getSecureMetadata(key);
    const failures = [
      value === "secure-sentinel" ? null : `get=${String(value)}`,
      metadata.exists && metadata.kind === "secure"
        ? null
        : `metadata=${metadata.kind}`,
      metadata.valueExposed === false ? null : "value exposed",
      storage.getString(key, StorageScope.Secure) === undefined
        ? null
        : "delete kept value",
      !afterDelete.exists && afterDelete.kind === "missing"
        ? null
        : `after-delete=${afterDelete.kind}`,
    ].filter((failure): failure is string => failure !== null);
    return failures.length === 0
      ? {
          name: "secure-roundtrip",
          status: "pass",
          detail:
            "native=platform-secure-storage:value=secure-sentinel:metadata-hidden:deleted=true",
        }
      : {
          name: "secure-roundtrip",
          status: "fail",
          detail: failures.join(", "),
        };
  } catch (error) {
    let detail = describeStorageError(error);
    try {
      storage.deleteString(key, StorageScope.Secure);
      storage.flushSecureWrites();
    } catch (cleanupError) {
      detail = `${detail}; cleanup=${describeStorageError(cleanupError)}`;
    }
    return { name: "secure-roundtrip", status: "fail", detail };
  }
}

function runKeychainSweep(): KeychainReport {
  return summarizeCases([runSecureRoundTrip()]);
}

export default function KeychainLabScreen() {
  const [report, setReport] = useState<KeychainReport | null>(null);

  useEffect(() => {
    setReport(runKeychainSweep());
  }, []);

  const summary = report
    ? `finished:required-pass=${report.pass}:fail=${report.fail}:hardware-pending`
    : "running";

  return (
    <LabScreen
      testID="e2e-keychain-screen"
      label="Keychain lab"
      title="Keychain lab"
      subtitle="Deep link nitrostorage://e2e-keychain"
    >
      <StatusRow testID="e2e-keychain-ready" label="state" value="ready" />
      <StatusRow
        testID="e2e-keychain-finished"
        label="run"
        value={report ? "finished" : "running"}
      />
      <StatusRow
        testID="e2e-keychain-summary"
        label="summary"
        value={summary}
      />
      <StatusRow
        testID="e2e-keychain-hardware-pending"
        label="hardware cases"
        value="pending:biometric,lock,corruption,hardware-backed-keychain"
      />
      <Card title="Secure checks" subtitle="No real tokens">
        {(report?.cases ?? []).map((item) => (
          <StatusRow
            key={item.name}
            testID={`e2e-keychain-${item.name}`}
            label={item.name}
            value={`${item.status}:${item.detail ?? ""}`}
          />
        ))}
      </Card>
      <KeychainLifecycleProbe />
    </LabScreen>
  );
}
