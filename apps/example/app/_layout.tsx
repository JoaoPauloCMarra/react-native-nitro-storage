import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, View, Text, Platform } from "react-native";
import { Colors } from "../components/shared";

export default function RootLayout() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: true,
          headerStyle: {
            backgroundColor: Colors.background,
            borderBottomWidth: 0,
            elevation: 0,
            shadowOpacity: 0,
          },
          headerTintColor: Colors.text,
          headerTitleStyle: {
            fontSize: 20,
            fontWeight: "800",
            letterSpacing: -0.5,
          },
          tabBarStyle: {
            backgroundColor: Colors.surface,
            borderTopWidth: 1,
            borderTopColor: Colors.border,
            height: Platform.OS === "ios" ? 88 : 64,
            paddingTop: 8,
            paddingBottom: Platform.OS === "ios" ? 28 : 12,
            ...Platform.select({
              web: {
                boxShadow: "0 -4px 12px rgba(0,0,0,0.5)",
              },
            }),
          },
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.muted,
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: "700",
            marginTop: 4,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Memory",
            tabBarIcon: ({ color }) => (
              <Text
                style={{
                  fontSize: 20,
                  opacity: color === Colors.primary ? 1 : 0.5,
                }}
              >
                ⚡️
              </Text>
            ),
            tabBarLabel: "MEMORY",
          }}
        />
        <Tabs.Screen
          name="disk"
          options={{
            title: "Disk",
            tabBarIcon: ({ color }) => (
              <Text
                style={{
                  fontSize: 20,
                  opacity: color === Colors.primary ? 1 : 0.5,
                }}
              >
                💾
              </Text>
            ),
            tabBarLabel: "DISK",
          }}
        />
        <Tabs.Screen
          name="secure"
          options={{
            title: "Secure",
            tabBarIcon: ({ color }) => (
              <Text
                style={{
                  fontSize: 20,
                  opacity: color === Colors.primary ? 1 : 0.5,
                }}
              >
                🔒
              </Text>
            ),
            tabBarLabel: "SECURE",
          }}
        />
        <Tabs.Screen
          name="complex"
          options={{
            title: "Objects",
            tabBarIcon: ({ color }) => (
              <Text
                style={{
                  fontSize: 20,
                  opacity: color === Colors.primary ? 1 : 0.5,
                }}
              >
                🧩
              </Text>
            ),
            tabBarLabel: "OBJECTS",
          }}
        />
        <Tabs.Screen
          name="tools"
          options={{
            title: "Tools",
            tabBarIcon: ({ color }) => (
              <Text
                style={{
                  fontSize: 20,
                  opacity: color === Colors.primary ? 1 : 0.5,
                }}
              >
                🛠️
              </Text>
            ),
            tabBarLabel: "TOOLS",
          }}
        />
        <Tabs.Screen
          name="benchmark"
          options={{
            title: "Benchmark",
            headerShown: false,
            tabBarIcon: ({ color }) => (
              <Text
                style={{
                  fontSize: 20,
                  opacity: color === Colors.primary ? 1 : 0.5,
                }}
              >
                📊
              </Text>
            ),
            tabBarLabel: "PERF",
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
