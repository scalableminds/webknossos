#!/usr/bin/env node
// Reports which components and hooks the React Compiler could not optimize.
//
// The script runs babel-plugin-react-compiler over every frontend file and
// collects the compiler's log events. This is the same information that the
// VS Code extension "react-compiler-marker" shows in the editor.
// It uses the default compiler options, like the Vite build in vite.config.ts.
//
// Usage: yarn react-compiler-report [--json] [--summary] [--check] [path-or-glob ...]
//   --json     print machine readable JSON instead of text
//   --summary  print only the counts and the most common reasons
//   --check    exit with code 1 if a function is not compiled and is not listed in
//              ALLOWED_FAILURES, or if an entry of ALLOWED_FAILURES compiles now.
//              The CI uses this mode (yarn check-react-compiler).
// Without --check, the script only reports and exits with code 0 unless it cannot run.
const fs = require("node:fs");
const path = require("node:path");
const babel = require("@babel/core");
const glob = require("glob");

const ROOT = path.resolve(".");
const DEFAULT_PATTERN = "frontend/javascripts/**/*.{ts,tsx}";
// Test files and type declarations are not compiled by the real build.
const IGNORE = ["**/test/**", "**/*.spec.{ts,tsx}", "**/*.d.ts"];
// Same cheap pre-filter as reactCompilerPreset() in @vitejs/plugin-react. Files
// that do not match it are never given to the compiler by the build.
const CODE_FILTER =
  /forwardRef|memo|(?:const|let|var|function)\s+(?:[A-Z]|use[A-Z0-9])|(?:[A-Z]|use[A-Z0-9])[^\s:=(){}[\],;]*\s*(?:\(|[:=]\s*(?:function|\())/;

// Functions that are allowed to not be compiled. Each entry needs a reason.
const ALLOWED_FAILURES = [
  {
    file: "frontend/javascripts/libs/react_hooks.ts",
    function: "usePrevious",
    reason:
      "Returns ref.current during render on purpose: the value from the previous render. " +
      "Components that call the hook still compile.",
  },
];

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const summaryOnly = args.includes("--summary");
const checkMode = args.includes("--check");
const patterns = args.filter((arg) => !arg.startsWith("--"));

const files = (patterns.length > 0 ? patterns : [DEFAULT_PATTERN])
  .flatMap((pattern) =>
    glob.sync(pattern, { ignore: IGNORE, absolute: true, nodir: true }),
  )
  .sort();

// The compiler does not report a name for functions like `const Foo = () => {}`.
// Read the name from the line where the function starts instead.
function guessFunctionName(lines, fnName, startLine) {
  if (fnName) return fnName;
  const line = lines[startLine - 1] ?? "";
  const match = line.match(/(?:function\s+|(?:const|let|var)\s+)([\w$]+)/);
  return match ? match[1] : line.trim().slice(0, 60);
}

function shorten(text, maxLength = 200) {
  const firstLine = text.split("\n")[0];
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength)}…` : firstLine;
}

function analyzeFile(file) {
  const code = fs.readFileSync(file, "utf8");
  if (!CODE_FILTER.test(code)) return { compiled: 0, failures: [] };

  const lines = code.split("\n");
  // One function can produce several errors. They are grouped by function.
  const failuresByFunction = new Map();
  let compiled = 0;
  const logger = {
    logEvent(_filename, event) {
      if (event.kind === "CompileSuccess") {
        compiled++;
      } else if (event.kind === "CompileError") {
        const detail = event.detail;
        const fnStart = event.fnLoc?.start ?? null;
        // The first error location inside the function is more helpful than
        // the start of the function.
        const errorStart = detail.options?.details?.[0]?.loc?.start ?? detail.loc?.start ?? fnStart;
        const key = fnStart?.index ?? failuresByFunction.size;
        if (!failuresByFunction.has(key)) {
          failuresByFunction.set(key, {
            function: guessFunctionName(lines, event.fnName, fnStart?.line),
            line: fnStart?.line ?? null,
            errors: [],
          });
        }
        failuresByFunction.get(key).errors.push({
          reason: detail.reason ?? detail.message ?? "unknown reason",
          description: detail.description ?? null,
          line: errorStart?.line ?? null,
          column: errorStart?.column != null ? errorStart.column + 1 : null,
        });
      }
    },
  };

  babel.transformSync(code, {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceType: "module",
    // The compiler only reads the AST, so the TypeScript syntax can stay in.
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [["babel-plugin-react-compiler", { logger, panicThreshold: "none" }]],
    // The output is not needed.
    code: false,
    ast: false,
  });
  return { compiled, failures: [...failuresByFunction.values()] };
}

const report = [];
let compiledTotal = 0;
const crashed = [];
for (const file of files) {
  const relPath = path.relative(ROOT, file);
  try {
    const { compiled, failures } = analyzeFile(file);
    compiledTotal += compiled;
    for (const failure of failures) report.push({ file: relPath, ...failure });
  } catch (error) {
    crashed.push({ file: relPath, error: String(error.message).split("\n")[0] });
  }
}

const isSameFunction = (a, b) => a.file === b.file && a.function === b.function;
const unexpectedFailures = report.filter(
  (failure) => !ALLOWED_FAILURES.some((allowed) => isSameFunction(allowed, failure)),
);
const analyzedFiles = new Set(files.map((file) => path.relative(ROOT, file)));
const outdatedAllowances = ALLOWED_FAILURES.filter(
  (allowed) =>
    analyzedFiles.has(allowed.file) && !report.some((failure) => isSameFunction(allowed, failure)),
);

const reasonCounts = new Map();
for (const { errors } of report) {
  for (const reason of new Set(errors.map((error) => error.reason))) {
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
}
const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        compiled: compiledTotal,
        notCompiled: report.length,
        filesAnalyzed: files.length,
        failures: report,
        unparsableFiles: crashed,
      },
      null,
      2,
    ),
  );
} else {
  if (!summaryOnly) {
    let currentFile = null;
    // In check mode, the allowed failures are not listed.
    for (const f of checkMode ? unexpectedFailures : report) {
      if (f.file !== currentFile) {
        console.log(`\n${f.file}`);
        currentFile = f.file;
      }
      console.log(`  ${f.line}  ${f.function}`);
      for (const error of f.errors) {
        console.log(`    ${error.line}:${error.column}  ${error.reason}`);
        if (error.description) console.log(`      ${shorten(error.description)}`);
      }
    }
  }
  console.log(
    `\nReact Compiler: ${compiledTotal} functions compiled, ${report.length} not compiled ` +
      `(${files.length} files analyzed).`,
  );
  if (topReasons.length > 0) {
    console.log("\nMost common reasons:");
    for (const [reason, count] of topReasons.slice(0, 10)) console.log(`  ${count}x  ${reason}`);
  }
  if (crashed.length > 0) {
    console.log(`\nCould not analyze ${crashed.length} file(s):`);
    for (const { file, error } of crashed) console.log(`  ${file}: ${error}`);
  }
}

if (checkMode) {
  for (const allowed of outdatedAllowances) {
    console.log(
      `\n${allowed.function} in ${allowed.file} compiles now. ` +
        "Remove it from ALLOWED_FAILURES in tools/react-compiler-report.js.",
    );
  }
  if (unexpectedFailures.length > 0) {
    console.log(
      `\n❌ The React Compiler cannot compile ${unexpectedFailures.length} function(s), see above. ` +
        "Fix them, or add them with a reason to ALLOWED_FAILURES in tools/react-compiler-report.js.",
    );
  }
  if (unexpectedFailures.length > 0 || outdatedAllowances.length > 0 || crashed.length > 0) {
    process.exitCode = 1;
  } else {
    console.log("✅ The React Compiler compiles all components and hooks.");
  }
}
