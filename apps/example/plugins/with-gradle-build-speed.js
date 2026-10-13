const { withGradleProperties } = require("expo/config-plugins");

const SPEED_PROPERTIES = {
  "org.gradle.caching": "true",
  "org.gradle.parallel": "true",
  "org.gradle.jvmargs": "-Xmx6g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError",
  "kotlin.daemon.jvm.options": "-Xmx3g",
};

function setProperty(properties, key, value) {
  const existing = properties.find(
    (item) => item.type === "property" && item.key === key,
  );
  if (existing) {
    existing.value = value;
    return;
  }
  properties.push({ type: "property", key, value });
}

module.exports = function withGradleBuildSpeed(config) {
  return withGradleProperties(config, (modConfig) => {
    for (const [key, value] of Object.entries(SPEED_PROPERTIES)) {
      setProperty(modConfig.modResults, key, value);
    }
    return modConfig;
  });
};
