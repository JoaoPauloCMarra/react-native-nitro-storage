import { useState } from "react";
import { Platform, View } from "react-native";
import {
  createSetItem,
  createStorageItem,
  storage,
  StorageScope,
} from "react-native-nitro-storage";
import { Button, Card, Colors, StatusRow, styles } from "./shared";

const memoryItem = createStorageItem({
  key: "e2e-memory",
  scope: StorageScope.Memory,
  defaultValue: "default",
});

const renamedItem = createStorageItem({
  key: "e2e-renamed",
  scope: StorageScope.Disk,
  defaultValue: "",
  renameFrom: "e2e-legacy",
});

const tagSet = createSetItem<"red" | "blue">({
  key: "e2e-tags",
  scope: StorageScope.Memory,
});

const groupedItem = createStorageItem({
  key: "e2e-grouped",
  scope: StorageScope.Memory,
  defaultValue: "grouped",
  group: "e2e-lab",
});

export function StorageE2eLab() {
  const [renameStatus, setRenameStatus] = useState("(idle)");
  const [memoryStatus, setMemoryStatus] = useState("(idle)");
  const [secureAsyncStatus, setSecureAsyncStatus] = useState("(idle)");
  const [auditStatus, setAuditStatus] = useState("(idle)");
  const [setStatus, setSetStatus] = useState("(idle)");
  const [biometricStatus, setBiometricStatus] = useState("(idle)");
  const [stressStatus, setStressStatus] = useState("(idle)");

  return (
    <Card
      title="E2E Lab"
      subtitle="Storage values, migration, diagnostics, and capabilities"
      indicatorColor={Colors.accent}
    >
      <View testID="e2e-lab" accessibilityLabel="E2E Lab">
        <StatusRow
          testID="e2e-rename-status"
          label="renameFrom"
          value={renameStatus}
        />
        <StatusRow
          testID="e2e-memory-status"
          label="memory read"
          value={memoryStatus}
        />
        <StatusRow
          testID="e2e-secure-async-status"
          label="secure async"
          value={secureAsyncStatus}
        />
        <StatusRow
          testID="e2e-audit-status"
          label="audit"
          value={auditStatus}
        />
        <StatusRow testID="e2e-set-status" label="set item" value={setStatus} />
        <StatusRow
          testID="e2e-biometric-status"
          label="biometric"
          value={biometricStatus}
        />
        <StatusRow
          testID="e2e-stress-result"
          label="stress"
          value={stressStatus}
        />

        <View style={styles.row}>
          <Button
            testID="e2e-rename-run"
            title="RenameFrom"
            disabled={renameStatus !== "(idle)"}
            onPress={() => {
              let passed = false;
              try {
                storage.deleteString("e2e-renamed", StorageScope.Disk);
                storage.setString(
                  "e2e-legacy",
                  JSON.stringify("migrated-value"),
                  StorageScope.Disk,
                );
                passed =
                  renamedItem.get() === "migrated-value" &&
                  storage.getString("e2e-legacy", StorageScope.Disk) ===
                    undefined;
              } finally {
                storage.deleteString("e2e-legacy", StorageScope.Disk);
                renamedItem.delete();
                storage.flushDiskWrites();
              }
              setRenameStatus(passed ? "ok:migrated-value" : "fail:migration");
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-memory-run"
            title="Memory read"
            onPress={() => {
              memoryItem.set("cached");
              const passed = memoryItem.get() === "cached";
              memoryItem.delete();
              setMemoryStatus(passed ? "ok:cached" : "fail:memory");
            }}
            style={styles.flex1}
          />
        </View>

        <View style={styles.row}>
          <Button
            testID="e2e-secure-async-run"
            title="Secure async"
            onPress={() => {
              const wasBuffered =
                storage.getCapabilities().writeBuffering.secure;
              let passed = false;
              try {
                storage.setSecureWritesAsync(true);
                storage.setString(
                  "e2e-secure-async",
                  "queued",
                  StorageScope.Secure,
                );
                storage.flushSecureWrites();
                passed =
                  storage.getString("e2e-secure-async", StorageScope.Secure) ===
                  "queued";
              } finally {
                storage.deleteString("e2e-secure-async", StorageScope.Secure);
                storage.flushSecureWrites();
                storage.setSecureWritesAsync(wasBuffered);
              }
              setSecureAsyncStatus(passed ? "ok:queued" : "fail:secure");
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-audit-run"
            title="Audit"
            onPress={() => {
              groupedItem.set("grouped");
              const registered = storage
                .getRegisteredKeys()
                .some(
                  (item) =>
                    item.key === groupedItem.key &&
                    item.scope === StorageScope.Memory,
                );
              const duplicate = storage
                .findDuplicateKeys()
                .some(
                  (item) =>
                    item.key === groupedItem.key &&
                    item.scope === StorageScope.Memory,
                );
              const group = storage.getGroupItems("e2e-lab");
              const passed =
                registered &&
                !duplicate &&
                group.length === 1 &&
                group[0] === groupedItem;
              groupedItem.delete();
              setAuditStatus(
                passed ? "ok:audit=registered-unique-grouped" : "fail:audit",
              );
            }}
            style={styles.flex1}
          />
        </View>

        <View style={styles.row}>
          <Button
            testID="e2e-set-run"
            title="Set typed"
            onPress={() => {
              tagSet.clear();
              tagSet.add("red");
              const typed = tagSet.getTyped();
              const passed = typed.red === true && tagSet.size() === 1;
              tagSet.clear();
              setSetStatus(passed ? "ok:red=true:size=1" : "fail:set");
            }}
            style={styles.flex1}
          />
          <Button
            testID="e2e-biometric-run"
            title="Biometric capability"
            onPress={() => {
              const capabilities = storage.getSecurityCapabilities();
              const prompt = capabilities.biometric.prompt;
              const valid = ["available", "unavailable", "unknown"].includes(
                prompt,
              );
              setBiometricStatus(
                valid ? `ok:capability=${prompt}` : "fail:capability",
              );
            }}
            style={styles.flex1}
          />
        </View>

        <Button
          testID="e2e-run-stress"
          title="Stress 200 writes"
          onPress={() => {
            const started = globalThis.performance?.now?.() ?? Date.now();
            for (let index = 0; index < 200; index += 1) {
              storage.setString(
                `e2e-stress-${index}`,
                JSON.stringify(index),
                StorageScope.Memory,
              );
            }
            let reads = 0;
            for (let index = 0; index < 200; index += 1) {
              if (
                storage.getString(
                  `e2e-stress-${index}`,
                  StorageScope.Memory,
                ) === JSON.stringify(index)
              ) {
                reads += 1;
              }
              storage.deleteString(`e2e-stress-${index}`, StorageScope.Memory);
            }
            const elapsed =
              (globalThis.performance?.now?.() ?? Date.now()) - started;
            setStressStatus(
              `${reads === 200 ? "ok" : "fail"}:writes=200:reads=${reads}:ms=${elapsed.toFixed(1)}`,
            );
          }}
        />
        <StatusRow testID="e2e-platform" label="platform" value={Platform.OS} />
      </View>
    </Card>
  );
}
