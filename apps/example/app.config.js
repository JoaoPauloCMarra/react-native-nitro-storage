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
      "bundleIdentifier": "com.nitrostorage.example",
      "infoPlist": {
        "UIApplicationSceneManifest": {
          "UIApplicationSupportsMultipleScenes": false,
          "UISceneConfigurations": {
            "UIWindowSceneSessionRoleApplication": [
              {
                "UISceneConfigurationName": "Default Configuration",
                "UISceneDelegateClassName": "$(PRODUCT_MODULE_NAME).SceneDelegate"
              }
            ]
          }
        }
      }
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
      "./plugins/with-ios-scene-lifecycle",
      [
        "expo-build-properties",
        {
          "android": {
            "usePrecompiledHeaders": true
          }
        }
      ],
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
