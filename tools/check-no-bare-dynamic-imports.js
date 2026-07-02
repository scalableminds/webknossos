#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const glob = require("glob");

const ROOT = path.resolve(".");

// Relative paths from repo root that are allowed to use bare dynamic import().
const WHITELIST = [
  // Benchmark-only dev API. Wrapping in importDynamic would reintroduce a
  // cyclic dependency and a failed import is acceptable here.
  "frontend/javascripts/viewer/api/wk_dev.ts",
  // Web workers are eagerly bundled by Vite; this import() is only reached in
  // Vitest/Node, where importDynamic's stale-chunk protection does not apply.
  "frontend/javascripts/viewer/workers/comlink_wrapper.ts",
  // Worker modules must not use importDynamic: it pulls main-thread UI (antd,
  // Toast) into every worker bundle and its failure toast cannot render inside
  // a worker anyway. A failed import rejects the pending promise, which Comlink
  // propagates to the main-thread caller.
  "frontend/javascripts/viewer/workers/byte_array_lz4_compression.worker.ts",
  "frontend/javascripts/viewer/workers/byte_arrays_to_lz4_base64.worker.ts",
];

// A dynamic import() call that is wrapped by importDynamic(() => …) or
// loadable(() => …) / loadable<T>(() => …). loadable() is allowed because it
// calls importDynamic() internally. The pattern tolerates whitespace and
// newlines between the wrapper and the import() call. Capturing group 1 is the
// `import(` token so its offset can be marked as allowed.
const WRAPPED_IMPORT =
  /\b(?:importDynamic|loadable)\s*(?:<[^>]*>)?\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*(import\s*\()/gs;

// A dynamic import() call expression with an actual argument. The non-empty
// argument requirement skips mentions of `import()` in comments.
const IMPORT_CALL = /\bimport\s*\(\s*[^)\s]/g;

const files = glob.sync("frontend/javascripts/**/*.{ts,tsx}", { absolute: true, nodir: true });
const violations = [];

for (const file of files) {
  const relPath = path.relative(ROOT, file);
  if (WHITELIST.includes(relPath) || WHITELIST.some((p) => relPath.startsWith(p))) continue;

  const content = fs.readFileSync(file, "utf8");

  // Offsets (at the `import` keyword) of import() calls that are wrapped, and
  // therefore allowed.
  const allowed = new Set();
  for (let m = WRAPPED_IMPORT.exec(content); m; m = WRAPPED_IMPORT.exec(content)) {
    allowed.add(m.index + m[0].length - m[1].length);
  }

  for (let m = IMPORT_CALL.exec(content); m; m = IMPORT_CALL.exec(content)) {
    // Skip the import-type expression `typeof import("…")`, which is not a call.
    if (/\btypeof\s*$/.test(content.slice(Math.max(0, m.index - 40), m.index))) continue;
    if (allowed.has(m.index)) continue;
    const line = content.slice(0, m.index).split("\n").length;
    violations.push(`${relPath}:${line}`);
  }
}

if (violations.length > 0) {
  console.error("\n🚨 Forbidden bare dynamic `import()` call found!\n");
  for (const violation of violations) {
    console.error("  -", violation);
  }
  console.error(
    "\n👉 Wrap dynamic imports in `importDynamic(() => import(...))` (or `loadable`) so that",
  );
  console.error(
    "   failed chunk loads are surfaced gracefully. See libs/import_dynamic.tsx.",
  );
  process.exit(1);
} else {
  console.log("✅ No forbidden bare dynamic `import()` calls found.");
}
