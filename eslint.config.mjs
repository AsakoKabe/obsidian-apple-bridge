import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import obsidianmd from "eslint-plugin-obsidianmd";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

const obsidianPlugin = obsidianmd.default ?? obsidianmd;

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/__tests__/**", "src/__mocks__/**"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      obsidianmd: obsidianPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...obsidianPlugin.configs.recommended,
      "no-console": "error",
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          allowAutoFix: true,
          enforceCamelCaseLower: true,
          brands: [
            "Apple Bridge",
            "Apple Calendar",
            "Apple Reminders",
            "Apple Notes",
            "Apple Contacts",
            "Apple",
            "Obsidian",
            "Markdown",
            "Dataview",
            "Automation",
          ],
        },
      ],
    },
  },
  prettierConfig,
];
