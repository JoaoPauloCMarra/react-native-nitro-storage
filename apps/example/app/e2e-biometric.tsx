import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  createStorageItem,
  storage,
  StorageScope,
  type StorageItem,
} from "react-native-nitro-storage";
import {
  Page,
  ResultsProbe,
  StatusRow,
  describeStorageError,
} from "../components/shared";

const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_DELAY_MS = 300;

function cleanupToken(
  key: string,
  item: { delete: () => void } | null,
): string {
  try {
    item?.delete();
    storage.clearBiometric();
    const metadata = storage.getSecureMetadata(key);
    return metadata.kind === "missing" && !metadata.exists
      ? "bio:cleanup=missing;"
      : `bio:cleanup=${metadata.kind};`;
  } catch (error) {
    return `bio:cleanup=${describeStorageError(error)};`;
  }
}

export default function BiometricReplayScreen() {
  const { runId } = useLocalSearchParams<{ runId?: string }>();
  const [tokens, setTokens] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const processedRunId = useRef<string | null>(null);

  useEffect(() => {
    const currentRunId = typeof runId === "string" ? runId : "";
    if (processedRunId.current === currentRunId) {
      return;
    }
    processedRunId.current = currentRunId;
    const append = (token: string) => {
      setTokens((previous) => [...previous, token]);
    };

    if (!RUN_ID_PATTERN.test(currentRunId)) {
      append("bio:seed=run-id-invalid;");
      setFinished(true);
      return;
    }

    const key = `__e2e_bio_${currentRunId}`;
    const expectedValue = `bio-sentinel:${currentRunId}`;
    let item: StorageItem<string> | null = null;

    try {
      const capabilities = storage.getCapabilities();
      if (
        capabilities.platform !== "native" ||
        capabilities.backend.secure !== "platform-secure-storage"
      ) {
        append("bio:seed=native-secure-required;");
        append(cleanupToken(key, null));
        setFinished(true);
        return;
      }
      item = createStorageItem<string>({
        key,
        scope: StorageScope.Secure,
        biometric: true,
        defaultValue: "",
      });
      item.set(expectedValue);
      append("bio:seed=ok;");
    } catch (error) {
      append(`bio:seed=${describeStorageError(error)};`);
      append(cleanupToken(key, item));
      setFinished(true);
      return;
    }

    try {
      const metadata = storage.getSecureMetadata(key);
      append(
        `bio:meta=kind-${metadata.kind}:protected=${String(metadata.biometricProtected)}:exposed=${String(metadata.valueExposed)};`,
      );
    } catch (error) {
      append(`bio:meta=${describeStorageError(error)};`);
    }

    append("bio:read=prompting;");
    const seededItem = item;
    setTimeout(() => {
      try {
        const value = seededItem.get();
        append(
          value === expectedValue
            ? "bio:read=value-matched;"
            : "bio:read=value-mismatch;",
        );
      } catch (error) {
        append(`bio:read=${describeStorageError(error)};`);
      }
      append(cleanupToken(key, seededItem));
      setFinished(true);
    }, READ_DELAY_MS);
  }, [runId]);

  return (
    <View
      testID="e2e-biometric-screen"
      style={{ flex: 1 }}
      accessibilityLabel="Biometric replay"
    >
      <Page
        title="Biometric replay"
        subtitle="Deep link nitrostorage://e2e-biometric?runId=<uuid>"
      >
        <ResultsProbe testID="e2e-biometric-results" label={tokens.join("")} />
        <StatusRow
          testID="e2e-biometric-finished"
          label="run"
          value={finished ? "finished" : "running"}
        />
        <StatusRow label="result" value={tokens.join("") || "running"} />
      </Page>
    </View>
  );
}
