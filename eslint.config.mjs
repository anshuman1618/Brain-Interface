import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

/**
 * Lint configuration for the workspace.
 *
 * Deliberately *not* type-aware. The type-checked rulesets need a full program
 * per package and would double the wall-clock cost of a check that `pnpm
 * typecheck` already performs from the compiler itself — this config is here to
 * catch the things tsc cannot see (a mis-ordered hook, an unused binding, a
 * `case` that falls through), not to re-litigate types.
 *
 * `eslint-config-prettier` is last on purpose: it switches off every stylistic
 * rule so formatting has exactly one owner, and that owner is Prettier.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.tsbuildinfo",
      ".preview-data/**",
      "attached_assets/**",
      // Written by orval from lib/api-spec/openapi.yaml. Editing these to
      // satisfy a lint rule would be overwritten by the next codegen run.
      "lib/api-zod/src/generated/**",
      "lib/api-client-react/src/generated/**",
      "artifacts/mockup-sandbox/src/.generated/**",
      // Standalone integration scripts, run by node against a live server.
      "scripts/ci/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // An unused binding is usually a leftover; an underscore prefix is the
      // documented way to say "required by the signature, deliberately unused".
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // `catch {}` around a JSON parse is idiomatic here; an empty *block*
      // elsewhere is not.
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
    },
  },

  // Frontend: browser globals, plus the two rules that catch real React bugs
  // rather than style — hook ordering and Fast Refresh boundaries.
  {
    files: ["artifacts/practice-portal/**/*.{ts,tsx}", "artifacts/mockup-sandbox/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // Vendored shadcn/ui primitives. They are ours to edit, but they ship with
  // helper exports (cva variants, sub-component factories) alongside components
  // by design, so the Fast Refresh rule fires on the pattern rather than on a
  // mistake.
  {
    files: [
      "artifacts/practice-portal/src/components/ui/**/*.{ts,tsx}",
      "artifacts/mockup-sandbox/src/components/ui/**/*.{ts,tsx}",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },

  // Context modules deliberately export a provider *and* its consumer hook from
  // one file — that pairing is the whole point, and splitting them to appease
  // Fast Refresh would scatter a context across two files for no gain.
  {
    files: [
      "artifacts/practice-portal/src/lib/session.tsx",
      "artifacts/practice-portal/src/lib/theme.tsx",
      "artifacts/practice-portal/src/components/pricing-modal.tsx",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },

  // Config and build scripts run in Node before any bundling.
  {
    files: ["**/*.config.{js,mjs,ts}", "**/build.mjs", "scripts/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },

  prettier,
);
