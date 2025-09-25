import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";

export default [
  // Ignore patterns first
  {
    ignores: [
      "node_modules/**",
      "**/node_modules/**",
      "dist/**",
      "**/dist/**",
      ".next/**",
      "**/.next/**",
      "out/**",
      "build/**",
      "coverage/**",
      ".turbo/**",
      "**/*.d.ts",
      "next-env.d.ts",
      "pnpm-lock.yaml",
      "**/*.config.{js,mjs,cjs}",
      "**/*.min.js",
      "**/live2d/**",
      "public/live2d/**",
      "**/.vscode/**",
      "**/.git/**",
    ],
  },

  // Base configuration for all files
  js.configs.recommended,

  // Configuration for TypeScript files
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        // Node.js globals
        process: "readonly",
        Buffer: "readonly",
        global: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        // Browser globals
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        // React globals
        React: "readonly",
        JSX: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Extend recommended TypeScript rules
      ...tseslint.configs.recommended.rules,

      // TypeScript specific rules
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-expressions": "off",

      // General rules
      "prefer-const": "error",
      "no-var": "error",
      "no-console": "warn",
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
      "no-undef": "off", // TypeScript handles this
      "no-empty": "off",
    },
  },

  // Configuration for JavaScript files
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // Node.js globals
        process: "readonly",
        Buffer: "readonly",
        global: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        // Browser globals
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      "prefer-const": "error",
      "no-var": "error",
      "no-console": "warn",
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
    },
  },

  // Apply prettier config last to avoid conflicts
  prettier,
];
