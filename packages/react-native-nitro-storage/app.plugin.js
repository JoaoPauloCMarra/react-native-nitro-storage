const {
  withInfoPlist,
  withAndroidManifest,
  withMainApplication,
  createRunOncePlugin,
} = require("@expo/config-plugins");

const withNitroStorage = (config, props = {}) => {
  const {
    faceIDPermission = "Allow $(PRODUCT_NAME) to use Face ID for secure authentication",
  } = props;

  config = withInfoPlist(config, (config) => {
    config.modResults.NSFaceIDUsageDescription =
      faceIDPermission || config.modResults.NSFaceIDUsageDescription;
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application?.[0];
    if (!mainApplication) {
      return config;
    }

    if (!config.modResults.manifest["uses-permission"]) {
      config.modResults.manifest["uses-permission"] = [];
    }

    const permissions = config.modResults.manifest["uses-permission"];

    const biometricPermission = {
      $: { "android:name": "android.permission.USE_BIOMETRIC" },
    };
    const fingerprintPermission = {
      $: { "android:name": "android.permission.USE_FINGERPRINT" },
    };

    const hasBiometric = permissions.some(
      (p) => p.$?.["android:name"] === "android.permission.USE_BIOMETRIC"
    );
    const hasFingerprint = permissions.some(
      (p) => p.$?.["android:name"] === "android.permission.USE_FINGERPRINT"
    );

    if (!hasBiometric) {
      permissions.push(biometricPermission);
    }
    if (!hasFingerprint) {
      permissions.push(fingerprintPermission);
    }

    return config;
  });

  config = withMainApplication(config, (config) => {
    const { modResults } = config;
    const { language, contents } = modResults;

    if (language === "java") {
      if (!contents.includes("AndroidStorageAdapter.init")) {
        const importStatement =
          "import com.nitrostorage.AndroidStorageAdapter;";
        const initStatement = "    AndroidStorageAdapter.init(this);";

        if (!contents.includes(importStatement)) {
          modResults.contents = contents.replace(
            /(package .*;\n)/,
            `$1\n${importStatement}\n`
          );
        }

        modResults.contents = modResults.contents.replace(
          /(super\.onCreate\(\);)/,
          `$1\n${initStatement}`
        );
      }
    } else if (language === "kt") {
      if (!contents.includes("AndroidStorageAdapter.init")) {
        const importStatement = "import com.nitrostorage.AndroidStorageAdapter";
        const initStatement = "    AndroidStorageAdapter.init(this)";

        if (!contents.includes(importStatement)) {
          modResults.contents = contents.replace(
            /(package .*\n)/,
            `$1\n${importStatement}\n`
          );
        }

        modResults.contents = modResults.contents.replace(
          /(super\.onCreate\(\))/,
          `$1\n${initStatement}`
        );
      }
    }

    return config;
  });

  return config;
};

module.exports = createRunOncePlugin(
  withNitroStorage,
  "react-native-nitro-storage",
  "1.0.0"
);
