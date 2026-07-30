const fs = require("fs");
const os = require("os");
const path = require("path");

const { _internal } = require("../../app.plugin.js");

describe("Expo config plugin", () => {
  it("adds Android backup attributes when missing", () => {
    const manifest = {
      manifest: {
        application: [{ $: {} }],
      },
    };

    _internal.ensureBackupAttributes(manifest);

    expect(manifest.manifest.application[0].$).toMatchObject({
      "android:dataExtractionRules": "@xml/nitro_storage_data_extraction_rules",
      "android:fullBackupContent": "@xml/nitro_storage_full_backup_content",
    });
  });

  it("preserves existing Android backup attributes", () => {
    const manifest = {
      manifest: {
        application: [
          {
            $: {
              "android:dataExtractionRules": "@xml/custom_data_rules",
              "android:fullBackupContent": "@xml/custom_backup_rules",
            },
          },
        ],
      },
    };

    _internal.ensureBackupAttributes(manifest);

    expect(manifest.manifest.application[0].$).toMatchObject({
      "android:dataExtractionRules": "@xml/custom_data_rules",
      "android:fullBackupContent": "@xml/custom_backup_rules",
    });
  });

  it("generates backup XML that excludes secure preference files", () => {
    expect(_internal.dataExtractionRulesXml()).toContain(
      '<exclude domain="sharedpref" path="NitroStorageSecure.xml" />',
    );
    expect(_internal.dataExtractionRulesXml()).toContain(
      '<exclude domain="sharedpref" path="NitroStorageBiometric.xml" />',
    );
    expect(_internal.dataExtractionRulesXml()).toContain(
      '<exclude domain="sharedpref" path="NitroStorageBiometricOrPasscode.xml" />',
    );
    expect(_internal.dataExtractionRulesXml()).toContain(
      '<exclude domain="sharedpref" path="NitroStorageBiometricOnly.xml" />',
    );
    expect(_internal.fullBackupContentXml()).toContain(
      '<exclude domain="sharedpref" path="NitroStorageSecure.xml" />',
    );
    expect(_internal.fullBackupContentXml()).toContain(
      '<exclude domain="sharedpref" path="NitroStorageBiometric.xml" />',
    );
    expect(_internal.fullBackupContentXml()).toContain(
      '<exclude domain="sharedpref" path="NitroStorageBiometricOrPasscode.xml" />',
    );
    expect(_internal.fullBackupContentXml()).toContain(
      '<exclude domain="sharedpref" path="NitroStorageBiometricOnly.xml" />',
    );
  });

  it("writes Android backup XML files", () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "nitro-storage-plugin-"),
    );

    try {
      _internal.writeAndroidBackupFiles(projectRoot);
      const xmlDir = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "res",
        "xml",
      );

      expect(
        fs.readFileSync(
          path.join(xmlDir, "nitro_storage_data_extraction_rules.xml"),
          "utf8",
        ),
      ).toContain("NitroStorageSecure.xml");
      expect(
        fs.readFileSync(
          path.join(xmlDir, "nitro_storage_full_backup_content.xml"),
          "utf8",
        ),
      ).toContain("NitroStorageBiometric.xml");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("registers the package initializer provider in the Android manifest", () => {
    const packageRoot = path.resolve(__dirname, "../..");
    const manifest = fs.readFileSync(
      path.join(packageRoot, "android/src/main/AndroidManifest.xml"),
      "utf8",
    );

    expect(manifest).toContain("com.nitrostorage.NitroStorageInitializer");
    expect(manifest).toContain("${applicationId}.nitrostorage-initializer");
  });

  it("initializes the Android adapter from application context", () => {
    const packageRoot = path.resolve(__dirname, "../..");
    const initializer = fs.readFileSync(
      path.join(
        packageRoot,
        "android/src/main/java/com/nitrostorage/NitroStorageInitializer.kt",
      ),
      "utf8",
    );

    expect(initializer).toContain(
      "context?.applicationContext?.let(AndroidStorageAdapter::init)",
    );
  });
});
