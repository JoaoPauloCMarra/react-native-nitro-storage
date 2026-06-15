import { memo, useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  createSetItem,
  diskItem,
  memoryItem,
  storage,
  StorageScope,
  useStorage,
  useStorageValue,
} from "react-native-nitro-storage";
import {
  Button,
  Card,
  CodeBlock,
  Colors,
  Input,
  StatusRow,
  styles,
} from "./shared";

type Profile = { name: string; clicks: number };

const profileItem = memoryItem<Profile>({
  key: "ergo-profile",
  defaultValue: { name: "Ada", clicks: 0 },
  group: "ergo-session",
});

const noteItem = diskItem<string | null>({
  key: "ergo-note",
  defaultValue: null,
  group: "ergo-session",
});

const keptItem = diskItem<string>({
  key: "ergo-kept",
  defaultValue: "kept",
});

const tagsSet = createSetItem({
  key: "ergo-tags",
  scope: StorageScope.Disk,
});

const ttlItem = memoryItem<string>({
  key: "ergo-ttl",
  defaultValue: "",
  expiration: { ttlMs: 4000 },
});

const unrelatedCounter = memoryItem<number>({
  key: "ergo-unrelated",
  defaultValue: 0,
});

const ItemErgonomicsCard = memo(function ItemErgonomicsCard() {
  const [profile, , actions] = useStorage(profileItem);
  const [note, setNote] = useState("");

  return (
    <Card
      title="Item Ergonomics"
      subtitle="merge / reset / setOrDelete"
      indicatorColor={Colors.primary}
    >
      <CodeBlock testID="ergo-profile-json">
        {JSON.stringify(profile)}
      </CodeBlock>
      <View style={styles.row}>
        <Button
          testID="ergo-merge-clicks"
          title="merge clicks +1"
          onPress={() => {
            actions.merge({ clicks: profile.clicks + 1 });
          }}
          style={styles.flex1}
        />
        <Button
          testID="ergo-merge-name"
          title="merge name"
          variant="secondary"
          onPress={() => {
            actions.merge({ name: profile.name === "Ada" ? "Grace" : "Ada" });
          }}
          style={styles.flex1}
        />
        <Button
          testID="ergo-reset"
          title="reset"
          variant="danger"
          onPress={() => {
            actions.reset();
          }}
        />
      </View>
      <Input
        testID="ergo-note-input"
        label="Note (setOrDelete)"
        value={note}
        onChangeText={setNote}
        placeholder="Type a note"
        autoCapitalize="none"
      />
      <View style={styles.row}>
        <Button
          testID="ergo-note-save"
          title="Save"
          onPress={() => {
            noteItem.setOrDelete(note.trim() || null);
          }}
          style={styles.flex1}
        />
        <Button
          testID="ergo-note-clear"
          title="Clear (null)"
          variant="secondary"
          onPress={() => {
            noteItem.setOrDelete(null);
          }}
          style={styles.flex1}
        />
      </View>
    </Card>
  );
});

const SetItemCard = memo(function SetItemCard() {
  const tags = useStorageValue(tagsSet.item);
  const values = Object.keys(tags);

  return (
    <Card
      title="Set Item"
      subtitle="createSetItem"
      indicatorColor={Colors.accent}
    >
      <StatusRow
        testID="ergo-tags-values"
        label="Tags"
        value={values.length ? values.sort().join(", ") : "(empty)"}
      />
      <View style={styles.row}>
        <Button
          testID="ergo-tags-add-red"
          title="add red"
          onPress={() => {
            tagsSet.add("red");
          }}
          style={styles.flex1}
        />
        <Button
          testID="ergo-tags-toggle-blue"
          title="toggle blue"
          variant="secondary"
          onPress={() => {
            tagsSet.toggle("blue");
          }}
          style={styles.flex1}
        />
        <Button
          testID="ergo-tags-clear"
          title="clear"
          variant="danger"
          onPress={() => {
            tagsSet.clear();
          }}
        />
      </View>
    </Card>
  );
});

const GroupsCard = memo(function GroupsCard() {
  const [profile] = useStorage(profileItem);
  const note = useStorageValue(noteItem);
  const kept = useStorageValue(keptItem);

  return (
    <Card
      title="Groups & clear-except"
      subtitle="clearGroup / clear({ except })"
      indicatorColor={Colors.danger}
    >
      <StatusRow
        testID="ergo-group-profile"
        label="profile.name"
        value={profile.name}
      />
      <StatusRow
        testID="ergo-group-note"
        label="note (disk)"
        value={note ?? "(empty)"}
      />
      <StatusRow testID="ergo-group-kept" label="kept (disk)" value={kept} />
      <View style={styles.row}>
        <Button
          testID="ergo-clear-group"
          title="Clear Group"
          onPress={() => {
            storage.clearGroup("ergo-session");
          }}
          style={styles.flex1}
        />
        <Button
          testID="ergo-clear-except"
          title="Clear Disk except kept"
          variant="secondary"
          onPress={() => {
            storage.clear(StorageScope.Disk, { except: [keptItem] });
          }}
          style={styles.flex1}
        />
      </View>
    </Card>
  );
});

// Memoized subscriber to a single atom. The React profiler shows this only
// re-renders when profileItem changes, not when an unrelated atom mutates.
const IsolatedProfileClicks = memo(function IsolatedProfileClicks() {
  const clicks = useStorageValue(profileItem).clicks;
  return (
    <StatusRow
      testID="ergo-probe-clicks"
      label="isolated subscriber: profile.clicks"
      value={String(clicks)}
    />
  );
});

const RenderIsolationCard = memo(function RenderIsolationCard() {
  const [localCount, setLocalCount] = useState(0);

  return (
    <Card
      title="Re-render Isolation"
      subtitle="useStorageValue ignores unrelated atoms"
      indicatorColor={Colors.memory}
    >
      <IsolatedProfileClicks />
      <StatusRow
        testID="ergo-local-count"
        label="local state (this card)"
        value={String(localCount)}
      />
      <View style={styles.row}>
        <Button
          testID="ergo-mutate-unrelated"
          title="Mutate unrelated atom"
          onPress={() => {
            unrelatedCounter.set((prev) => prev + 1);
            setLocalCount((prev) => prev + 1);
          }}
          style={styles.flex1}
        />
        <Button
          testID="ergo-mutate-profile"
          title="Mutate profile"
          variant="secondary"
          onPress={() => {
            profileItem.merge({ clicks: profileItem.get().clicks + 1 });
          }}
          style={styles.flex1}
        />
      </View>
    </Card>
  );
});

const ExpireCard = memo(function ExpireCard() {
  const [lastExpired, setLastExpired] = useState("(none)");
  const [value, setValue] = useState(() => ttlItem.get());

  useEffect(() => {
    return storage.subscribeExpired(StorageScope.Memory, (event) => {
      if (event.key === "ergo-ttl") {
        setLastExpired(`${event.key} @ ${new Date().toLocaleTimeString()}`);
        setValue("");
      }
    });
  }, []);

  return (
    <Card
      title="Expiration Events"
      subtitle="subscribeExpired (4s TTL)"
      indicatorColor={Colors.warning}
    >
      <StatusRow
        testID="ergo-ttl-value"
        label="value"
        value={value || "(expired)"}
      />
      <StatusRow
        testID="ergo-ttl-expired"
        label="last expire event"
        value={lastExpired}
      />
      <View style={styles.row}>
        <Button
          testID="ergo-ttl-seed"
          title="Seed"
          onPress={() => {
            ttlItem.set(`session-${Date.now()}`);
            setValue(ttlItem.get());
          }}
          style={styles.flex1}
        />
        <Button
          testID="ergo-ttl-read"
          title="Read"
          variant="secondary"
          onPress={() => {
            setValue(ttlItem.get());
          }}
          style={styles.flex1}
        />
      </View>
    </Card>
  );
});

export function ErgonomicsDemo() {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>v0.6 Ergonomics</Text>
      <ItemErgonomicsCard />
      <SetItemCard />
      <GroupsCard />
      <RenderIsolationCard />
      <ExpireCard />
    </View>
  );
}
