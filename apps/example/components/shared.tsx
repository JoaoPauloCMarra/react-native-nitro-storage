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

const fontSans400 = "Inter_400Regular";
const fontSans500 = "Inter_500Medium";
const fontSans600 = "Inter_600SemiBold";
const fontSans700 = "Inter_700Bold";
const fontSans800 = "Inter_800ExtraBold";
const fontMono400 = "JetBrainsMono_400Regular";
const fontMono700 = "JetBrainsMono_700Bold";

export const Colors = {
  background: "#eef3f9",
  surface: "#ffffff",
  card: "#f6f9fc",
  border: "#dbe5ef",
  text: "#0f172a",
  muted: "#475569",
  primary: "#0f766e",
  success: "#15803d",
  danger: "#b91c1c",
  warning: "#b45309",
  memory: "#c2410c",
  disk: "#1d4ed8",
  secure: "#0d9488",
  accent: "#334155",
  purple: "#334155",
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
  testID?: string;
};

const buttonBackground: Record<ButtonVariant, string> = {
  primary: Colors.primary,
  danger: Colors.danger,
  success: Colors.success,
  secondary: Colors.card,
  ghost: "transparent",
};

const buttonTextColor: Record<ButtonVariant, string> = {
  primary: "#f8fafc",
  danger: "#f8fafc",
  success: "#f8fafc",
  secondary: Colors.text,
  ghost: Colors.muted,
};

export const Button = ({
  title,
  onPress,
  variant = "primary",
  style,
  disabled = false,
  size = "md",
  testID,
}: ButtonProps) => (
  <Pressable
    testID={testID}
    hitSlop={6}
    style={({ pressed }) => [
      styles.button,
      { backgroundColor: buttonBackground[variant] },
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
        { color: buttonTextColor[variant] },
        size === "sm" && styles.buttonTextSm,
        size === "lg" && styles.buttonTextLg,
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
  indicatorColor = Colors.primary,
  style,
}: CardProps) => (
  <View style={[styles.card, style]}>
    {title ? (
      <View style={styles.cardHeader}>
        <View
          style={[styles.indicator, { backgroundColor: `${indicatorColor}33` }]}
        >
          <View
            style={[styles.indicatorDot, { backgroundColor: indicatorColor }]}
          />
        </View>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle}>{title}</Text>
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
      { borderColor: `${color}55`, backgroundColor: `${color}14` },
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
        ? { backgroundColor: `${color}14`, borderColor: `${color}4f` }
        : styles.chipInactive,
    ]}
  >
    <View
      style={[
        styles.chipDot,
        { backgroundColor: active ? color : Colors.border },
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
  testID,
}: {
  label: string;
  value: string;
  color?: string;
  testID?: string;
}) => (
  <View style={styles.statusRow}>
    <Text style={styles.statusLabel}>{label}</Text>
    <Text testID={testID} style={[styles.statusValue, color ? { color } : null]}>{value}</Text>
  </View>
);

export const CodeBlock = ({ children, testID }: { children: string; testID?: string }) => (
  <View style={styles.codeBlock}>
    <Text testID={testID} style={styles.codeBlockText}>{children}</Text>
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

function Atmosphere() {
  return (
    <View pointerEvents="none" style={styles.atmosphere}>
      <View style={styles.orbTopLeft} />
      <View style={styles.orbTopRight} />
      <View style={styles.orbBottom} />
    </View>
  );
}

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
  const contentPaddingTop = insets.top + (isWeb ? 18 : 10);

  if (scroll) {
    return (
      <View style={styles.container}>
        <Atmosphere />
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
      <Atmosphere />
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
  atmosphere: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  orbTopLeft: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 200,
    backgroundColor: "#99f6e433",
    top: -70,
    left: -60,
  },
  orbTopRight: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 200,
    backgroundColor: "#93c5fd33",
    top: 10,
    right: -80,
  },
  orbBottom: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 200,
    backgroundColor: "#fcd34d2a",
    bottom: -70,
    left: 70,
  },
  pageBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 108,
    gap: 14,
    maxWidth: isWeb ? 860 : width,
    alignSelf: "center",
    width: "100%",
  },
  header: {
    marginBottom: 6,
    gap: 5,
  },
  headerTitle: {
    fontSize: 34,
    lineHeight: 38,
    fontFamily: fontSans800,
    color: Colors.text,
    letterSpacing: -0.6,
  },
  headerSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontSans500,
    color: Colors.muted,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    boxShadow: "0 12px 28px rgba(15, 23, 42, 0.09)",
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  indicator: {
    width: 18,
    height: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardTitleWrap: {
    flexShrink: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontFamily: fontSans800,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 11,
    color: Colors.muted,
    fontFamily: fontSans700,
    textTransform: "uppercase",
    letterSpacing: 0.8,
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
    boxShadow: "0 6px 16px rgba(15, 23, 42, 0.08)",
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
    boxShadow: "none",
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
    fontFamily: fontSans700,
    letterSpacing: 0.2,
  },
  buttonTextSm: {
    fontSize: 12,
  },
  buttonTextLg: {
    fontSize: 16,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontFamily: fontSans700,
    color: Colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  textInput: {
    minHeight: 42,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 14,
    fontFamily: fontSans400,
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
    fontFamily: fontSans800,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    gap: 6,
  },
  chipInactive: {
    backgroundColor: Colors.card,
    borderColor: Colors.border,
  },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  chipText: {
    fontSize: 11,
    fontFamily: fontSans700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
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
    gap: 10,
  },
  statusLabel: {
    fontSize: 12,
    fontFamily: fontSans600,
    color: Colors.muted,
  },
  statusValue: {
    flexShrink: 1,
    textAlign: "right",
    fontSize: 13,
    color: Colors.text,
    fontFamily: fontMono700,
  },
  codeBlock: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 14,
  },
  codeBlockText: {
    fontFamily: fontMono400,
    fontSize: 12,
    lineHeight: 18,
    color: "#cbd5e1",
  },
  codeText: {
    fontFamily: fontMono400,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.text,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: fontSans800,
    color: Colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  grid: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  flex1: {
    flex: 1,
  },
  panel: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  panelTitle: {
    color: Colors.muted,
    fontFamily: fontSans700,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  panelValue: {
    color: Colors.text,
    fontFamily: fontSans800,
    fontSize: 42,
    lineHeight: 44,
    textAlign: "center",
  },
  helperText: {
    color: Colors.muted,
    fontFamily: fontSans400,
    fontSize: 12,
    lineHeight: 18,
  },
});

const sharedStyleKeysForLint = [
  styles.codeText,
  styles.row,
  styles.grid,
  styles.flex1,
  styles.panel,
  styles.panelTitle,
  styles.panelValue,
  styles.helperText,
];
void sharedStyleKeysForLint;
