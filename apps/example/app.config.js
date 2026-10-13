const { spawnSync } = require("node:child_process");

const hasCcache =
  process.env.NITRO_EXAMPLE_CCACHE !== "0" &&
  spawnSync("ccache", ["--version"], { stdio: "ignore" }).status === 0;

const androidArchs = process.env.NITRO_EXAMPLE_ANDROID_ARCHS
  ? process.env.NITRO_EXAMPLE_ANDROID_ARCHS.split(",")
      .map((arch) => arch.trim())
      .filter(Boolean)
  : undefined;

module.exports = {
  "expo": {
    "name": "Nitro Storage",
    "slug": "nitro-storage-example",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "nitrostorage",
    "userInterfaceStyle": "automatic",
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.nitrostorage.example"
    },
    "android": {
      "package": "com.nitrostorage.example",
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#07131E"
      }
    },
    "plugins": [
      "expo-router",
      [
        "expo-build-properties",
        {
          "ios": {
            "enableSceneSupport": true,
            "ccacheEnabled": hasCcache
          },
          "android": {
            "usePrecompiledHeaders": true,
            ...(androidArchs ? { "buildArchs": androidArchs } : {})
          }
        }
      ],
      "./plugins/with-gradle-build-speed",
      "react-native-nitro-storage",
      "expo-font",
      "expo-asset",
      "expo-status-bar"
    ],
    "experiments": {
      "reactCompiler": true,
      "typedRoutes": true
    }
  }
};
