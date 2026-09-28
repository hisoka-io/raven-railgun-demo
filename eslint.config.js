import js from "@eslint/js";

// TypeScript is checked by `tsc -b` (pnpm typecheck); no TS parser is installed, so ESLint
// covers the plain-JS Node tooling.
const nodeGlobals = Object.fromEntries(
  [
    "process",
    "console",
    "Buffer",
    "fetch",
    "URL",
    "TextEncoder",
    "AbortSignal",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
  ].map((name) => [name, "readonly"]),
);

export default [
  { ignores: ["dist/**", "node_modules/**", "src/**", "observer-logs/**", "**/*.ts", "**/*.tsx"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: nodeGlobals },
  },
];
