#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const glob = require("glob");

const ROOT = path.resolve(".");
const importSelectFromTypedReduxSaga =
  /import\s*\{[^}]*\bselect\b[^}]*\}\s*from\s*['"](typed-)?redux-saga/s;
// Relative paths from repo root to allow with untyped select statements.
const WHITELIST = [
  // Our typed wrapper is allowed to import the not well typed variation of the select saga effect.
  "frontend/javascripts/viewer/model/sagas/effect_generators.ts",
  "frontend/javascripts/test/sagas/proofreading/__snapshots__/",
];

const files = glob.sync("frontend/javascripts/**/*.{ts,tsx}", { absolute: true });
const violations = [];

for (const file of files) {
  const relPath = path.relative(ROOT, file);
  if (WHITELIST.includes(relPath) || WHITELIST.some((path) => relPath.startsWith(path))) continue;

  const content = fs.readFileSync(file, "utf8");
  if (importSelectFromTypedReduxSaga.test(content)) {
    violations.push(relPath);
  }
}

if (violations.length > 0) {
  console.error("\n🚨 Forbidden `select` import from (typed-)redux-saga found!\n");
  for (const file of violations) {
    console.error("  -", file);
  }
  console.error(
    "\n👉 Use your custom `select` from your own effect_generators module instead. E.g.:",
  );
  console.error(`import { select } from "viewer/model/sagas/effect_generators"`);
  process.exit(1);
} else {
  console.log("✅ No forbidden `select` imports found.");
}
