const {
  withInfoPlist,
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
  createRunOncePlugin,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const DATA_EXTRACTION_RULES_RESOURCE =
  "@xml/nitro_storage_data_extraction_rules";
const FULL_BACKUP_CONTENT_RESOURCE = "@xml/nitro_storage_full_backup_content";

const secureSharedPrefs = [
  "NitroStorageSecure.xml",
  "NitroStorageBiometric.xml",
];

function sharedPrefsExcludes(indent = "    ") {
  return secureSharedPrefs
    .map((file) => `${indent}<exclude domain="sharedpref" path="${file}" />`)
    .join("\n");
}

function dataExtractionRulesXml() {
  const excludes = sharedPrefsExcludes("    ");
  return `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludes}
  </cloud-backup>
  <device-transfer>
${excludes}
  </device-transfer>
</data-extraction-rules>
`;
}

function fullBackupContentXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${sharedPrefsExcludes("  ")}
</full-backup-content>
`;
}

function ensureBackupAttributes(androidManifest) {
  const application = androidManifest.manifest.application?.[0];
  if (!application) {
    return;
  }

  application.$ = application.$ || {};
  if (!application.$["android:dataExtractionRules"]) {
    application.$["android:dataExtractionRules"] =
      DATA_EXTRACTION_RULES_RESOURCE;
  }
  if (!application.$["android:fullBackupContent"]) {
    application.$["android:fullBackupContent"] = FULL_BACKUP_CONTENT_RESOURCE;
  }
}

function writeAndroidBackupFiles(projectRoot) {
  const xmlDir = path.join(
    projectRoot,
    "android",
    "app",
    "src",
    "main",
    "res",
    "xml",
  );
  fs.mkdirSync(xmlDir, { recursive: true });
  fs.writeFileSync(
    path.join(xmlDir, "nitro_storage_data_extraction_rules.xml"),
    dataExtractionRulesXml(),
  );
  fs.writeFileSync(
    path.join(xmlDir, "nitro_storage_full_backup_content.xml"),
    fullBackupContentXml(),
  );
}

const withNitroStorage = (config, props = {}) => {
  const defaultFaceIDPermission =
    "Allow $(PRODUCT_NAME) to use Face ID for secure authentication";
  const {
    faceIDPermission,
    addBiometricPermissions = false,
    configureAndroidBackup = true,
  } = props;

  config = withInfoPlist(config, (config) => {
    if (
      typeof faceIDPermission === "string" &&
      faceIDPermission.trim() !== ""
    ) {
      config.modResults.NSFaceIDUsageDescription = faceIDPermission;
    } else if (!config.modResults.NSFaceIDUsageDescription) {
      config.modResults.NSFaceIDUsageDescription = defaultFaceIDPermission;
    }
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    if (configureAndroidBackup) {
      ensureBackupAttributes(config.modResults);
    }

    if (!addBiometricPermissions) {
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
      (p) => p.$?.["android:name"] === "android.permission.USE_BIOMETRIC",
    );
    const hasFingerprint = permissions.some(
      (p) => p.$?.["android:name"] === "android.permission.USE_FINGERPRINT",
    );

    if (!hasBiometric) {
      permissions.push(biometricPermission);
    }
    if (!hasFingerprint) {
      permissions.push(fingerprintPermission);
    }

    return config;
  });

  if (configureAndroidBackup) {
    config = withDangerousMod(config, [
      "android",
      async (config) => {
        writeAndroidBackupFiles(config.modRequest.projectRoot);
        return config;
      },
    ]);
  }

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
            `$1\n${importStatement}\n`,
          );
        }

        modResults.contents = modResults.contents.replace(
          /(super\.onCreate\(\);)/,
          `$1\n${initStatement}`,
        );
      }
    } else if (language === "kt") {
      if (!contents.includes("AndroidStorageAdapter.init")) {
        const importStatement = "import com.nitrostorage.AndroidStorageAdapter";
        const initStatement = "    AndroidStorageAdapter.init(this)";

        if (!contents.includes(importStatement)) {
          modResults.contents = contents.replace(
            /(package .*\n)/,
            `$1\n${importStatement}\n`,
          );
        }

        modResults.contents = modResults.contents.replace(
          /(super\.onCreate\(\))/,
          `$1\n${initStatement}`,
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
  "1.0.0",
);
module.exports.withNitroStorage = withNitroStorage;
module.exports._internal = {
  dataExtractionRulesXml,
  fullBackupContentXml,
  ensureBackupAttributes,
  writeAndroidBackupFiles,
};
