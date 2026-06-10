import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowTaggedTemplates: true },
      ],
    },
  },
  {
    ignores: [
      "build/**",
      ".react-router/**",
      ".wrangler/**",
      "node_modules/**",
      "_tmp/**",
      "*.config.js",
      "*.config.ts",
      "worker-configuration.d.ts",
    ],
  }
);
