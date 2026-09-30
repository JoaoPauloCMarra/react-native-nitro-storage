const fs = require("fs");
const path = require("path");
const {
  withInfoPlist,
  withAndroidManifest,
  withDangerousMod,
  createRunOncePlugin,
} = require("expo/config-plugins");
const pkg = require("./package.json");

const DATA_EXTRACTION_RULES_RESOURCE =
  "@xml/nitro_storage_data_extraction_rules";
const FULL_BACKUP_CONTENT_RESOURCE = "@xml/nitro_storage_full_backup_content";

const secureSharedPrefs = [
  "NitroStorageSecure.xml",
  "NitroStorageBiometric.xml",
  "NitroStorageBiometricOrPasscode.xml",
  "NitroStorageBiometricOnly.xml",
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

const DEFAULT_FACE_ID_PERMISSION =
  "Allow $(PRODUCT_NAME) to use Face ID for secure authentication";

const BIOMETRIC_PERMISSIONS = [
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT",
];

function applyInfoPlist(infoPlist, props = {}) {
  const { faceIDPermission } = props;
  if (typeof faceIDPermission === "string" && faceIDPermission.trim() !== "") {
    infoPlist.NSFaceIDUsageDescription = faceIDPermission;
  } else if (!infoPlist.NSFaceIDUsageDescription) {
    infoPlist.NSFaceIDUsageDescription = DEFAULT_FACE_ID_PERMISSION;
  }
  return infoPlist;
}

function applyAndroidManifest(androidManifest, props = {}) {
  const { addBiometricPermissions = false, configureAndroidBackup = true } =
    props;

  if (configureAndroidBackup) {
    ensureBackupAttributes(androidManifest);
  }

  if (!addBiometricPermissions) {
    return androidManifest;
  }

  if (!androidManifest.manifest["uses-permission"]) {
    androidManifest.manifest["uses-permission"] = [];
  }

  const permissions = androidManifest.manifest["uses-permission"];
  for (const name of BIOMETRIC_PERMISSIONS) {
    const present = permissions.some((p) => p.$?.["android:name"] === name);
    if (!present) {
      permissions.push({ $: { "android:name": name } });
    }
  }

  return androidManifest;
}

const withNitroStorage = (config, props = {}) => {
  const { configureAndroidBackup = true } = props;

  config = withInfoPlist(config, (config) => {
    applyInfoPlist(config.modResults, props);
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    applyAndroidManifest(config.modResults, props);
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

  return config;
};

module.exports = createRunOncePlugin(
  withNitroStorage,
  pkg.name,
  pkg.version,
);
module.exports.withNitroStorage = withNitroStorage;
module.exports._internal = {
  applyInfoPlist,
  applyAndroidManifest,
  dataExtractionRulesXml,
  fullBackupContentXml,
  ensureBackupAttributes,
  writeAndroidBackupFiles,
};
