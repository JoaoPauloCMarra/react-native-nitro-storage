import { Pressable, Text } from "react-native";
import { Link } from "expo-router";
import { Colors } from "./shared";

export function E2eGate() {
  return (
    <>
      <Link href={"/e2e"} asChild>
        <Pressable
          testID="open-e2e-lab"
          accessibilityRole="link"
          accessibilityLabel="Open E2E lab"
          style={{ alignSelf: "flex-start", marginTop: 16, paddingVertical: 6 }}
        >
          <Text
            style={{ color: Colors.muted, fontSize: 12, fontWeight: "600" }}
          >
            E2E lab
          </Text>
        </Pressable>
      </Link>
      <Link href="/e2e-integrity" asChild>
        <Pressable
          testID="open-e2e-integrity-home"
          accessibilityRole="link"
          accessibilityLabel="Open integrity lab"
          style={{ alignSelf: "flex-start", paddingVertical: 6 }}
        >
          <Text
            style={{ color: Colors.muted, fontSize: 12, fontWeight: "600" }}
          >
            Integrity lab
          </Text>
        </Pressable>
      </Link>
      <Link href="/e2e-keychain" asChild>
        <Pressable
          testID="open-e2e-keychain-home"
          accessibilityRole="link"
          accessibilityLabel="Open keychain lab"
          style={{ alignSelf: "flex-start", paddingVertical: 6 }}
        >
          <Text
            style={{ color: Colors.muted, fontSize: 12, fontWeight: "600" }}
          >
            Keychain lab
          </Text>
        </Pressable>
      </Link>
      <Link href="/e2e-stress" asChild>
        <Pressable
          testID="open-e2e-stress-home"
          accessibilityRole="link"
          accessibilityLabel="Open stress lab"
          style={{ alignSelf: "flex-start", paddingVertical: 6 }}
        >
          <Text
            style={{ color: Colors.muted, fontSize: 12, fontWeight: "600" }}
          >
            Stress lab
          </Text>
        </Pressable>
      </Link>
    </>
  );
}
