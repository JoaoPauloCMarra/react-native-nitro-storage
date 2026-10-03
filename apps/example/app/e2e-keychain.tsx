import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  getStorageErrorCode,
  storage,
  StorageScope,
} from "react-native-nitro-storage";
import { KeychainLifecycleProbe } from "../components/keychain-lifecycle-probe";
import { Card, Page, StatusRow } from "../components/shared";

type CaseStatus = "pass" | "fail";
type LabCase = {
  name: string;
  status: CaseStatus;
  detail?: string;
};

type KeychainReport = {
  fail: number;
  pass: number;
  cases: LabCase[];
};

declare global {
  var __keychainReport: KeychainReport | undefined;
}

function errorDetail(error: unknown): string {
  return (
    getStorageErrorCode(error) ??
    (error instanceof Error ? error.message : String(error))
  );
}

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
    let detail = errorDetail(error);
    try {
      storage.deleteString(key, StorageScope.Secure);
      storage.flushSecureWrites();
    } catch (cleanupError) {
      detail = `${detail}; cleanup=${errorDetail(cleanupError)}`;
    }
    return { name: "secure-roundtrip", status: "fail", detail };
  }
}

function runKeychainSweep(): KeychainReport {
  const cases = [runSecureRoundTrip()];
  const report: KeychainReport = {
    fail: cases.filter((item) => item.status === "fail").length,
    pass: cases.filter((item) => item.status === "pass").length,
    cases,
  };
  globalThis.__keychainReport = report;
  return report;
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
    <View
      testID="e2e-keychain-screen"
      style={{ flex: 1 }}
      accessibilityLabel="Keychain lab"
    >
      <Page
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
      </Page>
    </View>
  );
}
