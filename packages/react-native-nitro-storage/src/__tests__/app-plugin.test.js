const fs = require("fs");
const os = require("os");
const path = require("path");

const { _internal, withNitroStorage } = require("../../app.plugin.js");

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

  it("sets the default Face ID usage description when none exists", () => {
    const infoPlist = {};

    _internal.applyInfoPlist(infoPlist, {});

    expect(infoPlist.NSFaceIDUsageDescription).toBe(
      "Allow $(PRODUCT_NAME) to use Face ID for secure authentication",
    );
  });

  it("preserves an existing Face ID usage description without a prop", () => {
    const infoPlist = { NSFaceIDUsageDescription: "Existing app copy" };

    _internal.applyInfoPlist(infoPlist, { faceIDPermission: "   " });

    expect(infoPlist.NSFaceIDUsageDescription).toBe("Existing app copy");
  });

  it("uses the faceIDPermission prop over an existing description", () => {
    const infoPlist = { NSFaceIDUsageDescription: "Existing app copy" };

    _internal.applyInfoPlist(infoPlist, {
      faceIDPermission: "Unlock your vault with Face ID",
    });

    expect(infoPlist.NSFaceIDUsageDescription).toBe(
      "Unlock your vault with Face ID",
    );
  });

  it("does not add biometric permissions by default", () => {
    const manifest = { manifest: { application: [{ $: {} }] } };

    _internal.applyAndroidManifest(manifest, {});

    expect(manifest.manifest["uses-permission"]).toBeUndefined();
  });

  it("adds biometric permissions once without duplicating existing entries", () => {
    const manifest = {
      manifest: {
        application: [{ $: {} }],
        "uses-permission": [
          { $: { "android:name": "android.permission.INTERNET" } },
          { $: { "android:name": "android.permission.USE_BIOMETRIC" } },
        ],
      },
    };

    _internal.applyAndroidManifest(manifest, { addBiometricPermissions: true });
    _internal.applyAndroidManifest(manifest, { addBiometricPermissions: true });

    expect(
      manifest.manifest["uses-permission"].map((p) => p.$["android:name"]),
    ).toEqual([
      "android.permission.INTERNET",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
    ]);
  });

  it("leaves backup attributes untouched when configureAndroidBackup is false", () => {
    const manifest = { manifest: { application: [{ $: {} }] } };

    _internal.applyAndroidManifest(manifest, { configureAndroidBackup: false });

    expect(manifest.manifest.application[0].$).toEqual({});
  });

  it("registers the Android backup file writer only when backup is configured", () => {
    const configured = withNitroStorage({ name: "app", slug: "app" }, {});
    const skipped = withNitroStorage(
      { name: "app", slug: "app" },
      { configureAndroidBackup: false },
    );

    expect(typeof configured.mods.ios.infoPlist).toBe("function");
    expect(typeof configured.mods.android.manifest).toBe("function");
    expect(typeof configured.mods.android.dangerous).toBe("function");
    expect(typeof skipped.mods.android.manifest).toBe("function");
    expect(skipped.mods.android.dangerous).toBeUndefined();
  });
});
