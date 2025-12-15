import { useState } from "react";
import { ScrollView, View, Text, TextInput, Platform } from "react-native";
import {
  createStorageItem,
  useStorage,
  StorageScope,
} from "react-native-nitro-storage";
import { Button, styles } from "../components/shared";

interface User {
  name: string;
  email: string;
  age: number;
}

const userProfile = createStorageItem<User>({
  key: "user-profile",
  scope: StorageScope.Disk,
  defaultValue: { name: "", email: "", age: 0 },
});

export default function ComplexDemo() {
  const [profile, setProfile] = useStorage(userProfile);
  const [tempName, setTempName] = useState("");
  const [tempEmail, setTempEmail] = useState("");
  const [tempAge, setTempAge] = useState("");

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.indicator, { backgroundColor: "#A855F7" }]} />
            <Text style={styles.cardTitle}>Complex Objects</Text>
          </View>
          <Text style={styles.description}>
            Automatic JSON serialization/deserialization.
          </Text>

          <View style={styles.inputGroup}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={tempName}
                  onChangeText={setTempName}
                  placeholder="Alice"
                  placeholderTextColor="#52525B"
                />
              </View>
              <View style={{ width: 80 }}>
                <Text style={styles.label}>Age</Text>
                <TextInput
                  style={styles.input}
                  value={tempAge}
                  onChangeText={setTempAge}
                  placeholder="25"
                  keyboardType="numeric"
                  placeholderTextColor="#52525B"
                />
              </View>
            </View>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={tempEmail}
              onChangeText={setTempEmail}
              placeholder="alice@example.com"
              placeholderTextColor="#52525B"
              autoCapitalize="none"
            />

            <Button
              title="Save Profile Object"
              variant="secondary"
              style={{
                backgroundColor: "#27272A",
                borderWidth: 1,
                borderColor: "#3F3F46",
              }}
              onPress={() => {
                setProfile({
                  name: tempName,
                  email: tempEmail,
                  age: parseInt(tempAge) || 0,
                });
                setTempName("");
                setTempEmail("");
                setTempAge("");
              }}
            />

            {profile.name ? (
              <View style={styles.jsonPreview}>
                <Text style={styles.codeText}>
                  {JSON.stringify(profile, null, 2)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
