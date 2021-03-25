#!/usr/bin/env node
// @noflow
/* eslint-disable import/no-extraneous-dependencies, prefer-template, prefer-arrow-callback */
const program = require("commander");
const randomstring = require("randomstring");
const execSync = require("child_process").execSync;
const path = require("path");
const fs = require("fs");
const glob = require("glob");
const rimraf = require("rimraf");
const replace = require("replace-in-file");

const POSTGRES_URL =
  typeof process.env.POSTGRES_URL !== "undefined"
    ? process.env.POSTGRES_URL
    : "jdbc:postgresql://localhost/webknossos";
const scriptdir = __dirname;
const scriptName = __filename;

let p1;
let p2;
let dir1;
let dir2;
let exitCode;

function dump(parameter) {
  if (parameter === "DB") {
    return dumpToFolder(POSTGRES_URL);
  } else {
    const tmpdb = initTmpDB();
    const dbName = tmpdb[0];
    const dbHost = tmpdb[1];
    const postgresUrl = tmpdb[2];
    console.log("Creating DB " + dbName);
    execSync("psql -U postgres -h " + dbHost + " -c 'CREATE DATABASE " + dbName + ";'", {
      env: { PGPASSWORD: "postgres" },
    });
    try {
      loadDataIntoDB(parameter, dbHost, dbName);
      return dumpToFolder(postgresUrl);
    } catch (err) {
      console.log(err);
      process.exit(1);
    } finally {
      console.log("CLEANUP: DROP DATABASE " + dbName);
      execSync("psql -U postgres -h " + dbHost + " -c 'DROP DATABASE " + dbName + ";'", {
        env: { PGPASSWORD: "postgres" },
      });
    }
  }
  return null;
}

function initTmpDB() {
  const tempDbName = generateRandomName();
  const postgresDirname = path.dirname(POSTGRES_URL);
  const postgresUrl = postgresDirname + "/" + tempDbName;
  const dbName = execSync(scriptdir + "/db_name.sh", { env: { POSTGRES_URL: postgresUrl } })
    .toString()
    .trim(); // "trim" to remove the line break
  if (dbName !== tempDbName) {
    console.log("Wrong dbName");
    process.exit(1);
  }
  const dbHost = execSync(scriptdir + "/db_host.sh", { env: { POSTGRES_URL: postgresUrl } })
    .toString()
    .trim();
  return [dbName, dbHost, postgresUrl];
}

function loadDataIntoDB(parameter, dbHost, dbName) {
  const fileNames = glob.sync(parameter);
  const concatenateFileNames = fileNames.map(name => "-f " + name).join(" ");
  // prettier-ignore
  execSync(
    "psql -U postgres -h " + dbHost + " --dbname='" + dbName + "' -v ON_ERROR_STOP=ON -q " + concatenateFileNames,
    { env: { PGPASSWORD: "postgres" } }
  );
}

function dumpToFolder(postgresUrl) {
  const tmpDir = execSync("mktemp -d")
    .toString()
    .trim();
  try {
    execSync(scriptdir + "/dump_schema.sh " + tmpDir, { env: { POSTGRES_URL: postgresUrl } });
  } catch (err) {
    console.log("CLEANUP: remove " + tmpDir);
    rimraf.sync(tmpDir);
    process.exit(1);
  }
  return tmpDir;
}

function generateRandomName() {
  const random = randomstring.generate({
    length: 8,
    charset: "alphanumeric",
    capitalization: "lowercase",
  });
  return "wk_tmp_" + random;
}

function sortAndClean(dumpedDir) {
  glob.sync(dumpedDir + "/**", { nodir: true }).forEach(function(fileName) {
    replace({ files: fileName, replace: /,$/gm, with: "" });
    replace({ files: fileName, replace: /\\r/gm, with: "  " });
    sortFile(fileName);
  });
}

function sortFile(fileName) {
  try {
    const content = fs.readFileSync(fileName);
    let lines = content.toString().split("\n");
    lines = lines.sort();
    fs.writeFileSync(fileName, lines.join("\n"));
  } catch (err) {
    console.log("FAILED to sort file " + fileName);
    process.exit(1);
  }
}

program
  .version("0.1.0", "-v, --version")
  .arguments("<parameter1> <parameter2>")
  .action(function(parameter1, parameter2) {
    p1 = parameter1;
    p2 = parameter2;
  });

if (process.argv.length !== 4) {
  // 2 "real" parameter
  console.log("Usage: $0 <sqlFiles|DB> <sqlFiles|DB>");
  console.log("Examples:");
  console.log("  node ", scriptName, ' tools/postgres/schema.sql "conf/evolutions/*.sql"');
  console.log("  node ", scriptName, " tools/postgres/schema.sql DB");
  process.exit(1);
}

try {
  program.parse(process.argv);
  dir1 = dump(p1);
  dir2 = dump(p2);
  // sort and remove commas and occurences of "\r"
  sortAndClean(dir1);
  sortAndClean(dir2);
  // diff
  try {
    execSync("diff --strip-trailing-cr -r " + dir1 + " " + dir2);
    exitCode = 0;
    console.log("[SUCCESS] Schemas do match");
  } catch (err) {
    exitCode = 1;
    console.log(err.stdout.toString("utf8"));
    console.log("[FAILED] Schemas do not match");
  }
} catch (err) {
  console.log(err);
  exitCode = 2;
} finally {
  if (typeof dir1 !== "undefined" && dir1) {
    console.log("CLEANUP: remove " + dir1);
    rimraf.sync(dir1);
  }
  if (typeof dir2 !== "undefined" && dir2) {
    console.log("CLEANUP: remove " + dir2);
    rimraf.sync(dir2);
  }
  process.exit(exitCode);
}
