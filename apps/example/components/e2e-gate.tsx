import { Pressable, Text } from "react-native";
import { Link } from "expo-router";
import { Colors } from "./shared";

export function E2eGate() {
  return (
    <Link href={"/e2e"} asChild>
      <Pressable
        testID="open-e2e-lab"
        accessibilityRole="link"
        accessibilityLabel="Open E2E lab"
        style={{ alignSelf: "flex-start", marginTop: 16, paddingVertical: 6 }}
      >
        <Text style={{ color: Colors.muted, fontSize: 12, fontWeight: "600" }}>
          E2E lab
        </Text>
      </Pressable>
    </Link>
  );
}
