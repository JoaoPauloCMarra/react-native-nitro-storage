import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { storage, StorageScope } from "react-native-nitro-storage";
import { Card, Page, StatusRow } from "../components/shared";

type ReplayStage = "seed" | "verify";
type PersistenceReport = {
  stage: ReplayStage | "invalid";
  result: string;
  finished: boolean;
};

const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clearRunKey(key: string): boolean {
  try {
    storage.deleteString(key, StorageScope.Disk);
    storage.flushDiskWrites();
    return storage.getString(key, StorageScope.Disk) === undefined;
  } catch {
    return false;
  }
}

function runPersistenceStage(
  stageValue: string | undefined,
  runId: string | undefined,
): PersistenceReport {
  const stage =
    stageValue === "seed" || stageValue === "verify" ? stageValue : null;
  if (!stage || !runId || !RUN_ID_PATTERN.test(runId)) {
    return {
      stage: "invalid",
      result: "fail:run-id-or-stage-invalid",
      finished: true,
    };
  }

  const key = `__nitro_qa_replay_disk__:${runId}`;
  const expectedValue = `nitro-storage-replay:${runId}`;
  const finished = stage === "verify";

  try {
    const capabilities = storage.getCapabilities();
    if (
      capabilities.platform !== "native" ||
      capabilities.backend.disk !== "sqlite"
    ) {
      clearRunKey(key);
      return {
        stage,
        result: "fail:native-sqlite-capability-required",
        finished,
      };
    }

    if (stage === "seed") {
      if (storage.getString(key, StorageScope.Disk) !== undefined) {
        clearRunKey(key);
        return {
          stage,
          result: "fail:run-id-key-already-exists",
          finished: false,
        };
      }

      storage.setString(key, expectedValue, StorageScope.Disk);
      storage.flushDiskWrites();
      const storedValue = storage.getString(key, StorageScope.Disk);
      if (storedValue !== expectedValue) {
        const cleaned = clearRunKey(key);
        return {
          stage,
          result: cleaned
            ? "fail:disk-seed-value-mismatch:cleanup=missing"
            : "fail:disk-seed-value-mismatch:cleanup=failed",
          finished: false,
        };
      }
      return {
        stage,
        result: "pass:disk-write-readback",
        finished: false,
      };
    }

    let valueMatched = false;
    let readFailed = false;
    try {
      valueMatched =
        storage.getString(key, StorageScope.Disk) === expectedValue;
    } catch {
      readFailed = true;
    }
    const cleaned = clearRunKey(key);
    if (!cleaned) {
      return {
        stage,
        result: "fail:disk-relaunch:cleanup-failed",
        finished: true,
      };
    }

    return {
      stage,
      result:
        readFailed || !valueMatched
          ? "fail:disk-relaunch:value-mismatch:cleanup=missing"
          : "pass:disk-relaunch:value-matched:cleanup=missing",
      finished: true,
    };
  } catch {
    const cleaned = clearRunKey(key);
    return {
      stage,
      result: cleaned
        ? "fail:disk-operation:cleanup=missing"
        : "fail:disk-operation:cleanup=failed",
      finished,
    };
  }
}

export default function PersistenceReplayScreen() {
  const { runId, stage } = useLocalSearchParams<{
    runId?: string;
    stage?: string;
  }>();
  const [report, setReport] = useState<PersistenceReport | null>(null);
  const processedStage = useRef<string | null>(null);

  useEffect(() => {
    const currentStage = typeof stage === "string" ? stage : undefined;
    const currentRunId = typeof runId === "string" ? runId : undefined;
    const identity = `${currentRunId ?? ""}:${currentStage ?? ""}`;
    if (processedStage.current === identity) {
      return;
    }
    processedStage.current = identity;
    setReport(runPersistenceStage(currentStage, currentRunId));
  }, [runId, stage]);

  return (
    <View
      testID="e2e-persistence-screen"
      style={{ flex: 1 }}
      accessibilityLabel="Disk persistence replay"
    >
      <Page
        title="Disk persistence replay"
        subtitle="Run seed, process relaunch, and verify with the same RUN_ID"
      >
        <StatusRow testID="e2e-persistence-ready" label="state" value="ready" />
        <StatusRow
          testID="e2e-persistence-stage"
          label="stage"
          value={report?.stage ?? "running"}
        />
        <StatusRow
          testID="e2e-persistence-result"
          label="Disk result"
          value={report?.result ?? "running"}
        />
        <StatusRow
          testID="e2e-persistence-finished"
          label="verify run"
          value={report?.finished ? "finished" : "pending-relaunch"}
        />
        <Card title="Test boundary" subtitle="Native Disk public API only">
          <StatusRow
            label="Data scope"
            value="one RUN_ID-scoped QA key; deleted after verify"
          />
        </Card>
      </Page>
    </View>
  );
}
