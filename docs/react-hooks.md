# React Hooks

Nitro Storage hooks connect a `StorageItem<T>` to React with `useSyncExternalStore`. No provider is needed, and the same item can also be used outside React.

Keep storage items at module scope. Creating items during render creates new subscriptions and breaks cache reuse.

## useStorage

Use `useStorage(item)` when a component both reads and writes the full value.

```tsx
import {
  createStorageItem,
  StorageScope,
  useStorage,
} from "react-native-nitro-storage";

const themeItem = createStorageItem({
  key: "theme",
  scope: StorageScope.Disk,
  defaultValue: "system",
});

export function ThemeToggle() {
  const [theme, setTheme] = useStorage(themeItem);

  return (
    <Button
      title={theme}
      onPress={() => setTheme(theme === "dark" ? "light" : "dark")}
    />
  );
}
```

Updater functions read the current stored value first:

```ts
const countItem = createStorageItem({
  key: "count",
  scope: StorageScope.Memory,
  defaultValue: 0,
});

const [, setCount] = useStorage(countItem);
setCount((current) => current + 1);
```

Direct `set(value)` writes do not read the current value first.

## useStorageSelector

Use `useStorageSelector(item, selector, isEqual?)` when the stored value is larger than what the component renders.

```tsx
type Profile = {
  name: string;
  email: string;
  plan: "free" | "pro";
};

const profileItem = createStorageItem<Profile>({
  key: "profile",
  scope: StorageScope.Disk,
  defaultValue: { name: "", email: "", plan: "free" },
});

export function PlanBadge() {
  const [plan] = useStorageSelector(profileItem, (profile) => profile.plan);
  return <Text>{plan}</Text>;
}
```

Pass a custom equality function when the selector returns an object:

```ts
const [contact] = useStorageSelector(
  profileItem,
  (profile) => ({ name: profile.name, email: profile.email }),
  (prev, next) => prev.name === next.name && prev.email === next.email,
);
```

## useSetStorage

Use `useSetStorage(item)` for controls that write without rendering from the value.

```tsx
const dismissItem = createStorageItem({
  key: "welcomeDismissed",
  scope: StorageScope.Disk,
  defaultValue: false,
});

export function DismissWelcomeButton() {
  const setDismissed = useSetStorage(dismissItem);
  return <Button title="Dismiss" onPress={() => setDismissed(true)} />;
}
```

## Subscribe Outside React

Every item has a low-level subscription API:

```ts
const unsubscribe = themeItem.subscribe(() => {
  analytics.track("theme_changed", { theme: themeItem.get() });
});

unsubscribe();
```

Subscriptions fire after item writes and after TTL expiry is detected during a read.
