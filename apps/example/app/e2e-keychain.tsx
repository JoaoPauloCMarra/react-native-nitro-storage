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

function runKeychainSweep(): KeychainReport {
  const capabilities = storage.getSecurityCapabilities();
  const cases: LabCase[] = [
    {
      name: "platform",
      status: "pass",
      detail: Platform.OS,
    },
    {
      name: "secure-backend",
      status: "pass",
      detail: capabilities.secureStorage.backend,
    },
    {
      name: "biometric-prompt",
      status: ["available", "unavailable", "unknown"].includes(
        capabilities.biometric.prompt,
      )
        ? "pass"
        : "fail",
      detail: capabilities.biometric.prompt,
    },
  ];

  if (Platform.OS !== "ios") {
    cases.push({
      name: "biometric-write",
      status: "skip",
      detail: `not ios (${Platform.OS})`,
    });
  } else if (capabilities.biometric.prompt === "unavailable") {
    cases.push({
      name: "biometric-write",
      status: "skip",
      detail: "biometric prompt unavailable",
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
        detail:
          code ?? (error instanceof Error ? error.message : String(error)),
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
        <Card title="Capabilities" subtitle="No real tokens">
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
