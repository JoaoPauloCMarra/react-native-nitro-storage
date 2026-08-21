const fs = require("node:fs");

const smokeSource = fs.readFileSync(
  "apps/example/components/smoke-test.tsx",
  "utf8",
);
const maestroFlow = fs.readFileSync("maestro/smoke-tests.yaml", "utf8");
const requiredSourceMarkers = [
  'label: "MMKV migration + scoped secureItem"',
  'label: "Web IndexedDB backend"',
  'testID="smoke-run-all"',
  'entry.status === "fail"',
];
const requiredFlowMarkers = [
  "appId: com.nitrostorage.example",
  'element: "Smoke Test"',
  'tapOn: "Run All"',
  "passed",
  "failed",
];

for (const marker of requiredSourceMarkers) {
  if (!smokeSource.includes(marker)) {
    throw new Error(`Example smoke source is missing: ${marker}`);
  }
}

for (const marker of requiredFlowMarkers) {
  if (!maestroFlow.includes(marker)) {
    throw new Error(`Maestro flow is missing: ${marker}`);
  }
}

const testCount = (smokeSource.match(/label: "/g) ?? []).length;
if (testCount < 20) {
  throw new Error(`Example smoke suite is unexpectedly small: ${testCount}`);
}

console.log(
  `Example smoke contract is valid: ${testCount} labeled tests and terminal-state Maestro assertions.`,
);
