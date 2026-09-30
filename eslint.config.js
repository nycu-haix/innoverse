import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// ESLint handles correctness only; formatting is Prettier's job (repo .prettierrc).
export default tseslint.config(
	{
		ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "services/**", "apps/server/.runtime/**"]
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.{ts,tsx}"],
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
			"@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": "allow-with-description" }],
			eqeqeq: ["error", "always"],
			"no-console": ["warn", { allow: ["warn", "error"] }]
		}
	},
	{
		files: ["apps/web/**/*.{ts,tsx}"],
		languageOptions: { globals: globals.browser },
		plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
		rules: {
			...reactHooks.configs.recommended.rules,
			"react-refresh/only-export-components": ["warn", { allowConstantExport: true }]
		}
	},
	{
		files: ["apps/server/**/*.ts", "packages/**/*.ts", "**/*.config.{js,ts}", "apps/web/scripts/**/*.mjs"],
		languageOptions: { globals: globals.node }
	},
	{
		files: ["**/test/**/*.{ts,tsx}"],
		rules: { "@typescript-eslint/no-non-null-assertion": "off" }
	}
);
