import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default tseslint.config(
    { ignores: ["old/", "dist/", "node_modules/", "test-vid/", "test-img/", "public/"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        // App code runs in the browser and in workers only. Node globals are
        // deliberately absent here so they cannot leak into src/.
        files: ["src/**/*.ts"],
        languageOptions: { globals: { ...globals.browser, ...globals.worker } }
    },
    {
        files: ["tests/**/*.ts", "*.config.{js,ts}"],
        languageOptions: { globals: { ...globals.node } }
    },
    {
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
        }
    },
    prettier
);
