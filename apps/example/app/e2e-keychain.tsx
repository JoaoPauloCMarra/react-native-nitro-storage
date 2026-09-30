import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import {
  AccessControl,
  BiometricLevel,
  createStorageItem,
  getStorageErrorCode,
  storage,
  StorageScope,
} from "react-native-nitro-storage";
import { KeychainLifecycleProbe } from "../components/keychain-lifecycle-probe";
import { Card, Page, StatusRow } from "../components/shared";

type CaseStatus = "pass" | "fail" | "skip";
type LabCase = {
  name: string;
  status: CaseStatus;
  detail?: string;
};

type KeychainReport = {
  fail: number;
  pass: number;
  skip: number;
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
          detail: `${Platform.OS}:${metadata.backend}`,
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
    } catch (cleanupError) {
      detail = `${detail}; cleanup=${errorDetail(cleanupError)}`;
    }
    return { name: "secure-roundtrip", status: "fail", detail };
  }
}

function runKeychainSweep(): KeychainReport {
  const cases: LabCase[] = [runSecureRoundTrip()];

  if (Platform.OS !== "ios") {
    cases.push({
      name: "biometric-write",
      status: "skip",
      detail: `not ios (${Platform.OS})`,
    });
  } else {
    try {
      const item = createStorageItem({
        key: "__e2e_biometric_sentinel__",
        scope: StorageScope.Secure,
        defaultValue: "",
        biometric: true,
        biometricLevel: BiometricLevel.BiometryOrPasscode,
        accessControl: AccessControl.WhenUnlocked,
      });
      item.set("bio-sentinel");
      const value = item.get();
      item.delete();
      cases.push({
        name: "biometric-write",
        status: value === "bio-sentinel" ? "pass" : "fail",
        detail: value === "bio-sentinel" ? "roundtrip" : `got ${value}`,
      });
    } catch (error) {
      const code = getStorageErrorCode(error);
      cases.push({
        name: "biometric-write",
        status: code === "authentication_required" ? "skip" : "fail",
        detail: errorDetail(error),
      });
    }
  }

  const report: KeychainReport = {
    fail: cases.filter((item) => item.status === "fail").length,
    pass: cases.filter((item) => item.status === "pass").length,
    skip: cases.filter((item) => item.status === "skip").length,
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
    ? `fail=${report.fail} pass=${report.pass} skip=${report.skip}`
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
          testID="e2e-keychain-summary"
          label="summary"
          value={summary}
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
