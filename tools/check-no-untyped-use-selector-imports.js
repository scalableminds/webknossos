#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const glob = require("glob");

const ROOT = path.resolve(".");
const importUseSelectorFromReactRedux =
  /import\s*\{[^}]*\buseSelector\b[^}]*\}\s*from\s*['"]react-redux['"]/s;
// Relative paths from repo root to allow with untyped useSelector statements.
const WHITELIST = [
  // Our typed wrapper is allowed to import the untyped useSelector from react-redux.
  "frontend/javascripts/libs/react_hooks.ts",
];

const files = glob.sync("frontend/javascripts/**/*.{ts,tsx}", { absolute: true, nodir: true });
const violations = [];

for (const file of files) {
  const relPath = path.relative(ROOT, file);
  if (WHITELIST.includes(relPath) || WHITELIST.some((p) => relPath.startsWith(p))) continue;

  const content = fs.readFileSync(file, "utf8");
  if (importUseSelectorFromReactRedux.test(content)) {
    violations.push(relPath);
  }
}

if (violations.length > 0) {
  console.error("\n🚨 Forbidden `useSelector` import from react-redux found!\n");
  for (const file of violations) {
    console.error("  -", file);
  }
  console.error(
    "\n👉 Use the typed `useWkSelector` from libs/react_hooks instead. E.g.:",
  );
  console.error(`import { useWkSelector } from "libs/react_hooks"`);
  process.exit(1);
} else {
  console.log("✅ No forbidden `useSelector` imports found.");
}
