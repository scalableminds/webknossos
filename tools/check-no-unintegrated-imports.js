#!/usr/bin/env node
// `viewer/model/volumetracing/not_yet_integrated` holds parts of the volume
// annotation design that are built but not wired into the app yet (the journal,
// the editing session), plus the in-memory stand-ins that let the core be
// exercised without the viewer. See design doc §12. Only tests may import it;
// anything that production code needs belongs in `core/` or `integration/`.
const fs = require("node:fs");
const path = require("node:path");
const glob = require("glob");

const ROOT = path.resolve(".");
const UNINTEGRATED_DIR = "viewer/model/volumetracing/not_yet_integrated";
const importsUnintegrated = new RegExp(`['"\`]${UNINTEGRATED_DIR}`);
// The folder is naturally allowed to import itself.
const ALLOWED_PREFIXES = ["frontend/javascripts/test/", `frontend/javascripts/${UNINTEGRATED_DIR}/`];

const files = glob.sync("frontend/javascripts/**/*.{ts,tsx}", { absolute: true });
const violations = [];

for (const file of files) {
  const relPath = path.relative(ROOT, file);
  if (ALLOWED_PREFIXES.some((prefix) => relPath.startsWith(prefix))) continue;
  if (importsUnintegrated.test(fs.readFileSync(file, "utf8"))) {
    violations.push(relPath);
  }
}

if (violations.length > 0) {
  console.error(`\n🚨 Production code importing from ${UNINTEGRATED_DIR}!\n`);
  for (const file of violations) {
    console.error("  -", file);
  }
  console.error(
    "\n👉 That folder is not wired into the app. Move the code you need into `core/` (if it is",
  );
  console.error("   part of the architecture) or `integration/` (if it bridges to the viewer).");
  process.exit(1);
} else {
  console.log("✅ No forbidden `not_yet_integrated` imports found.");
}
