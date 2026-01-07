import React from "react";
import {
  StyleSheet,
  Pressable,
  Text,
  ViewStyle,
  Platform,
  View,
  TextStyle,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width } = Dimensions.get("window");
const isWeb = Platform.OS === "web";

export const Colors = {
  background: "#000000",
  surface: "#0A0A0A",
  card: "#111111",
  border: "#1F1F1F",
  text: "#FFFFFF",
  muted: "#71717A",
  primary: "#3B82F6",
  success: "#10B981",
  danger: "#EF4444",
  warning: "#F59E0B",
  memory: "#EAB308",
  disk: "#3B82F6",
  secure: "#10B981",
};

export const Button = ({
  title,
  onPress,
  variant = "primary",
  style,
  disabled,
  size = "md",
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "danger" | "secondary" | "ghost" | "success";
  style?: ViewStyle;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
}) => (
  <Pressable
    style={({ pressed }) => [
      styles.button,
      size === "sm" && { paddingVertical: 8, paddingHorizontal: 12 },
      size === "lg" && { paddingVertical: 18, paddingHorizontal: 24 },
      variant === "primary" && { backgroundColor: Colors.primary },
      variant === "danger" && { backgroundColor: Colors.danger },
      variant === "success" && { backgroundColor: Colors.success },
      variant === "secondary" && { backgroundColor: Colors.border },
      variant === "ghost" && {
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: Colors.border,
      },
      pressed && styles.buttonPressed,
      disabled && { opacity: 0.4 },
      style,
    ]}
    onPress={onPress}
    disabled={disabled}
  >
    <Text
      style={[
        styles.buttonText,
        size === "sm" && { fontSize: 13 },
        size === "lg" && { fontSize: 17 },
        variant === "ghost" && { color: Colors.muted },
      ]}
    >
      {title}
    </Text>
  </Pressable>
);

export const Card = ({
  children,
  title,
  subtitle,
  indicatorColor,
  style,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  indicatorColor?: string;
  style?: ViewStyle;
}) => (
  <View style={[styles.card, style]}>
    {(title || indicatorColor) && (
      <View style={styles.cardHeader}>
        {indicatorColor && (
          <View
            style={[styles.indicator, { backgroundColor: indicatorColor }]}
          />
        )}
        <View>
          {title && <Text style={styles.cardTitle}>{title}</Text>}
          {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
        </View>
      </View>
    )}
    <View style={styles.cardContent}>{children}</View>
  </View>
);

// Helper to use native TextInput safely
import { TextInput as RNTextInput } from "react-native";

export const Input = ({
  label,
  value,
  onChangeText,
  placeholder,
  style,
  ...props
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: ViewStyle;
  [key: string]: any;
}) => (
  <View style={[styles.inputGroup, style]}>
    {label && <Text style={styles.label}>{label}</Text>}
    <RNTextInput
      style={styles.textInput}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={Colors.muted}
      selectionColor={Colors.primary}
      {...props}
    />
  </View>
);

export const Badge = ({
  label,
  color = Colors.primary,
}: {
  label: string;
  color?: string;
}) => (
  <View
    style={[
      styles.badge,
      { backgroundColor: color + "20", borderColor: color + "40" },
    ]}
  >
    <Text style={[styles.badgeText, { color }]}>{label}</Text>
  </View>
);

export const Page = ({
  children,
  title,
  subtitle,
  scroll = true,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  scroll?: boolean;
}) => {
  const insets = useSafeAreaInsets();
  const Content = scroll ? ScrollView : View;

  return (
    <View style={styles.container}>
      <Content
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + (isWeb ? 20 : 0) },
        ]}
        style={{ flex: 1 }}
      >
        {(title || subtitle) && (
          <View style={styles.header}>
            {title && <Text style={styles.headerTitle}>{title}</Text>}
            {subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
          </View>
        )}
        {children}
      </Content>
    </View>
  );
};

import { ScrollView } from "react-native";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
    maxWidth: isWeb ? 800 : width,
    alignSelf: "center",
    width: "100%",
  },
  header: {
    marginBottom: 32,
  },
  headerTitle: {
    fontSize: 40,
    fontWeight: "900",
    color: Colors.text,
    letterSpacing: -1,
  },
  headerSubtitle: {
    fontSize: 16,
    color: Colors.muted,
    marginTop: 4,
    fontWeight: "500",
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
      web: {
        boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.5)",
      },
    }),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  indicator: {
    width: 4,
    height: 24,
    borderRadius: 2,
    marginRight: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: Colors.text,
    letterSpacing: -0.4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: Colors.muted,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  cardContent: {
    gap: 16,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      web: {
        transition: "all 0.2s ease",
      },
    }),
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.96 }],
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.muted,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  textInput: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 16,
    color: Colors.text,
    fontSize: 16,
    fontWeight: "500",
  },
  badge: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  flex1: {
    flex: 1,
  },
  codeText: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: Colors.muted,
    fontSize: 13,
  },
  footer: {
    marginTop: 20,
    alignItems: "center",
  },
});
