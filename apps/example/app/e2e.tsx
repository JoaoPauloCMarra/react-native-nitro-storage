import { Pressable, Text, View } from "react-native";
import { Link, type Href } from "expo-router";
import { StorageE2eLab } from "../components/e2e-lab";
import { Colors, Page, StatusRow } from "../components/shared";
import { SmokeTestRunner } from "../components/smoke-test";

function LabLink({
  href,
  testID,
  label,
}: {
  href: string;
  testID: string;
  label: string;
}) {
  return (
    <Link href={href as Href} asChild>
      <Pressable
        testID={testID}
        accessibilityRole="link"
        accessibilityLabel={label}
        style={{ paddingVertical: 8 }}
      >
        <Text style={{ color: Colors.primary, fontWeight: "600" }}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

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
        <LabLink
          href="/e2e-stress"
          testID="open-e2e-stress"
          label="Stress lab"
        />
        <StorageE2eLab />
        <SmokeTestRunner />
      </Page>
    </View>
  );
}
