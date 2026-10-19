import { AdvancedApiDemo } from "../components/advanced-api-demo";
import { E2eGate } from "../components/e2e-gate";
import { ErgonomicsDemo } from "../components/ergonomics-demo";
import {
  BatchCard,
  HooksCard,
  MigrationsCard,
  PrefixKeysCard,
  RawStringCard,
  TransactionsCard,
  TtlCard,
  ValidationCard,
} from "../components/home-feature-cards";
import {
  AuthStorageCard,
  DiskScopeCard,
  JsonObjectsCard,
  MemoryScopeCard,
  NamespacedAuthCard,
  NamespacesCard,
  SecureExportCard,
  SecureObserverCard,
  SecureScopeCard,
} from "../components/home-scope-cards";
import {
  CapabilitiesCard,
  DiskBufferingCard,
  RuntimeBenchmarkCard,
  ScopeControlCard,
  StorageUtilsCard,
  WebBackendCard,
} from "../components/home-utility-cards";
import { KeychainLifecycleProbe } from "../components/keychain-lifecycle-probe";
import { Page } from "../components/shared";
import { SmokeTestRunner } from "../components/smoke-test";

export default function HomeScreen() {
  return (
    <Page title="Nitro Storage" subtitle="Complete feature showcase">
      <E2eGate />
      <SmokeTestRunner />

      <KeychainLifecycleProbe />

      <ErgonomicsDemo />
      <AdvancedApiDemo />

      <MemoryScopeCard />
      <SecureExportCard />
      <SecureObserverCard />
      <DiskScopeCard />
      <SecureScopeCard />
      <NamespacesCard />
      <JsonObjectsCard />
      <AuthStorageCard />
      <NamespacedAuthCard />
      <StorageUtilsCard />
      <HooksCard />
      <ValidationCard />
      <TtlCard />
      <TransactionsCard />
      <MigrationsCard />
      <BatchCard />
      <ScopeControlCard />
      <RawStringCard />
      <PrefixKeysCard />
      <CapabilitiesCard />
      <RuntimeBenchmarkCard />
      <WebBackendCard />
      <DiskBufferingCard />
    </Page>
  );
}
