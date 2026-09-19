import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="e2e" />
        <Stack.Screen name="e2e-integrity" />
        <Stack.Screen name="e2e-keychain" />
        <Stack.Screen name="e2e-stress" />
      </Stack>
    </>
  );
}
