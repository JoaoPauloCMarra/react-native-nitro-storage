import { Pressable, Text } from "react-native";
import { Link, type Href } from "expo-router";
import { styles } from "./shared";

type LabLinkProps = {
  href: Href;
  testID: string;
  label: string;
  accessibilityLabel?: string;
  subtle?: boolean;
  first?: boolean;
};

export function LabLink({
  href,
  testID,
  label,
  accessibilityLabel = label,
  subtle = false,
  first = false,
}: LabLinkProps) {
  return (
    <Link href={href} asChild>
      <Pressable
        testID={testID}
        accessibilityRole="link"
        accessibilityLabel={accessibilityLabel}
        style={[
          subtle ? styles.labLinkSubtle : styles.labLink,
          first && styles.labLinkSubtleFirst,
        ]}
      >
        <Text style={subtle ? styles.labLinkSubtleText : styles.labLinkText}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

const GATE_LINKS: (LabLinkProps & { key: string })[] = [
  {
    key: "lab",
    href: "/e2e",
    testID: "open-e2e-lab",
    label: "E2E lab",
    accessibilityLabel: "Open E2E lab",
    first: true,
  },
  {
    key: "integrity",
    href: "/e2e-integrity",
    testID: "open-e2e-integrity-home",
    label: "Integrity lab",
    accessibilityLabel: "Open integrity lab",
  },
  {
    key: "keychain",
    href: "/e2e-keychain",
    testID: "open-e2e-keychain-home",
    label: "Keychain lab",
    accessibilityLabel: "Open keychain lab",
  },
  {
    key: "stress",
    href: "/e2e-stress",
    testID: "open-e2e-stress-home",
    label: "Stress lab",
    accessibilityLabel: "Open stress lab",
  },
];

export function E2eGate() {
  return (
    <>
      {GATE_LINKS.map(({ key, ...link }) => (
        <LabLink key={key} subtle {...link} />
      ))}
    </>
  );
}
