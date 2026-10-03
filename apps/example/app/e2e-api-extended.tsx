import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  AccessControl,
  createSecureAuthStorage,
  createSetItem,
  createStorageItem,
  getStorageErrorCode,
  storage,
  StorageScope,
  useSetStorage,
  useStorage,
  useStorageActions,
  useStorageSelector,
  useStorageValue,
  type StorageChangeEvent,
} from "react-native-nitro-storage";
import { Card, Page, StatusRow } from "../components/shared";

type ExtCase = {
  name: string;
  token: string;
};

type Profile = {
  clicks: number;
  label: string;
};

type HooksValue = {
  count: number;
  label: string;
};

const mergeItem = createStorageItem<Profile>({
  key: "__e2e_ext_merge",
  scope: StorageScope.Disk,
  defaultValue: { clicks: 0, label: "start" },
});

const toggleSet = createSetItem<"red" | "blue">({
  key: "__e2e_ext_toggle",
  scope: StorageScope.Memory,
});

const groupItemA = createStorageItem({
  key: "__e2e_ext_group_a",
  scope: StorageScope.Disk,
  defaultValue: "",
  group: "e2e-g",
});

const groupItemB = createStorageItem({
  key: "__e2e_ext_group_b",
  scope: StorageScope.Disk,
  defaultValue: "",
  group: "e2e-g",
});

const outsideItem = createStorageItem({
  key: "__e2e_ext_group_outside",
  scope: StorageScope.Disk,
  defaultValue: "",
});

const hooksDefault: HooksValue = { count: 0, label: "start" };

const hooksItem = createStorageItem<HooksValue>({
  key: "__e2e_ext_hooks",
  scope: StorageScope.Memory,
  defaultValue: hooksDefault,
});

const expiredCounts = { onExpired: 0 };

const expiringItem = createStorageItem({
  key: "__e2e_ext_expiring",
  scope: StorageScope.Memory,
  defaultValue: "default",
  expiration: { ttlMs: 1 },
  onExpired: () => {
    expiredCounts.onExpired += 1;
  },
});

const coalescedItem = createStorageItem({
  key: "__e2e_ext_coalesce",
  scope: StorageScope.Secure,
  defaultValue: "",
  coalesceSecureWrites: true,
});

const authStorage = createSecureAuthStorage(
  { t: { ttlMs: 50 } },
  { namespace: "__e2e_auth" },
);

const inventoryPrefix = "__e2e_inv_";
const accessControlKey = "__e2e_ext_access_control";
const passcodeKey = "__e2e_ext_passcode_acl";
const diskEventKey = "__e2e_ext_disk_event";
const metricsDiskKey = "__e2e_ext_metrics_disk";
const metricsSecureKey = "__e2e_ext_metrics_secure";

function resolveAfter(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describeError(error: unknown): string {
  return (
    getStorageErrorCode(error) ??
    (error instanceof Error ? error.message : String(error))
  );
}

function safely(cleanup: () => void): boolean {
  try {
    cleanup();
    return true;
  } catch {
    return false;
  }
}

function runSync(name: string, fn: () => string): ExtCase {
  try {
    return { name, token: fn() };
  } catch (error) {
    return { name, token: `fail:${name}:${describeError(error)}` };
  }
}

async function runAsync(
  name: string,
  fn: () => Promise<string>,
): Promise<ExtCase> {
  try {
    return { name, token: await fn() };
  } catch (error) {
    return { name, token: `fail:${name}:${describeError(error)}` };
  }
}

function checkMergeAndSetOrDelete(): string {
  try {
    mergeItem.delete();
    mergeItem.merge({ clicks: 1 });
    const merged = mergeItem.get();
    mergeItem.setOrDelete(null);
    const missing = !mergeItem.has();
    return merged.clicks === 1 && merged.label === "start" && missing
      ? "ok:merge=clicks-1:setOrDelete=missing"
      : `fail:merge=clicks-${merged.clicks}:setOrDelete=${missing ? "missing" : "present"}`;
  } finally {
    mergeItem.delete();
    storage.flushDiskWrites();
  }
}

function checkSetToggleValues(): string {
  try {
    toggleSet.clear();
    toggleSet.add("red");
    const removedRed = toggleSet.toggle("red");
    const addedBlue = toggleSet.toggle("blue");
    const values = toggleSet.values().join(",");
    return !removedRed && addedBlue && values === "blue"
      ? "ok:toggle=false,true:values=blue"
      : `fail:toggle=${removedRed},${addedBlue}:values=${values}`;
  } finally {
    toggleSet.clear();
  }
}

function checkClearGroup(): string {
  try {
    groupItemA.set("a");
    groupItemB.set("b");
    outsideItem.set("outside");
    storage.clearGroup("e2e-g");
    const cleared = [groupItemA, groupItemB].filter(
      (item) => !item.has(),
    ).length;
    const outsideKept = outsideItem.get() === "outside";
    return cleared === 2 && outsideKept
      ? "ok:clearGroup=2:outside=kept"
      : `fail:clearGroup=${cleared}:outside=${outsideKept ? "kept" : "missing"}`;
  } finally {
    groupItemA.delete();
    groupItemB.delete();
    outsideItem.delete();
    storage.flushDiskWrites();
  }
}

async function checkExpiredEvents(): Promise<string> {
  expiredCounts.onExpired = 0;
  let subscribedCalls = 0;
  const unsubscribe = storage.subscribeExpired(StorageScope.Memory, (event) => {
    if (event.key === expiringItem.key) {
      subscribedCalls += 1;
    }
  });
  try {
    expiringItem.set("short-lived");
    await resolveAfter(20);
    const value = expiringItem.get();
    return value === "default" &&
      expiredCounts.onExpired === 1 &&
      subscribedCalls === 1
      ? "ok:onExpired=1:subscribeExpired=1"
      : `fail:onExpired=${expiredCounts.onExpired}:subscribeExpired=${subscribedCalls}:value=${value}`;
  } finally {
    unsubscribe();
    expiringItem.delete();
  }
}

function checkSecureInventory(): string {
  const keys = [`${inventoryPrefix}a`, `${inventoryPrefix}b`];
  try {
    keys.forEach((key, index) => {
      storage.setString(key, `inv-${index}`, StorageScope.Secure);
    });
    storage.flushSecureWrites();
    const metadata = storage
      .getAllSecureMetadata()
      .filter(
        (entry) => entry.key.startsWith(inventoryPrefix) && entry.exists,
      ).length;
    const exported = Object.keys(storage.exportSecureUnsafe()).filter((key) =>
      key.startsWith(inventoryPrefix),
    ).length;
    return metadata === 2 && exported === 2
      ? "ok:metadata=2:export=2"
      : `fail:metadata=${metadata}:export=${exported}`;
  } finally {
    keys.forEach((key) => {
      safely(() => {
        storage.deleteString(key, StorageScope.Secure);
      });
    });
    safely(() => {
      storage.flushSecureWrites();
    });
  }
}

function checkAccessControlDefault(): string {
  try {
    storage.setAccessControl(AccessControl.AfterFirstUnlock);
    storage.setString(accessControlKey, "ac-ok", StorageScope.Secure);
    storage.flushSecureWrites();
    const value = storage.getString(accessControlKey, StorageScope.Secure);
    return value === "ac-ok"
      ? "ok:access=after-first-unlock:value=ac-ok"
      : `fail:access=after-first-unlock:value=${String(value)}`;
  } finally {
    safely(() => {
      storage.deleteString(accessControlKey, StorageScope.Secure);
    });
    safely(() => {
      storage.flushSecureWrites();
    });
    storage.setAccessControl(AccessControl.WhenUnlocked);
  }
}

function checkCoalescedSecure(): string {
  try {
    coalescedItem.set("coalesced");
    const beforeFlush = coalescedItem.get();
    storage.flushSecureWrites();
    const flushed = storage.getString(coalescedItem.key, StorageScope.Secure);
    return beforeFlush === "coalesced" && flushed !== undefined
      ? "ok:coalesced=read-before-flush:flushed"
      : `fail:coalesced=${beforeFlush}:flushed=${String(flushed)}`;
  } finally {
    safely(() => {
      coalescedItem.delete();
    });
    safely(() => {
      storage.flushSecureWrites();
    });
  }
}

function checkInvalidKey(): string {
  try {
    createStorageItem({ key: "", scope: StorageScope.Memory });
    return "fail:invalid_key:accepted";
  } catch (error) {
    const code = getStorageErrorCode(error);
    return code === "invalid_key"
      ? "ok:invalid_key"
      : `fail:invalid_key:${String(code)}`;
  }
}

function checkScopedMetrics(): string {
  try {
    storage.resetMetrics();
    storage.setMetricsObserver(() => {});
    storage.setString(metricsDiskKey, "m", StorageScope.Disk);
    storage.setString(metricsSecureKey, "m", StorageScope.Secure);
    const snapshot = storage.getScopedMetricsSnapshot();
    const disk =
      (snapshot[`storage:setString:${StorageScope.Disk}`]?.count ?? 0) > 0;
    const secure =
      (snapshot[`storage:setString:${StorageScope.Secure}`]?.count ?? 0) > 0;
    return disk && secure
      ? "ok:scoped=disk+secure"
      : `fail:scoped:disk=${disk}:secure=${secure}`;
  } finally {
    storage.setMetricsObserver(undefined);
    storage.resetMetrics();
    safely(() => {
      storage.deleteString(metricsDiskKey, StorageScope.Disk);
    });
    safely(() => {
      storage.deleteString(metricsSecureKey, StorageScope.Secure);
    });
    safely(() => {
      storage.flushDiskWrites();
    });
    safely(() => {
      storage.flushSecureWrites();
    });
  }
}

async function checkNativeDiskEvents(): Promise<string[]> {
  const events: StorageChangeEvent[] = [];
  const unsubscribe = storage.subscribeKey(
    StorageScope.Disk,
    diskEventKey,
    (event) => {
      events.push(event);
    },
  );
  try {
    storage.setString(diskEventKey, "disk-event", StorageScope.Disk);
    await resolveAfter(50);
    const observed = events
      .map((event) => `${event.operation}/${event.source}`)
      .join(",");
    const setEvent = events.find(
      (event) => event.type === "key" && event.operation === "set",
    );
    const primary = setEvent
      ? `ok:op=set:source=${setEvent.source}`
      : `fail:op=missing:events=${observed}`;
    return [primary, `disk-events=${events.length}:${observed}`];
  } finally {
    unsubscribe();
    safely(() => {
      storage.deleteString(diskEventKey, StorageScope.Disk);
    });
    safely(() => {
      storage.flushDiskWrites();
    });
  }
}

async function checkAuthStorageTtl(): Promise<string> {
  const auth = authStorage;
  try {
    auth.t.set("token");
    storage.flushSecureWrites();
    const before = auth.t.get();
    await resolveAfter(120);
    const after = auth.t.get();
    return before === "token" && after === ""
      ? "ok:auth-ttl=expired-default"
      : `fail:auth-ttl:before=${before}:after=${after}`;
  } finally {
    safely(() => {
      auth.t.delete();
    });
    safely(() => {
      storage.flushSecureWrites();
    });
  }
}

function checkPasscodeAcl(): string {
  try {
    storage.setAccessControl(AccessControl.WhenPasscodeSetThisDeviceOnly);
    storage.setString(passcodeKey, "passcode-ok", StorageScope.Secure);
    storage.flushSecureWrites();
    const value = storage.getString(passcodeKey, StorageScope.Secure);
    return value === "passcode-ok"
      ? "ok:passcode-acl=stored"
      : `passcode-acl=readback-${String(value)}`;
  } catch (error) {
    return `passcode-acl=${getStorageErrorCode(error) ?? `error:${error instanceof Error ? error.message : String(error)}`}`;
  } finally {
    safely(() => {
      storage.deleteString(passcodeKey, StorageScope.Secure);
    });
    safely(() => {
      storage.flushSecureWrites();
    });
    safely(() => {
      storage.setAccessControl(AccessControl.WhenUnlocked);
    });
  }
}

async function runExtendedSweep(): Promise<ExtCase[]> {
  const cases: ExtCase[] = [
    runSync("item-merge-setordelete", checkMergeAndSetOrDelete),
    runSync("set-toggle-values", checkSetToggleValues),
    runSync("clear-group", checkClearGroup),
  ];
  cases.push(await runAsync("expired-events", checkExpiredEvents));
  cases.push(runSync("secure-inventory", checkSecureInventory));
  cases.push(runSync("access-control-default", checkAccessControlDefault));
  cases.push(runSync("coalesce-secure", checkCoalescedSecure));
  cases.push(runSync("invalid-key", checkInvalidKey));
  cases.push(runSync("scoped-metrics", checkScopedMetrics));
  try {
    const [primary, observed] = await checkNativeDiskEvents();
    cases.push({ name: "native-disk-events", token: primary ?? "fail" });
    cases.push({ name: "native-disk-observed", token: observed ?? "" });
  } catch (error) {
    cases.push({
      name: "native-disk-events",
      token: `fail:native-disk-events:${describeError(error)}`,
    });
  }
  cases.push(await runAsync("auth-storage-ttl", checkAuthStorageTtl));
  cases.push(runSync("passcode-acl-probe", checkPasscodeAcl));
  return cases;
}

function HooksProbe({ onResult }: { onResult: (token: string) => void }) {
  const [value, setValue, actions] = useStorage(hooksItem);
  const observed = useStorageValue(hooksItem);
  const [count] = useStorageSelector(hooksItem, (current) => current.count);
  const setOnly = useSetStorage(hooksItem);
  const extraActions = useStorageActions(hooksItem);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (stage === 0) {
      setOnly({ count: 1, label: "setter" });
      setStage(1);
      return;
    }
    if (stage === 1) {
      if (value.label !== "setter" || observed.count !== 1 || count !== 1) {
        onResult(`fail:hooks:stage=1:count=${count}`);
        setStage(5);
        return;
      }
      setValue((previous) => ({ ...previous, count: previous.count + 1 }));
      setStage(2);
      return;
    }
    if (stage === 2) {
      if (count !== 2 || observed.label !== "setter") {
        onResult(`fail:hooks:stage=2:count=${count}`);
        setStage(5);
        return;
      }
      actions.merge({ label: "merged" });
      setStage(3);
      return;
    }
    if (stage === 3) {
      if (value.label !== "merged" || count !== 2) {
        onResult(`fail:hooks:stage=3:label=${value.label}`);
        setStage(5);
        return;
      }
      extraActions.remove();
      setStage(4);
      return;
    }
    if (stage === 4) {
      onResult(
        value === hooksDefault && count === 0
          ? "ok:hooks=value,selector,setter,actions"
          : `fail:hooks:stage=4:count=${count}`,
      );
      setStage(5);
    }
  }, [
    actions,
    count,
    extraActions,
    observed,
    onResult,
    setOnly,
    setValue,
    stage,
    value,
  ]);

  return null;
}

export default function ApiExtendedScreen() {
  const [cases, setCases] = useState<ExtCase[] | null>(null);
  const [hooksToken, setHooksToken] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    runExtendedSweep()
      .then((result) => {
        if (mounted) {
          setCases(result);
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setCases([
            { name: "sweep", token: `fail:sweep:${describeError(error)}` },
          ]);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const tokens = [
    ...(cases ?? []).map((item) => item.token),
    ...(hooksToken ? [hooksToken] : []),
  ];
  const finished = cases !== null && hooksToken !== null;

  return (
    <View
      testID="e2e-api-extended-screen"
      style={{ flex: 1 }}
      accessibilityLabel="API extended lab"
    >
      <Page
        title="API extended lab"
        subtitle="Deep link nitrostorage://e2e-api-extended"
      >
        <View
          testID="e2e-ext-results"
          accessible
          accessibilityLabel={tokens.map((token) => `${token};`).join("")}
          style={localStyles.resultsProbe}
        />
        <StatusRow
          testID="e2e-ext-finished"
          label="run"
          value={finished ? "finished" : "running"}
        />
        <HooksProbe onResult={setHooksToken} />
        <Card title="Cases" subtitle="Items, sets, groups, TTL, Secure, hooks">
          {(cases ?? []).map((item) => (
            <StatusRow key={item.name} label={item.name} value={item.token} />
          ))}
          <StatusRow label="hooks" value={hooksToken ?? "running"} />
        </Card>
      </Page>
    </View>
  );
}

const localStyles = StyleSheet.create({
  resultsProbe: {
    height: 1,
  },
});
