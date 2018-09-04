#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies */
const program = require("commander");
const randomstring = require("randomstring");
const execSync = require("child_process").execSync;
const path = require("path");
const fs = require("fs");
const glob = require("glob");
const tmp = require("tmp");
const rimraf = require("rimraf");
const replace = require("replace-in-file");

let POSTGRES_URL = process.env.POSTGRES_URL;
const ORIGINAL_POSTGRES_URL =
  typeof POSTGRES_URL !== "undefined" ? POSTGRES_URL : "jdbc:postgresql://localhost/webknossos";
const scriptdir = __dirname;
const scriptName = __filename;
let p1;
let p2;
let dir1;
let dir2;

function dump(parameter) {
  if (parameter === "DB") {
    POSTGRES_URL = ORIGINAL_POSTGRES_URL; // this environment variable is passed to dump_schema.sh
    return dumpToFolder();
  } else {
    const { dbName, dbHost } = initTmpDB();
    console.log(`Creating DB ${dbName}`);
    execSync(`psql -U postgres -h ${dbHost} -c "CREATE DATABASE ${dbName};"`, {
      env: { PGPASSWORD: "postgres" },
    });
    try {
      loadDataIntoDB(parameter, dbHost, dbName);
      return dumpToFolder();
    } catch (err) {
      console.log(err);
      process.exit(1);
    } finally {
      console.log(`CLEANUP: DROP DATABASE ${dbName}`);
      execSync(`psql -U postgres -h ${dbHost} -c "DROP DATABASE ${dbName};"`, {
        env: { PGPASSWORD: "postgres" },
      });
    }
  }
  return null;
}

function initTmpDB() {
  const tempDbName = generateRandomName();
  const postgresDirname = path.dirname(ORIGINAL_POSTGRES_URL);
  POSTGRES_URL = `${postgresDirname}/${tempDbName}`; // this environment variable is passed to dump_schema.sh
  const dbName = execSync(`${scriptdir}/db_name.sh`, { env: { POSTGRES_URL } })
    .toString()
    .trim(); // "trim" to remove the line break
  if (dbName !== tempDbName) {
    console.log("Wrong dbName");
    process.exit(1);
  }
  const dbHost = execSync(`${scriptdir}/db_host.sh`, { env: { POSTGRES_URL } })
    .toString()
    .trim();
  return {
    dbName,
    dbHost,
  };
}

function loadDataIntoDB(parameter, dbHost, dbName) {
  const fileNames = glob.sync(parameter);
  const concatenateFileNames = fileNames.map(name => `-f ${name}`).join(" ");
  execSync(
    `psql -U postgres -h ${dbHost} --dbname="${dbName}" -v ON_ERROR_STOP=ON -q ${concatenateFileNames}`,
    { env: { PGPASSWORD: "postgres" } },
  );
}

function dumpToFolder() {
  const tmpDir = tmp.dirSync();
  try {
    execSync(`${scriptdir}/dump_schema.sh ${tmpDir.name}`, { env: { POSTGRES_URL } });
  } catch (err) {
    console.log(`CLEANUP: remove ${tmpDir.name}`);
    rimraf.sync(tmpDir.name);
    process.exit(1);
  }
  return tmpDir.name;
}

function generateRandomName() {
  const random = randomstring.generate({
    length: 8,
    charset: "alphanumeric",
    capitalization: "lowercase",
  });
  return `wk_tmp_${random}`;
}

function sortFile(fileName) {
  try {
    const content = fs.readFileSync(fileName);
    let lines = content.toString().split("\n");
    lines = lines.sort();
    fs.writeFileSync(fileName, lines.join("\n"));
  } catch (err) {
    console.log(`FAILED to sort file ${fileName}`);
    process.exit(1);
  }
}

program
  .version("0.1.0", "-v, --version")
  .arguments("<parameter1> <parameter2>")
  .action((parameter1, parameter2) => {
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
  // sort and remove commas
  glob.sync(`${dir1}/**`, { nodir: true }).forEach(fileName => {
    replace.sync({ files: fileName, from: /,$/gm, to: "" });
    sortFile(fileName);
  });
  glob.sync(`${dir2}/**`, { nodir: true }).forEach(fileName => {
    replace.sync({ files: fileName, from: /,$/gm, to: "" });
    sortFile(fileName);
  });

  // diff
  try {
    execSync(`diff -r ${dir1} ${dir2}`, { stdio: [0, 1, 2] }); // we pass the std-output to the child process to see the diff
    console.log("[SUCCESS] Schemas do match");
  } catch (err) {
    console.log("[FAILED] Schemas do not match");
  }
} catch (err) {
  console.log(err);
} finally {
  if (typeof dir1 !== "undefined" && dir1) {
    console.log(`CLEANUP: remove ${dir1}`);
    rimraf.sync(dir1);
  }
  if (typeof dir2 !== "undefined" && dir2) {
    console.log(`CLEANUP: remove ${dir2}`);
    rimraf.sync(dir2);
  }
}
