import { LabLink } from "../components/e2e-gate";
import { StorageE2eLab } from "../components/e2e-lab";
import { LabScreen, StatusRow } from "../components/shared";
import { SmokeTestRunner } from "../components/smoke-test";

export default function StorageE2eScreen() {
  return (
    <LabScreen
      testID="e2e-screen"
      label="E2E lab"
      title="E2E lab"
      subtitle="Deep link nitrostorage://e2e"
    >
      <StatusRow testID="e2e-ready" label="state" value="e2e-ready" />
      <StatusRow
        testID="e2e-deeplink"
        label="link"
        value="nitrostorage://e2e"
      />
      <LabLink
        href="/e2e-integrity"
        testID="open-e2e-integrity"
        label="Integrity lab"
      />
      <LabLink
        href="/e2e-keychain"
        testID="open-e2e-keychain"
        label="Keychain lab"
      />
      <LabLink href="/e2e-stress" testID="open-e2e-stress" label="Stress lab" />
      <SmokeTestRunner />
      <StorageE2eLab />
    </LabScreen>
  );
}
