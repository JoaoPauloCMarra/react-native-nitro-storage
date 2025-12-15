import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, View, Text } from "react-native";

export default function RootLayout() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerStyle: {
            backgroundColor: "#0f0f0f",
          },
          headerTintColor: "#e0e0e0",
          headerTitleStyle: {
            fontSize: 24,
            fontWeight: "600",
          },
          tabBarStyle: {
            backgroundColor: "#0f0f0f",
            borderTopColor: "#252525",
          },
          tabBarActiveTintColor: "#4ade80",
          tabBarInactiveTintColor: "#666",
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Memory",
            tabBarIcon: () => <Text style={{ fontSize: 20 }}>⚡️</Text>,
            tabBarLabel: "Memory",
          }}
        />
        <Tabs.Screen
          name="disk"
          options={{
            title: "Disk",
            tabBarIcon: () => <Text style={{ fontSize: 20 }}>💾</Text>,
            tabBarLabel: "Disk",
          }}
        />
        <Tabs.Screen
          name="secure"
          options={{
            title: "Secure",
            tabBarIcon: () => <Text style={{ fontSize: 20 }}>🔒</Text>,
            tabBarLabel: "Secure",
          }}
        />
        <Tabs.Screen
          name="complex"
          options={{
            title: "Objects",
            tabBarIcon: () => <Text style={{ fontSize: 20 }}>🧩</Text>,
            tabBarLabel: "Objects",
          }}
        />
        <Tabs.Screen
          name="benchmark"
          options={{
            title: "Benchmark",
            tabBarIcon: () => <Text style={{ fontSize: 20 }}>📊</Text>,
            tabBarLabel: "Benchmark",
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
});
