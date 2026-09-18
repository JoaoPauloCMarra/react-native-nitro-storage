import { Pressable, Text } from "react-native";
import { Link, type Href } from "expo-router";
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
      <Link href={"/e2e-integrity" as Href} asChild>
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
    </>
  );
}
