import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
    { ignores: ["dist/", "node_modules/", "test-vid/"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: { globals: { ...globals.browser, ...globals.worker } }
    },
    {
        files: ["scripts/**/*.ts", "tests/**/*.ts", "*.config.{js,ts}"],
        languageOptions: { globals: { ...globals.node } }
    },
    {
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
        }
    }
);
