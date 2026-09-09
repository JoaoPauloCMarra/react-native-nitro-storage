import { View } from "react-native";
import { StorageE2eLab } from "../components/e2e-lab";
import { Page, StatusRow } from "../components/shared";
import { SmokeTestRunner } from "../components/smoke-test";

export default function StorageE2eScreen() {
  return (
    <View testID="e2e-screen" style={{ flex: 1 }} accessibilityLabel="E2E lab">
      <Page title="E2E lab" subtitle="Deep link nitrostorage://e2e">
        <StatusRow testID="e2e-ready" label="state" value="e2e-ready" />
        <StatusRow
          testID="e2e-deeplink"
          label="link"
          value="nitrostorage://e2e"
        />
        <StorageE2eLab />
        <SmokeTestRunner />
      </Page>
    </View>
  );
}
