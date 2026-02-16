import {
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Colors } from "../components/shared";

function TabIcon({
  glyph,
  color,
  focused,
  size = 16,
}: {
  glyph: string;
  color: string;
  focused: boolean;
  size?: number;
}) {
  return (
    <Text style={{ fontSize: size, color, opacity: focused ? 1 : 0.7 }}>
      {glyph}
    </Text>
  );
}

export default function RootLayout() {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const compact = isWeb && width < 800;
  const showLabels = !compact;
  const iconSize = compact ? 17 : 16;

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: isWeb ? showLabels : true,
          tabBarItemStyle: {
            borderRadius: 10,
            marginHorizontal: compact ? 0 : 2,
            minWidth: compact ? 38 : undefined,
          },
          tabBarActiveBackgroundColor: Colors.card,
          tabBarStyle: {
            backgroundColor: Colors.surface,
            borderWidth: 1,
            borderColor: Colors.border,
            height: isWeb
              ? compact
                ? 60
                : 68
              : Platform.OS === "ios"
                ? 82
                : 64,
            position: isWeb ? "relative" : "absolute",
            left: isWeb ? undefined : 12,
            right: isWeb ? undefined : 12,
            bottom: isWeb ? undefined : Platform.OS === "ios" ? 14 : 10,
            marginHorizontal: isWeb ? (compact ? 8 : 20) : undefined,
            marginBottom: isWeb ? 12 : undefined,
            maxWidth: isWeb ? 720 : undefined,
            alignSelf: isWeb ? "center" : undefined,
            width: isWeb ? "100%" : undefined,
            borderRadius: isWeb ? 14 : 16,
            paddingTop: 6,
            paddingBottom: isWeb
              ? compact
                ? 6
                : 8
              : Platform.OS === "ios"
                ? 10
                : 8,
            paddingHorizontal: isWeb ? (compact ? 0 : 6) : 4,
            ...Platform.select({
              web: { boxShadow: "0 6px 20px rgba(0,0,0,0.4)" },
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
            title: "Showcase",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon
                glyph="⚡"
                color={color}
                focused={focused}
                size={iconSize}
              />
            ),
            tabBarLabel: showLabels ? "SHOWCASE" : undefined,
          }}
        />
        <Tabs.Screen
          name="features"
          options={{
            title: "Features",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon
                glyph="🧪"
                color={color}
                focused={focused}
                size={iconSize}
              />
            ),
            tabBarLabel: showLabels ? "FEATURES" : undefined,
          }}
        />
        <Tabs.Screen
          name="tools"
          options={{
            title: "Tools",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon
                glyph="🛠"
                color={color}
                focused={focused}
                size={iconSize}
              />
            ),
            tabBarLabel: showLabels ? "TOOLS" : undefined,
          }}
        />
        <Tabs.Screen
          name="benchmark"
          options={{
            title: "Perf",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon
                glyph="📊"
                color={color}
                focused={focused}
                size={iconSize}
              />
            ),
            tabBarLabel: showLabels ? "PERF" : undefined,
          }}
        />
      </Tabs>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
