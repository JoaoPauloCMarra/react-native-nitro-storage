import {
  setWebDiskStorageBackend,
  type WebStorageBackend,
} from "../src";

function createPrefixedLocalStorageBackend(prefix: string): WebStorageBackend {
  const ownedKeys = (): string[] => {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key !== null && key.startsWith(prefix)) {
        keys.push(key.slice(prefix.length));
      }
    }
    return keys;
  };

  return {
    name: "prefixed-localStorage",
    getItem: (key) => localStorage.getItem(prefix + key),
    setItem: (key, value) => {
      localStorage.setItem(prefix + key, value);
    },
    removeItem: (key) => {
      localStorage.removeItem(prefix + key);
    },
    clear: () => {
      ownedKeys().forEach((key) => {
        localStorage.removeItem(prefix + key);
      });
    },
    getAllKeys: ownedKeys,
  };
}

setWebDiskStorageBackend(createPrefixedLocalStorageBackend("myapp:"));
setWebDiskStorageBackend();
