import eslint from "@eslint/js";
import globals from "globals";
import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  eslint.configs.recommended,
  ...typescriptEslint.configs.recommendedTypeChecked.map((configuration) => ({
    ...configuration,
    files: ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
  })),
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    files: ["eslint.config.js", "scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
