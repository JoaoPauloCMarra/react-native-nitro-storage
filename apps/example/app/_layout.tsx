import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Colors } from "../components/shared";

function TabGlyph({
  glyph,
  color,
  focused,
  size = 17,
}: {
  glyph: string;
  color: string;
  focused: boolean;
  size?: number;
}) {
  return (
    <Text style={{ fontSize: size, color, opacity: focused ? 1 : 0.75 }}>{glyph}</Text>
  );
}

export default function RootLayout() {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isCompactWeb = isWeb && width < 900;
  const showWebLabels = !isCompactWeb;
  const iconSize = isCompactWeb ? 18 : 17;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: isWeb ? showWebLabels : true,
          tabBarItemStyle: {
            borderRadius: 12,
            marginHorizontal: isCompactWeb ? 0 : 2,
            minWidth: isCompactWeb ? 40 : undefined,
          },
          tabBarActiveBackgroundColor: Colors.card,
          tabBarStyle: {
            backgroundColor: Colors.surface,
            borderWidth: 1,
            borderColor: Colors.border,
            height: isWeb ? (isCompactWeb ? 64 : 74) : Platform.OS === "ios" ? 84 : 66,
            position: isWeb ? "relative" : "absolute",
            left: isWeb ? undefined : 12,
            right: isWeb ? undefined : 12,
            bottom: isWeb ? undefined : Platform.OS === "ios" ? 14 : 10,
            marginHorizontal: isWeb ? (isCompactWeb ? 8 : 20) : undefined,
            marginBottom: isWeb ? 12 : undefined,
            maxWidth: isWeb ? 920 : undefined,
            alignSelf: isWeb ? "center" : undefined,
            width: isWeb ? "100%" : undefined,
            borderRadius: isWeb ? 16 : 18,
            paddingTop: isWeb ? 8 : 8,
            paddingBottom: isWeb ? (isCompactWeb ? 6 : 8) : Platform.OS === "ios" ? 10 : 8,
            paddingHorizontal: isWeb ? (isCompactWeb ? 0 : 8) : 6,
            ...Platform.select({
              web: {
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
              },
            }),
          },
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.muted,
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: "700",
            marginTop: 1,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Memory",
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph glyph="⚡" color={color} focused={focused} size={iconSize} />
            ),
            tabBarLabel: showWebLabels ? "MEMORY" : undefined,
          }}
        />
        <Tabs.Screen
          name="disk"
          options={{
            title: "Disk",
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph glyph="💾" color={color} focused={focused} size={iconSize} />
            ),
            tabBarLabel: showWebLabels ? "DISK" : undefined,
          }}
        />
        <Tabs.Screen
          name="secure"
          options={{
            title: "Secure",
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph glyph="🔒" color={color} focused={focused} size={iconSize} />
            ),
            tabBarLabel: showWebLabels ? "SECURE" : undefined,
          }}
        />
        <Tabs.Screen
          name="complex"
          options={{
            title: "Objects",
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph glyph="🧩" color={color} focused={focused} size={iconSize} />
            ),
            tabBarLabel: showWebLabels ? "OBJECTS" : undefined,
          }}
        />
        <Tabs.Screen
          name="tools"
          options={{
            title: "Tools",
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph glyph="🛠" color={color} focused={focused} size={iconSize} />
            ),
            tabBarLabel: showWebLabels ? "TOOLS" : undefined,
          }}
        />
        <Tabs.Screen
          name="features"
          options={{
            title: "Features",
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph glyph="🧪" color={color} focused={focused} size={iconSize} />
            ),
            tabBarLabel: showWebLabels ? "FEATURES" : undefined,
          }}
        />
        <Tabs.Screen
          name="benchmark"
          options={{
            title: "Benchmark",
            headerShown: false,
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph glyph="📊" color={color} focused={focused} size={iconSize} />
            ),
            tabBarLabel: showWebLabels ? "PERF" : undefined,
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
