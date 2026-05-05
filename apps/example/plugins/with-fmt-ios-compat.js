const {
  withAppBuildGradle,
  withPodfile,
  withProjectBuildGradle,
  createRunOncePlugin,
} = require("expo/config-plugins");

const HELPER_NAME = "patch_fmt_xcode_26_compatibility";
const DEPLOYMENT_TARGET = "15.1";

const FMT_SOURCE_BLOCK = `// Detect consteval, C++20 constexpr extensions and std::is_constant_evaluated.
#if !defined(__cpp_lib_is_constant_evaluated)
#  define FMT_USE_CONSTEVAL 0
#elif FMT_CPLUSPLUS < 201709L
#  define FMT_USE_CONSTEVAL 0
#elif FMT_GLIBCXX_RELEASE && FMT_GLIBCXX_RELEASE < 10
#  define FMT_USE_CONSTEVAL 0
#elif FMT_LIBCPP_VERSION && FMT_LIBCPP_VERSION < 10000
#  define FMT_USE_CONSTEVAL 0
#elif defined(__apple_build_version__) && __apple_build_version__ < 14000029L
#  define FMT_USE_CONSTEVAL 0  // consteval is broken in Apple clang < 14.
#elif FMT_MSC_VERSION && FMT_MSC_VERSION < 1929
#  define FMT_USE_CONSTEVAL 0  // consteval is broken in MSVC VS2019 < 16.10.
#elif defined(__cpp_consteval)
#  define FMT_USE_CONSTEVAL 1
#elif FMT_GCC_VERSION >= 1002 || FMT_CLANG_VERSION >= 1101
#  define FMT_USE_CONSTEVAL 1
#else
#  define FMT_USE_CONSTEVAL 0
#endif`;

const FMT_PATCHED_BLOCK = `// Detect consteval, C++20 constexpr extensions and std::is_constant_evaluated.
#if !defined(FMT_USE_CONSTEVAL)
#  if !defined(__cpp_lib_is_constant_evaluated)
#    define FMT_USE_CONSTEVAL 0
#  elif FMT_CPLUSPLUS < 201709L
#    define FMT_USE_CONSTEVAL 0
#  elif FMT_GLIBCXX_RELEASE && FMT_GLIBCXX_RELEASE < 10
#    define FMT_USE_CONSTEVAL 0
#  elif FMT_LIBCPP_VERSION && FMT_LIBCPP_VERSION < 10000
#    define FMT_USE_CONSTEVAL 0
#  elif defined(__apple_build_version__) && __apple_build_version__ < 14000029L
#    define FMT_USE_CONSTEVAL 0  // consteval is broken in Apple clang < 14.
#  elif FMT_MSC_VERSION && FMT_MSC_VERSION < 1929
#    define FMT_USE_CONSTEVAL 0  // consteval is broken in MSVC VS2019 < 16.10.
#  elif defined(__cpp_consteval)
#    define FMT_USE_CONSTEVAL 1
#  elif FMT_GCC_VERSION >= 1002 || FMT_CLANG_VERSION >= 1101
#    define FMT_USE_CONSTEVAL 1
#  else
#    define FMT_USE_CONSTEVAL 0
#  endif
#endif`;

const RUBY_HELPER = `
def ${HELPER_NAME}(installer)
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |build_config|
      current_target = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
      if current_target && Gem::Version.new(current_target) < Gem::Version.new('${DEPLOYMENT_TARGET}')
        build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${DEPLOYMENT_TARGET}'
      end

      next unless target.name == 'fmt'

      definitions = build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
      definitions = [definitions] unless definitions.is_a?(Array)
      definitions << 'FMT_USE_CONSTEVAL=0' unless definitions.include?('FMT_USE_CONSTEVAL=0')
      build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = definitions
    end
  end

  base_header = File.join(installer.sandbox.root.to_s, 'fmt', 'include', 'fmt', 'base.h')
  return unless File.exist?(base_header)

  source = File.read(base_header)
  current = <<~'FMT'
${FMT_SOURCE_BLOCK}
  FMT
  replacement = <<~'FMT'
${FMT_PATCHED_BLOCK}
  FMT

  if source.include?(current) && !source.include?('#if !defined(FMT_USE_CONSTEVAL)')
    File.write(base_header, source.sub(current, replacement))
  end
end
`.trim();

function addHelper(contents) {
  if (contents.includes(`def ${HELPER_NAME}(installer)`)) {
    return contents;
  }

  const anchor = "target 'NitroStorage' do";
  if (!contents.includes(anchor)) {
    throw new Error(`Could not find Podfile anchor: ${anchor}`);
  }

  return contents.replace(anchor, `${RUBY_HELPER}\n\n${anchor}`);
}

function addPostInstallCall(contents) {
  const call = `    ${HELPER_NAME}(installer)\n`;
  if (contents.includes(call)) {
    return contents;
  }

  return contents.replace(
    /(  post_install do \|installer\|\n[\s\S]*?)(  end\nend)/,
    `$1\n${call}$2`,
  );
}

function patchProjectBuildGradle(contents) {
  return contents.replace(
    "maven { url 'https://www.jitpack.io' }",
    "maven { url = uri('https://www.jitpack.io') }",
  );
}

function patchAppBuildGradle(contents) {
  return contents
    .replace(
      "ndkVersion rootProject.ext.ndkVersion",
      "ndkVersion = rootProject.ext.ndkVersion",
    )
    .replace(
      "buildToolsVersion rootProject.ext.buildToolsVersion",
      "buildToolsVersion = rootProject.ext.buildToolsVersion",
    )
    .replace(
      "compileSdk rootProject.ext.compileSdkVersion",
      "compileSdk = rootProject.ext.compileSdkVersion",
    )
    .replace(
      "namespace 'com.nitrostorage.example'",
      "namespace = 'com.nitrostorage.example'",
    )
    .replace(
      "applicationId = 'com.nitrostorage.example'",
      "applicationId 'com.nitrostorage.example'",
    )
    .replace(
      "minSdkVersion rootProject.ext.minSdkVersion",
      "minSdk = rootProject.ext.minSdkVersion",
    )
    .replace(
      "targetSdkVersion rootProject.ext.targetSdkVersion",
      "targetSdk = rootProject.ext.targetSdkVersion",
    )
    .replace("versionCode 1", "versionCode = 1")
    .replace('versionName "1.0.0"', 'versionName = "1.0.0"')
    .replace(
      'buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL", "\\"${findProperty(\'reactNativeReleaseLevel\') ?: \'stable\'}\\""',
      'buildConfigField("String", "REACT_NATIVE_RELEASE_LEVEL", "\\"${findProperty(\'reactNativeReleaseLevel\') ?: \'stable\'}\\"")',
    )
    .replaceAll(
      "signingConfig signingConfigs.debug",
      "signingConfig = signingConfigs.debug",
    )
    .replace(
      "shrinkResources enableShrinkResources.toBoolean()",
      "shrinkResources = enableShrinkResources.toBoolean()",
    )
    .replace(
      "minifyEnabled enableMinifyInReleaseBuilds",
      "minifyEnabled = enableMinifyInReleaseBuilds",
    )
    .replace(
      "crunchPngs enablePngCrunchInRelease.toBoolean()",
      "crunchPngs = enablePngCrunchInRelease.toBoolean()",
    )
    .replace(
      "useLegacyPackaging enableLegacyPackaging.toBoolean()",
      "useLegacyPackaging = enableLegacyPackaging.toBoolean()",
    )
    .replace(
      "ignoreAssetsPattern '!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~'",
      "ignoreAssetsPattern = '!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~'",
    );
}

const withFmtIosCompat = (config) =>
  withAppBuildGradle(
    withProjectBuildGradle(
      withPodfile(config, (config) => {
        let contents = config.modResults.contents;
        contents = addHelper(contents);
        contents = addPostInstallCall(contents);
        config.modResults.contents = contents;
        return config;
      }),
      (config) => {
        config.modResults.contents = patchProjectBuildGradle(
          config.modResults.contents,
        );
        return config;
      },
    ),
    (config) => {
      config.modResults.contents = patchAppBuildGradle(
        config.modResults.contents,
      );
      return config;
    },
  );

module.exports = createRunOncePlugin(
  withFmtIosCompat,
  "with-fmt-ios-compat",
  "1.0.0",
);
