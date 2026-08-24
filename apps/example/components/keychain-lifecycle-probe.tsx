import React, { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, View } from "react-native";
import {
  AccessControl,
  StorageScope,
  createStorageItem,
  getStorageErrorCode,
  isStorageError,
} from "react-native-nitro-storage";
import { Button, Card, Colors, StatusRow, styles } from "./shared";

const probeValue = "lifecycle-probe-sentinel";

const keychainLifecycleItem = createStorageItem<string>({
  key: "__keychain_lifecycle_probe__",
  scope: StorageScope.Secure,
  defaultValue: "",
  accessControl: AccessControl.WhenUnlockedThisDeviceOnly,
});

function readProbe(): string {
  try {
    return keychainLifecycleItem.get() === probeValue
      ? "readable"
      : "missing or changed";
  } catch (error) {
    if (isStorageError(error, "keychain_locked")) {
      return "keychain_locked";
    }
    return getStorageErrorCode(error) ?? "unknown_error";
  }
}

export function KeychainLifecycleProbe() {
  const armed = useRef(false);
  const [status, setStatus] = useState("idle");
  const [backgroundResult, setBackgroundResult] = useState("not run");
  const [foregroundResult, setForegroundResult] = useState("not run");

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (!armed.current) return;

        if (nextState === "inactive" || nextState === "background") {
          setBackgroundResult(readProbe());
          return;
        }

        if (nextState === "active") {
          setForegroundResult(readProbe());
          setStatus("completed");
          armed.current = false;
        }
      },
    );
    return () => {
      subscription.remove();
    };
  }, []);

  const seed = () => {
    try {
      keychainLifecycleItem.set(probeValue);
      setStatus("seeded");
    } catch (error) {
      setStatus(
        `seed failed: ${getStorageErrorCode(error) ?? "unknown_error"}`,
      );
    }
  };

  const arm = () => {
    setBackgroundResult("waiting");
    setForegroundResult("waiting");
    setStatus("armed: lock and unlock the device");
    armed.current = true;
  };

  const wipe = () => {
    keychainLifecycleItem.delete();
    armed.current = false;
    setBackgroundResult("not run");
    setForegroundResult("not run");
    setStatus("wiped");
  };

  return (
    <Card
      title="Keychain Lifecycle Probe"
      subtitle="Physical-device lock and resume contract"
      indicatorColor={Colors.secure}
    >
      <View style={styles.row}>
        <Button
          testID="keychain-probe-seed"
          title="Seed"
          onPress={seed}
          variant="success"
          style={styles.flex1}
        />
        <Button
          testID="keychain-probe-arm"
          title="Arm"
          onPress={arm}
          style={styles.flex1}
        />
        <Button
          testID="keychain-probe-wipe"
          title="Wipe"
          onPress={wipe}
          variant="danger"
          style={styles.flex1}
        />
      </View>
      <StatusRow label="Status" value={status} />
      <StatusRow
        testID="keychain-probe-background"
        label="Lock transition"
        value={backgroundResult}
      />
      <StatusRow
        testID="keychain-probe-foreground"
        label="Resume transition"
        value={foregroundResult}
      />
    </Card>
  );
}
