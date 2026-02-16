const base = require("../../eslint.config.js");

module.exports = [
  ...base,
  {
    ignores: ["src/__tests__/**"],
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-import-type-side-effects": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "import-x/order": "off",
      "no-console": "off",
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "off",
    },
  },
];
