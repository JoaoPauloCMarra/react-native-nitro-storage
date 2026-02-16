import React from "react";
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width } = Dimensions.get("window");
const isWeb = Platform.OS === "web";

export const Colors = {
  background: "#060910",
  surface: "#0C1220",
  card: "#101828",
  border: "#1E2D48",
  text: "#F1F5FF",
  muted: "#8899B4",
  primary: "#6B8AFF",
  success: "#2DD4A8",
  danger: "#F06565",
  warning: "#FBBF24",
  memory: "#F5A623",
  disk: "#5B9CF5",
  secure: "#34D399",
  purple: "#A78BFA",
};

type ButtonVariant = "primary" | "danger" | "secondary" | "ghost" | "success";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  style?: ViewStyle;
  disabled?: boolean;
  size?: ButtonSize;
};

const buttonBg: Record<ButtonVariant, string> = {
  primary: Colors.primary,
  danger: Colors.danger,
  success: Colors.success,
  secondary: Colors.card,
  ghost: "transparent",
};

export const Button = ({
  title,
  onPress,
  variant = "primary",
  style,
  disabled = false,
  size = "md",
}: ButtonProps) => (
  <Pressable
    hitSlop={6}
    style={({ pressed }) => [
      styles.button,
      { backgroundColor: buttonBg[variant] },
      size === "sm" && styles.buttonSm,
      size === "lg" && styles.buttonLg,
      variant === "ghost" && styles.buttonGhost,
      pressed && !disabled && styles.buttonPressed,
      disabled && styles.buttonDisabled,
      style,
    ]}
    onPress={onPress}
    disabled={disabled}
  >
    <Text
      style={[
        styles.buttonText,
        size === "sm" && styles.buttonTextSm,
        size === "lg" && styles.buttonTextLg,
        variant === "ghost" && styles.buttonGhostText,
      ]}
    >
      {title}
    </Text>
  </Pressable>
);

type CardProps = {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  indicatorColor?: string;
  style?: ViewStyle;
};

export const Card = ({
  children,
  title,
  subtitle,
  indicatorColor,
  style,
}: CardProps) => (
  <View style={[styles.card, style]}>
    {title || indicatorColor ? (
      <View style={styles.cardHeader}>
        {indicatorColor ? (
          <View
            style={[styles.indicator, { backgroundColor: indicatorColor }]}
          />
        ) : null}
        <View style={styles.cardTitleWrap}>
          {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
          {subtitle ? (
            <Text style={styles.cardSubtitle}>{subtitle}</Text>
          ) : null}
        </View>
      </View>
    ) : null}
    <View style={styles.cardContent}>{children}</View>
  </View>
);

type InputProps = Omit<TextInputProps, "value" | "onChangeText" | "style"> & {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  style?: ViewStyle;
};

export const Input = ({
  label,
  value,
  onChangeText,
  placeholder,
  style,
  ...props
}: InputProps) => (
  <View style={[styles.inputGroup, style]}>
    {label ? <Text style={styles.label}>{label}</Text> : null}
    <TextInput
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

type BadgeProps = {
  label: string;
  color?: string;
};

export const Badge = ({ label, color = Colors.primary }: BadgeProps) => (
  <View
    style={[
      styles.badge,
      { backgroundColor: `${color}18`, borderColor: `${color}40` },
    ]}
  >
    <Text style={[styles.badgeText, { color }]}>{label}</Text>
  </View>
);

export const Chip = ({
  label,
  active = false,
  color = Colors.primary,
}: {
  label: string;
  active?: boolean;
  color?: string;
}) => (
  <View
    style={[
      styles.chip,
      active
        ? { backgroundColor: `${color}22`, borderColor: `${color}55` }
        : { backgroundColor: Colors.card, borderColor: Colors.border },
    ]}
  >
    <View
      style={[
        styles.chipDot,
        { backgroundColor: active ? color : Colors.muted },
      ]}
    />
    <Text style={[styles.chipText, { color: active ? color : Colors.muted }]}>
      {label}
    </Text>
  </View>
);

export const StatusRow = ({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) => (
  <View style={styles.statusRow}>
    <Text style={styles.statusLabel}>{label}</Text>
    <Text style={[styles.statusValue, color ? { color } : null]}>{value}</Text>
  </View>
);

export const CodeBlock = ({ children }: { children: string }) => (
  <View style={styles.codeBlock}>
    <Text style={styles.codeBlockText}>{children}</Text>
  </View>
);

export const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

type PageProps = {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  scroll?: boolean;
};

function Header({ title, subtitle }: { title?: string; subtitle?: string }) {
  if (!title && !subtitle) return null;

  return (
    <View style={styles.header}>
      {title ? <Text style={styles.headerTitle}>{title}</Text> : null}
      {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export const Page = ({
  children,
  title,
  subtitle,
  scroll = true,
}: PageProps) => {
  const insets = useSafeAreaInsets();
  const contentPaddingTop = insets.top + (isWeb ? 20 : 8);

  if (scroll) {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: contentPaddingTop },
          ]}
          bounces={false}
          style={styles.pageBody}
        >
          <Header title={title} subtitle={subtitle} />
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.scrollContent,
          styles.pageBody,
          { paddingTop: contentPaddingTop },
        ]}
      >
        <Header title={title} subtitle={subtitle} />
        {children}
      </View>
    </View>
  );
};

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  pageBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 110,
    gap: 14,
    maxWidth: isWeb ? 720 : width,
    alignSelf: "center",
    width: "100%",
  },
  header: {
    marginBottom: 8,
    gap: 4,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: "900",
    color: Colors.text,
    letterSpacing: -1,
  },
  headerSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.muted,
    fontWeight: "500",
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    boxShadow: "0 6px 20px rgba(0,0,0,0.32)",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  cardTitleWrap: {
    flexShrink: 1,
    gap: 2,
  },
  indicator: {
    width: 4,
    height: 20,
    borderRadius: 999,
    marginRight: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.text,
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 11,
    color: Colors.muted,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  cardContent: {
    gap: 12,
  },
  button: {
    minHeight: 42,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSm: {
    minHeight: 34,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  buttonLg: {
    minHeight: 50,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  buttonGhost: {
    borderWidth: 1,
    borderColor: Colors.border,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.88,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: 0.1,
  },
  buttonTextSm: {
    fontSize: 12,
  },
  buttonTextLg: {
    fontSize: 16,
  },
  buttonGhostText: {
    color: Colors.muted,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  textInput: {
    minHeight: 42,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 14,
  },
  badge: {
    alignSelf: "flex-start",
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: Colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.muted,
  },
  statusValue: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  codeBlock: {
    backgroundColor: "#000",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  codeBlockText: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18,
    color: Colors.muted,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginTop: 4,
  },
});
