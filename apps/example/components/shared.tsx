import {
  StyleSheet,
  Pressable,
  Text,
  ViewStyle,
  Platform,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const Button = ({
  title,
  onPress,
  variant = "primary",
  style,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "danger" | "secondary";
  style?: ViewStyle;
  disabled?: boolean;
}) => (
  <Pressable
    style={({ pressed }) => [
      styles.button,
      variant === "primary" && styles.buttonPrimary,
      variant === "danger" && styles.buttonDanger,
      variant === "secondary" && styles.buttonSecondary,
      pressed && styles.buttonPressed,
      disabled && { opacity: 0.5 },
      style,
    ]}
    onPress={onPress}
    disabled={disabled}
  >
    <Text
      style={[
        styles.buttonText,
        variant === "secondary" && styles.buttonTextSecondary,
      ]}
    >
      {title}
    </Text>
  </Pressable>
);

export const Page = ({ children }: { children: React.ReactNode }) => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {children}
    </View>
  );
};

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#09090B", // Zinc 950
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: "center",
    marginBottom: 32,
    marginTop: 10,
  },
  iconBadge: {
    width: 64,
    height: 64,
    backgroundColor: "#18181B",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#27272A",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: "#FAFAFA",
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: "#A1A1AA",
    fontWeight: "500",
  },
  card: {
    backgroundColor: "#18181B", // Zinc 900
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#27272A", // Zinc 800
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  indicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F4F4F5",
  },
  description: {
    fontSize: 14,
    color: "#71717A", // Zinc 500
    marginBottom: 20,
    lineHeight: 20,
  },
  counterWrapper: {
    alignItems: "center",
    backgroundColor: "#1C1C1E", // Slightly lighter/different tone
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: "#27272A",
  },
  counterValue: {
    fontSize: 64,
    fontWeight: "800",
    color: "#FAFAFA",
    marginBottom: 24,
    fontVariant: ["tabular-nums"], // Good for numbers
  },
  counterControls: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    justifyContent: "center",
  },
  inputGroup: {
    gap: 16,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#A1A1AA",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#09090B",
    borderWidth: 1,
    borderColor: "#27272A",
    borderRadius: 8,
    padding: 14,
    color: "#FAFAFA",
    fontSize: 16,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimary: {
    backgroundColor: "#3B82F6", // Blue 500
  },
  buttonDanger: {
    backgroundColor: "#EF4444", // Red 500
  },
  buttonSecondary: {
    backgroundColor: "#27272A",
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  buttonTextSecondary: {
    color: "#E4E4E7",
  },
  resultBadge: {
    marginTop: 8,
    padding: 12,
    backgroundColor: "rgba(59, 130, 246, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.3)",
    borderRadius: 8,
  },
  resultLabel: {
    fontSize: 11,
    color: "#60A5FA",
    fontWeight: "700",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  resultText: {
    color: "#E4E4E7",
    fontSize: 15,
    fontWeight: "500",
  },
  jsonPreview: {
    backgroundColor: "#09090B",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#27272A",
  },
  codeText: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: "#A1A1AA",
    fontSize: 13,
  },
  footer: {
    marginTop: 20,
    alignItems: "center",
  },
  footerText: {
    color: "#52525B",
    fontSize: 13,
    fontWeight: "500",
  },
});
