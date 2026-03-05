/**
 * Reproduces a real-world app storage setup with namespaced auth tokens,
 * migration patterns, and multi-scope usage.
 * Use this screen to validate all storage scenarios on a real device
 * before shipping react-native-nitro-storage changes.
 */

import { useState } from "react";
import { Text, View } from "react-native";
import {
  createSecureAuthStorage,
  createStorageItem,
  storage,
  StorageScope,
  useStorage,
} from "react-native-nitro-storage";
import {
  Badge,
  Button,
  Card,
  Colors,
  CodeBlock,
  Page,
  Section,
  StatusRow,
  styles,
} from "../components/shared";

// ---------------------------------------------------------------------------
// Real-world auth storage setup
// ---------------------------------------------------------------------------

const AUTH_STORAGE_NAMESPACE = "app-auth";

const authSecureStorage = createSecureAuthStorage(
  { accessToken: {}, refreshToken: {} },
  { namespace: AUTH_STORAGE_NAMESPACE },
);

const legacyAccessTokenAtom = createStorageItem<string | null>({
  key: "authToken",
  scope: StorageScope.Secure,
  defaultValue: null,
});

const legacyRefreshTokenAtom = createStorageItem<string | null>({
  key: "refreshToken",
  scope: StorageScope.Secure,
  defaultValue: null,
});

const loginMethodAtom = createStorageItem<string | null>({
  key: "loginMethod",
  scope: StorageScope.Disk,
  defaultValue: null,
});

const groupShareIntroSkipAtom = createStorageItem({
  key: "groupShareIntroSkip",
  scope: StorageScope.Disk,
  defaultValue: false,
});

const logoutInProgressAtom = createStorageItem({
  key: "logoutInProgress",
  scope: StorageScope.Memory,
  defaultValue: false,
});

// Used in Scenario F to verify namespace isolation
const otherSecretItem = createStorageItem({
  key: "other-secret",
  scope: StorageScope.Secure,
  defaultValue: "",
});

// Migration state — module-level singleton
let didMigrateLegacyAuthTokens = false;

const normalizeToken = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
};

const migrateLegacyAuthTokens = () => {
  if (didMigrateLegacyAuthTokens) return;
  didMigrateLegacyAuthTokens = true;

  try {
    const namespacedAccess = normalizeToken(authSecureStorage.accessToken.get());
    const namespacedRefresh = normalizeToken(authSecureStorage.refreshToken.get());
    const legacyAccess = normalizeToken(legacyAccessTokenAtom.get());
    const legacyRefresh = normalizeToken(legacyRefreshTokenAtom.get());

    if (!namespacedAccess && legacyAccess) {
      authSecureStorage.accessToken.set(legacyAccess);
    }
    if (!namespacedRefresh && legacyRefresh) {
      authSecureStorage.refreshToken.set(legacyRefresh);
    }

    legacyAccessTokenAtom.delete();
    legacyRefreshTokenAtom.delete();
  } catch {
    // Keychain may be inaccessible on first launch before device unlock (iOS).
    // Reset the flag so migration is retried on the next call.
    didMigrateLegacyAuthTokens = false;
  }
};

const getAccessToken = (): string | null => {
  migrateLegacyAuthTokens();
  return normalizeToken(authSecureStorage.accessToken.get());
};

const getRefreshToken = (): string | null => {
  migrateLegacyAuthTokens();
  return normalizeToken(authSecureStorage.refreshToken.get());
};

const persistAuthSession = (params: {
  accessToken: string;
  refreshToken?: string | null;
  loginMethod?: string | null;
}) => {
  migrateLegacyAuthTokens();
  if (params.loginMethod !== undefined) {
    if (params.loginMethod) {
      loginMethodAtom.set(params.loginMethod);
    } else {
      loginMethodAtom.delete();
    }
  }
  authSecureStorage.accessToken.set(params.accessToken);
  if ("refreshToken" in params) {
    if (params.refreshToken) {
      authSecureStorage.refreshToken.set(params.refreshToken);
    } else {
      authSecureStorage.refreshToken.delete();
    }
  }
};

const clearAuthSessionStorage = () => {
  storage.flushSecureWrites?.();
  loginMethodAtom.delete();
  authSecureStorage.accessToken.delete();
  authSecureStorage.refreshToken.delete();
  storage.clearNamespace(AUTH_STORAGE_NAMESPACE, StorageScope.Secure);
  legacyAccessTokenAtom.delete();
  legacyRefreshTokenAtom.delete();
};

const clearStorageForLogout = () => {
  const groupShareIntroSkip = groupShareIntroSkipAtom.get() ?? false;
  clearAuthSessionStorage();
  storage.clear(StorageScope.Memory);
  storage.clear(StorageScope.Disk);
  groupShareIntroSkipAtom.set(groupShareIntroSkip);
};

const resetMigrationFlag = () => {
  didMigrateLegacyAuthTokens = false;
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function AppStorageScreen() {
  const [accessToken] = useStorage(authSecureStorage.accessToken);
  const [refreshToken] = useStorage(authSecureStorage.refreshToken);
  const [legacyAccess] = useStorage(legacyAccessTokenAtom);
  const [legacyRefresh] = useStorage(legacyRefreshTokenAtom);
  const [loginMethod] = useStorage(loginMethodAtom);
  const [groupShareIntroSkip] = useStorage(groupShareIntroSkipAtom);
  const [logoutInProgress] = useStorage(logoutInProgressAtom);
  const [otherSecret] = useStorage(otherSecretItem);

  const [lastReadAccess, setLastReadAccess] = useState<string>("(not read yet)");
  const [lastReadRefresh, setLastReadRefresh] = useState<string>("(not read yet)");
  const [migrationRan, setMigrationRan] = useState(false);

  const displayToken = (v: string | null) =>
    v === null ? "null ✗" : `"${v}" ✓`;

  return (
    <Page
      title="App Storage"
      subtitle="Real-world storage setup — validate before shipping"
    >
      {/* ------------------------------------------------------------------ */}
      {/* Live state                                                           */}
      {/* ------------------------------------------------------------------ */}
      <Card
        title="Live State"
        subtitle="Reactive — updates immediately on change"
        indicatorColor={Colors.secure}
      >
        <Section title="Namespaced secure (app-auth)">
          <StatusRow
            label="accessToken"
            value={accessToken || "(empty)"}
            color={accessToken ? Colors.success : Colors.muted}
            testID="as-live-access"
          />
          <StatusRow
            label="refreshToken"
            value={refreshToken || "(empty)"}
            color={refreshToken ? Colors.success : Colors.muted}
            testID="as-live-refresh"
          />
        </Section>
        <Section title="Legacy secure (pre-migration)">
          <StatusRow
            label="authToken"
            value={legacyAccess || "(empty)"}
            color={legacyAccess ? Colors.warning : Colors.muted}
            testID="as-live-legacy-access"
          />
          <StatusRow
            label="refreshToken"
            value={legacyRefresh || "(empty)"}
            color={legacyRefresh ? Colors.warning : Colors.muted}
            testID="as-live-legacy-refresh"
          />
        </Section>
        <Section title="Disk">
          <StatusRow
            label="loginMethod"
            value={loginMethod ?? "(null)"}
            color={loginMethod ? Colors.disk : Colors.muted}
            testID="as-live-login-method"
          />
          <StatusRow
            label="groupShareIntroSkip"
            value={String(groupShareIntroSkip)}
            color={groupShareIntroSkip ? Colors.success : Colors.muted}
            testID="as-live-group-skip"
          />
        </Section>
        <Section title="Memory">
          <StatusRow
            label="logoutInProgress"
            value={String(logoutInProgress)}
            color={logoutInProgress ? Colors.danger : Colors.muted}
            testID="as-live-logout-progress"
          />
        </Section>
        <Section title="Migration">
          <StatusRow
            label="didMigrateLegacyAuthTokens"
            value={String(migrationRan)}
            color={migrationRan ? Colors.success : Colors.muted}
            testID="as-live-migration-flag"
          />
        </Section>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Scenario A – Fresh install                                           */}
      {/* ------------------------------------------------------------------ */}
      <Card
        title="A — Fresh Install"
        subtitle="No tokens anywhere → getAccessToken returns null"
        indicatorColor={Colors.primary}
      >
        <Text style={styles.helperText}>
          Expected: both reads return null. Migration runs but finds nothing to
          migrate. Legacy atoms remain empty.
        </Text>
        <View style={styles.row}>
          <Button
            title="1. Reset Everything"
            variant="danger"
            onPress={() => {
              storage.clearAll();
              resetMigrationFlag();
              setMigrationRan(false);
              setLastReadAccess("(not read yet)");
              setLastReadRefresh("(not read yet)");
            }}
            style={styles.flex1}
            testID="as-a-reset"
          />
          <Button
            title="2. Read Tokens"
            onPress={() => {
              const a = getAccessToken();
              const r = getRefreshToken();
              setLastReadAccess(displayToken(a));
              setLastReadRefresh(displayToken(r));
              setMigrationRan(didMigrateLegacyAuthTokens);
            }}
            style={styles.flex1}
            testID="as-a-read"
          />
        </View>
        <StatusRow label="getAccessToken()" value={lastReadAccess} testID="as-a-access-result" />
        <StatusRow label="getRefreshToken()" value={lastReadRefresh} testID="as-a-refresh-result" />
        <View style={styles.row}>
          <Badge label="Expected: null" color={Colors.primary} />
          <Badge label="Migration ran" color={Colors.accent} />
        </View>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Scenario B – Upgrade with legacy tokens                              */}
      {/* ------------------------------------------------------------------ */}
      <Card
        title="B — Upgrade: Legacy → Namespaced"
        subtitle="Old tokens exist, namespaced empty → migration copies them"
        indicatorColor={Colors.warning}
      >
        <Text style={styles.helperText}>
          Simulates a user upgrading from the old storage format. Legacy tokens
          must be moved to the namespaced keys and then deleted.
        </Text>
        <View style={styles.row}>
          <Button
            title="1. Reset + Set Legacy"
            variant="secondary"
            onPress={() => {
              storage.clearAll();
              resetMigrationFlag();
              setMigrationRan(false);
              setLastReadAccess("(not read yet)");
              setLastReadRefresh("(not read yet)");
              // Write to the old (non-namespaced) keys
              legacyAccessTokenAtom.set("legacy_access_abc");
              legacyRefreshTokenAtom.set("legacy_refresh_xyz");
            }}
            style={styles.flex1}
            testID="as-b-setup"
          />
          <Button
            title="2. Read Tokens"
            onPress={() => {
              const a = getAccessToken();
              const r = getRefreshToken();
              setLastReadAccess(displayToken(a));
              setLastReadRefresh(displayToken(r));
              setMigrationRan(didMigrateLegacyAuthTokens);
            }}
            style={styles.flex1}
            testID="as-b-read"
          />
        </View>
        <StatusRow label="getAccessToken()" value={lastReadAccess} testID="as-b-access-result" />
        <StatusRow label="getRefreshToken()" value={lastReadRefresh} testID="as-b-refresh-result" />
        <View style={styles.row}>
          <Badge label='Expected: "legacy_access_abc"' color={Colors.warning} />
          <Badge label="Legacy keys cleared" color={Colors.accent} />
        </View>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Scenario C – No overwrite                                            */}
      {/* ------------------------------------------------------------------ */}
      <Card
        title="C — No Overwrite: Namespaced Wins"
        subtitle="Both exist → namespaced token must not be overwritten"
        indicatorColor={Colors.secure}
      >
        <Text style={styles.helperText}>
          If a namespaced token already exists, the legacy token must be ignored
          and deleted without overwriting the current session.
        </Text>
        <View style={styles.row}>
          <Button
            title="1. Set Both"
            variant="secondary"
            onPress={() => {
              storage.clearAll();
              resetMigrationFlag();
              setMigrationRan(false);
              setLastReadAccess("(not read yet)");
              // Pre-set the namespaced token directly (bypassing migration)
              authSecureStorage.accessToken.set("namespaced_token_current");
              // Also set a legacy token that should NOT overwrite
              legacyAccessTokenAtom.set("stale_legacy_token");
            }}
            style={styles.flex1}
            testID="as-c-setup"
          />
          <Button
            title="2. Read Token"
            onPress={() => {
              const a = getAccessToken();
              setLastReadAccess(displayToken(a));
              setMigrationRan(didMigrateLegacyAuthTokens);
            }}
            style={styles.flex1}
            testID="as-c-read"
          />
        </View>
        <StatusRow label="getAccessToken()" value={lastReadAccess} testID="as-c-access-result" />
        <View style={styles.row}>
          <Badge label='Expected: "namespaced_token_current"' color={Colors.secure} />
        </View>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Scenario D – Normal session lifecycle                                */}
      {/* ------------------------------------------------------------------ */}
      <Card
        title="D — Normal Session Lifecycle"
        subtitle="persistAuthSession → clear → verify"
        indicatorColor={Colors.disk}
      >
        <Text style={styles.helperText}>
          Standard signin/signout flow: persist tokens, verify they appear, then
          clear auth and verify they're gone.
        </Text>
        <View style={styles.row}>
          <Button
            title="Persist Session"
            onPress={() => {
              persistAuthSession({
                accessToken: "at_" + Date.now().toString(36),
                refreshToken: "rt_" + Date.now().toString(36),
                loginMethod: "otp_email",
              });
              setMigrationRan(didMigrateLegacyAuthTokens);
            }}
            style={styles.flex1}
            testID="as-d-persist"
          />
          <Button
            title="Clear Auth"
            variant="danger"
            onPress={() => {
              clearAuthSessionStorage();
            }}
            testID="as-d-clear"
          />
        </View>
        <StatusRow
          label="accessToken"
          value={accessToken || "(empty)"}
          color={accessToken ? Colors.success : Colors.muted}
          testID="as-d-access"
        />
        <StatusRow
          label="refreshToken"
          value={refreshToken || "(empty)"}
          color={refreshToken ? Colors.success : Colors.muted}
          testID="as-d-refresh"
        />
        <StatusRow
          label="loginMethod"
          value={loginMethod ?? "(null)"}
          color={loginMethod ? Colors.disk : Colors.muted}
          testID="as-d-login-method"
        />
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Scenario E – Logout preserves groupShareIntroSkip                   */}
      {/* ------------------------------------------------------------------ */}
      <Card
        title="E — Logout Preserves groupShareIntroSkip"
        subtitle="clearStorageForLogout must keep this one disk key"
        indicatorColor={Colors.memory}
      >
        <Text style={styles.helperText}>
          After logout all disk/memory/auth storage is wiped, but
          groupShareIntroSkip must survive.
        </Text>
        <View style={styles.row}>
          <Button
            title="1. Setup"
            variant="secondary"
            onPress={() => {
              persistAuthSession({ accessToken: "at_before_logout" });
              groupShareIntroSkipAtom.set(true);
              logoutInProgressAtom.set(true);
            }}
            style={styles.flex1}
            testID="as-e-setup"
          />
          <Button
            title="2. Logout"
            variant="danger"
            onPress={() => {
              clearStorageForLogout();
            }}
            style={styles.flex1}
            testID="as-e-logout"
          />
        </View>
        <StatusRow
          label="accessToken (must be empty)"
          value={accessToken || "empty ✓"}
          color={accessToken ? Colors.danger : Colors.success}
          testID="as-e-access"
        />
        <StatusRow
          label="loginMethod (must be null)"
          value={loginMethod ?? "null ✓"}
          color={loginMethod ? Colors.danger : Colors.success}
          testID="as-e-login-method"
        />
        <StatusRow
          label="logoutInProgress (must be false)"
          value={String(logoutInProgress)}
          color={logoutInProgress ? Colors.danger : Colors.success}
          testID="as-e-logout-progress"
        />
        <StatusRow
          label="groupShareIntroSkip (must be true)"
          value={String(groupShareIntroSkip)}
          color={groupShareIntroSkip ? Colors.success : Colors.danger}
          testID="as-e-group-skip"
        />
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Scenario F – Namespace isolation                                     */}
      {/* ------------------------------------------------------------------ */}
      <Card
        title="F — Namespace Isolation"
        subtitle="clearNamespace('app-auth') must not touch other secure keys"
        indicatorColor={Colors.secure}
      >
        <Text style={styles.helperText}>
          A standalone secure item (key: "other-secret") must be unaffected when
          the app-auth namespace is cleared.
        </Text>
        <CodeBlock>{`storage.clearNamespace("app-auth", Secure)`}</CodeBlock>
        <View style={styles.row}>
          <Button
            title="1. Set All"
            variant="secondary"
            onPress={() => {
              authSecureStorage.accessToken.set("ns_access");
              authSecureStorage.refreshToken.set("ns_refresh");
              otherSecretItem.set("keep-me");
            }}
            style={styles.flex1}
            testID="as-f-set-all"
          />
          <Button
            title="2. Clear Namespace"
            variant="danger"
            onPress={() => {
              storage.clearNamespace(AUTH_STORAGE_NAMESPACE, StorageScope.Secure);
            }}
            style={styles.flex1}
            testID="as-f-clear-ns"
          />
        </View>
        <StatusRow
          label="accessToken (must be empty)"
          value={accessToken || "empty ✓"}
          color={accessToken ? Colors.danger : Colors.success}
          testID="as-f-access"
        />
        <StatusRow
          label="refreshToken (must be empty)"
          value={refreshToken || "empty ✓"}
          color={refreshToken ? Colors.danger : Colors.success}
          testID="as-f-refresh"
        />
        <StatusRow
          label='other-secret (must be "keep-me")'
          value={otherSecret || "(gone ✗)"}
          color={otherSecret === "keep-me" ? Colors.success : Colors.danger}
          testID="as-f-other-secret"
        />
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Migration re-test utility                                            */}
      {/* ------------------------------------------------------------------ */}
      <Card title="Migration Flag" subtitle="Reset to re-run migration tests">
        <Text style={styles.helperText}>
          migrateLegacyAuthTokens() only runs once per JS session (module-level
          flag). Tap Reset to simulate a fresh app launch without restarting.
        </Text>
        <Button
          title="Reset Migration Flag"
          variant="secondary"
          onPress={() => {
            resetMigrationFlag();
            setMigrationRan(false);
            setLastReadAccess("(not read yet)");
            setLastReadRefresh("(not read yet)");
          }}
          testID="as-mig-reset"
        />
        <StatusRow
          label="didMigrateLegacyAuthTokens"
          value={String(migrationRan)}
          color={migrationRan ? Colors.primary : Colors.muted}
          testID="as-mig-status"
        />
      </Card>
    </Page>
  );
}
