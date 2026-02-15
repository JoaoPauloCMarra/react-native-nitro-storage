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
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width } = Dimensions.get("window");
const isWeb = Platform.OS === "web";

export const Colors = {
  background: "#070A12",
  surface: "#0D1424",
  card: "#111A2C",
  border: "#23304A",
  text: "#F4F7FF",
  muted: "#94A3B8",
  primary: "#5B8CFF",
  success: "#22C55E",
  danger: "#EF4444",
  warning: "#F59E0B",
  memory: "#F8B94A",
  disk: "#60A5FA",
  secure: "#34D399",
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

const buttonBackgroundByVariant: Record<ButtonVariant, string> = {
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
      { backgroundColor: buttonBackgroundByVariant[variant] },
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
    {(title || indicatorColor) && (
      <View style={styles.cardHeader}>
        {indicatorColor ? (
          <View style={[styles.indicator, { backgroundColor: indicatorColor }]} />
        ) : null}
        <View style={styles.cardTitleWrap}>
          {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
          {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>
    )}
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
      { backgroundColor: `${color}1F`, borderColor: `${color}4D` },
    ]}
  >
    <Text style={[styles.badgeText, { color }]}>{label}</Text>
  </View>
);

type PageProps = {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  scroll?: boolean;
};

function Header({ title, subtitle }: { title?: string; subtitle?: string }) {
  if (!title && !subtitle) {
    return null;
  }

  return (
    <View style={styles.header}>
      {title ? <Text style={styles.headerTitle}>{title}</Text> : null}
      {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export const Page = ({ children, title, subtitle, scroll = true }: PageProps) => {
  const insets = useSafeAreaInsets();
  const contentPaddingTop = insets.top + (isWeb ? 20 : 8);

  if (scroll) {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: contentPaddingTop }]}
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
      <View style={[styles.scrollContent, styles.pageBody, { paddingTop: contentPaddingTop }]}>
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
    maxWidth: isWeb ? 920 : width,
    alignSelf: "center",
    width: "100%",
  },
  header: {
    marginBottom: 8,
    gap: 6,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: "900",
    color: Colors.text,
    letterSpacing: -0.8,
  },
  headerSubtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: Colors.muted,
    fontWeight: "500",
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Platform.select({
      ios: {
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.26,
        shadowRadius: 16,
      },
      android: {
        elevation: 6,
      },
      web: {
        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
      },
    }),
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
    height: 22,
    borderRadius: 999,
    marginRight: 10,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.text,
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 12,
    color: Colors.muted,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  cardContent: {
    gap: 12,
  },
  button: {
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSm: {
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 10,
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
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: 0.1,
  },
  buttonTextSm: {
    fontSize: 13,
  },
  buttonTextLg: {
    fontSize: 16,
  },
  buttonGhostText: {
    color: Colors.muted,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  textInput: {
    minHeight: 44,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 15,
  },
  badge: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  flex1: {
    flex: 1,
  },
  codeText: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: Colors.muted,
    fontSize: 12,
    lineHeight: 18,
  } as TextStyle,
  footer: {
    marginTop: 8,
    alignItems: "center",
  },
});
