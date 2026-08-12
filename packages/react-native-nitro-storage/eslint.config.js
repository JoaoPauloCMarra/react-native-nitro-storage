const base = require("../../eslint.config.js");

module.exports = [
  ...base,
  {
    ignores: ["src/__tests__/**", "**/*.nitro.ts"],
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      // StorageScope/AccessControl/BiometricLevel members are a public ABI
      // published as PascalCase enum values; keep the base naming contract
      // for every other selector.
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "typeLike",
          format: ["PascalCase"],
          leadingUnderscore: "forbid",
        },
        {
          selector: "enumMember",
          format: ["PascalCase", "UPPER_CASE"],
        },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
];
