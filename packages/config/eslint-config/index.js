/** @type {import('eslint').Linter.Config} */
module.exports = {
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-empty-interface": "off",
    "no-console": "warn",
  },
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  ignorePatterns: ["dist/", "node_modules/", "*.js"],
};
