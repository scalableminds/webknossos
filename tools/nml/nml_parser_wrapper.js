const program = require("commander");
const fs = require("fs");

const { parseNml } = require("../../public/server-bundle/main");

function parseFile(err, fileContent) {
  if (err) throw err;
  console.log(fileContent);
  console.log(parseNml(fileContent));
}

let nmlPath;
program
  .version("0.1.0", "-v, --version")
  .arguments("<parameter1>")
  .action(function(parameter1) {
    nmlPath = parameter1;
  });

if (process.argv.length !== 3) {
  // 2 "real" parameters
  console.log("Usage: $0 <nmlPath>");
  console.log("Example:");
  console.log("  node ", process.argv[1], " path/to/skeleton.nml");
  process.exit(1);
}

try {
  program.parse(process.argv);

  fs.readFile(nmlPath, "utf8", parseFile);

  console.log("Hello from NML Parser Node Script. Was called with nmlPath", nmlPath);
} catch (err) {
  console.log(err);
  exitCode = 2;
}
