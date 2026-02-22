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

function TabGlyph({
  label,
  color,
  focused,
}: {
  label: string;
  color: string;
  focused: boolean;
}) {
  return (
    <View
      style={[
        s.tabGlyph,
        {
          borderColor: focused ? `${color}66` : `${Colors.border}88`,
          backgroundColor: focused ? `${color}12` : Colors.card,
        },
      ]}
    >
      <Text
        style={[
          s.tabGlyphText,
          {
            color,
            opacity: focused ? 1 : 0.8,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const compact = width < 860;

  return (
    <View style={s.container}>
      <StatusBar style="dark" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.muted,
          tabBarShowLabel: true,
          tabBarLabelStyle: s.tabLabel,
          tabBarItemStyle: s.tabItem,
          tabBarStyle: [
            s.tabBar,
            isWeb && compact && s.tabBarWebCompact,
            !isWeb && s.tabBarNative,
          ],
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Showcase",
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph label="SH" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="features"
          options={{
            title: "Features",
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph label="FT" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="tools"
          options={{
            title: "Tools",
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph label="TL" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="benchmark"
          options={{
            title: "Perf",
            tabBarIcon: ({ color, focused }) => (
              <TabGlyph label="PF" color={color} focused={focused} />
            ),
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
  tabBar: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    height: 74,
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 8,
    marginHorizontal: 14,
    marginBottom: 14,
    maxWidth: 820,
    alignSelf: "center",
    width: "100%",
    boxShadow: "0 14px 28px rgba(15, 23, 42, 0.14)",
  },
  tabBarNative: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Platform.OS === "ios" ? 8 : 6,
  },
  tabBarWebCompact: {
    marginHorizontal: 10,
    marginBottom: 10,
  },
  tabItem: {
    borderRadius: 12,
    paddingVertical: 2,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
    letterSpacing: 0.4,
  },
  tabGlyph: {
    minWidth: 30,
    minHeight: 22,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  tabGlyphText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
});
