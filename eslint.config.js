import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      // Deno edge functions — different runtime and type system, linted by `deno check`.
      "supabase/functions/**",
      // Auto-generated Lovable Cloud client files.
      "src/integrations/supabase/previewAuthStorage.ts",
      "src/integrations/supabase/types.ts",
    ],
  },
  {
    files: ["*.config.ts", "*.config.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },

  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
