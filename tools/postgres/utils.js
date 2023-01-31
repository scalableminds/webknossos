#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { Command } = require("commander");

const schemaPath = path.join(__dirname, "schema.sql");
const evolutionsPath = path.resolve(path.join(__dirname, "..", "..", "conf", "evolutions"));

const PG_DATA = (() => {
  const url = process.env.POSTGRES_URL || "postgres://postgres:postgres@127.0.0.1:5432/webknossos";
  const urlObj = new URL(url);
  return {
    url: url,
    username: urlObj.username !== "" ? urlObj.username : "postgres",
    password: urlObj.password !== "" ? urlObj.password : "postgres",
    hostname: urlObj.hostname,
    port: urlObj.port !== "" ? urlObj.port : 5432,
    database: urlObj.pathname.length > 1 ? urlObj.pathname.substring(1) : "webknossos",
  };
})();

const program = new Command();

function safePsqlSpawn(args, options = {}) {
  const prc = spawnSync("psql", args, { ...options, encoding: "utf-8" });
  if (prc.status !== 0) {
    console.error("PSQL exit code", program.status);
    console.log(program.stdout);
    console.error(program.stderr);
    process.exit(program.status);
  }
  return prc.stdout;
}

function callPsql(sql) {
  return safePsqlSpawn([PG_DATA.url, "-tAc", sql]);
}

function dropDb() {
  callPsql(`DROP DATABASE ${PG_DATA.database}`);
}

function refreshDb() {
  dropDb();
  ensureDb();
}

function ensureDb() {
  const dbExistence = callPsql(
    `SELECT 1 FROM pg_database WHERE datname='${PG_DATA.database}'`,
  ).trim();
  if (dbExistence === "1") {
    console.log("Database already exists");
  } else {
    callPsql(`CREATE DATABASE ${PG_DATA.database};`);
  }
  ensureSchema();
}

function ensureSchema() {
  const schemaName = callPsql(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'webknossos';",
  ).trim();
  if (schemaName === "webknossos") {
    console.log("Schema already exists");
  } else {
    refreshSchema();
  }
}

function prepareTestDb() {
  ensureDb();

  const csvFolder = path.join(__dirname, "..", "..", "test", "db");
  for (const filename of fs.readdirSync(csvFolder)) {
    if (filename.endsWith(".csv")) {
      console.log(filename);
      spawnSync(
        "psql",
        [
          PG_DATA.url,
          "-c",
          `SET session_replication_role = replica; COPY webknossos.${filename.slice(
            0,
            -4,
          )} FROM STDOUT WITH CSV HEADER QUOTE ''''`,
        ],
        {
          encoding: "utf-8",
          input: fs.readFileSync(path.join(csvFolder, filename)),
        },
      );
    }
  }
  console.log(`Done preparing test db (host=${PG_DATA.hostname}, name=${PG_DATA.database})`);
}

function refreshSchema() {
  console.log(spawnSync("psql", [PG_DATA.url, "-f", schemaPath]).stdout);
}

function dumpSchema(schemaDir) {
  if (!fs.existsSync(schemaDir) || !fs.statSync(schemaDir).isDirectory) {
    console.error("Schema directory $schemadir does not exist, aborting!");
    process.exit(1);
  }

  for (const fn of fs.readdirSync(schemaDir)) {
    fs.rmSync(path.join(schemaDir, fn), { recursive: true, force: true });
  }

  console.log(`Dumping ${PG_DATA.database} to ${schemaDir}.`);

  const items = safePsqlSpawn([PG_DATA.url, "-c", "\\d+ webknossos.*"]).trimEnd();
  for (const block of items.split("\n\n")) {
    const [type, identifier] = block
      .split("\n")[0]
      .trim()
      .split('"')
      .map((s) => s.trim().replace(/"/g, "").replace(/ /g, ""));
    console.log(type, identifier);
    fs.mkdirSync(path.join(schemaDir, type), { recursive: true });
    fs.writeFileSync(path.join(schemaDir, type, identifier), block + "\n");
  }

  const functions = safePsqlSpawn([PG_DATA.url, "-c", "\\df+ webknossos.*"]);
  fs.writeFileSync(path.join(schemaDir, "Functions"), functions);

  const schemaVersion = callPsql("SELECT schemaVersion FROM webknossos.releaseInformation;");
  fs.writeFileSync(path.join(schemaDir, "schemaVersion"), schemaVersion);
}

function applyEvolutions() {
  const schemaVersion = parseInt(
    callPsql("SELECT schemaVersion FROM webknossos.releaseInformation;").trim(),
    10,
  );
  if (isNaN(schemaVersion)) {
    console.error("Error: Schema version is not a number");
    process.exit(1);
  }
  console.log(`Schema version: ${schemaVersion}`);

  // get list of evolutions to apply
  const evolutions = fs
    .readdirSync(evolutionsPath)
    .filter((filename) => filename.endsWith(".sql"))
    .map((filename) => {
      const num = parseInt(filename.split("-")[0], 10);
      return [num, filename];
    })
    .filter(([num]) => num > schemaVersion)
    .sort((a, b) => a[0] - b[0]);

  // apply evolutions
  if (evolutions.length > 0) {
    for (const [evolutionFilename] of evolutions) {
      console.log(`Applying evolution: ${evolutionFilename}`);
      safePsqlSpawn(["-v", "ON_ERROR_STOP=ON", "-q", path.join(evolutionsPath, evolutionFilename)]);
    }
    console.log(`Successfully applied the evolutions after ${schemaVersion}`);
  } else {
    console.log("There are no evolutions that can be applied.");
  }
}

function assertUniqueEvolutionNumbers() {
  const groupedEvolutions = new Map();
  for (const filename of fs.readdirSync(evolutionsPath)) {
    const num = parseInt(filename.split("-")[0], 10);
    if (groupedEvolutions.has(num)) {
      groupedEvolutions.get(num).push(filename);
    } else {
      groupedEvolutions.set(num, [filename]);
    }
  }

  if (Array.from(groupedEvolutions.values).some((group) => group.length > 1)) {
    console.log("Duplicate evolutions found:");
    for (const [num, filenames] of groupedEvolutions.entries()) {
      if (filenames.length > 1) {
        console.log(num, filenames);
      }
    }

    process.exit(1);
  }
  console.log("All evolution numbers are unique");
}

function dumpSqlFileSchema() {
  const tmpdb = initTmpDB();
  const dbName = tmpdb[0];
  const dbHost = tmpdb[1];
  const postgresUrl = tmpdb[2];

  console.log("Creating DB " + dbName);
  execSync("psql -U postgres -h " + dbHost + " -c 'CREATE DATABASE " + dbName + ";'", {
    env: envWithPostgresPassword,
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
      env: envWithPostgresPassword,
    });
  }
}

function diffSchemaDb() {
  const dbDumpDir = fs.mkdtempSync();
  try {
    dumpSchema(dbDumpDir);
  } finally {
    console.log("CLEANUP: remove " + tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

program.name("database-tool").description("Tool for managing the WEBKNOSSOS database");

program
  .command("drop-db")
  .description("Drop the current database")
  .action(() => {
    dropDb();
  });

program
  .command("refresh-db")
  .description("Drop the current database and initializes a new one")
  .action(() => {
    refreshDb();
  });

program
  .command("ensure-db")
  .description("Make sure that database is initialized, creates one if necessary")
  .action(() => {
    ensureDb();
  });

program
  .command("prepare-test-db")
  .description("Sets up database for testing")
  .action(() => {
    prepareTestDb();
  });

program
  .command("refresh-schema")
  .description("Drop the current schema and initializes a new one")
  .action(() => {
    refreshSchema();
  });

program
  .command("enable-jobs")
  .description("Activates jobs in WEBKNOSSOS by registering a worker")
  .action(() => {
    console.log("Enabling jobs in the local database by inserting a worker.");
    callPsql(
      `INSERT INTO webknossos.workers(_id, _dataStore, key) VALUES('6194dc03040200b0027f28a1', 'localhost', 'secretWorkerKey') ON CONFLICT DO NOTHING;`,
    );
  });

program
  .command("disable-jobs")
  .description("Deactivates jobs in WEBKNOSSOS by unregistering a worker")
  .action(() => {
    console.log(
      "Disabling jobs in the local database by removing the worker. If existing jobs prevent the delete, use yarn refresh-schema to reset the db or remove the existing jobs manually.",
    );
    callPsql(`DELETE FROM webknossos.workers WHERE _id = '6194dc03040200b0027f28a1';`);
  });

program
  .command("dump-schema <schemaDir>")
  .description("Dumps current schema into a folder")
  .action((schemaDir) => {
    dumpSchema(schemaDir);
  });

program
  .command("diff-schema-db")
  .description("Compares the schema of SQL files against the database")
  .action(() => {
    diffSchemaDb();
  });

program
  .command("diff-schema-evolutions")
  .description("Compares the schema of SQL files against the evolutions")
  .action(() => {
    diffSchemaEvolutions();
  });

program
  .command("apply-evolutions")
  .description("Applies all necessary evolutions")
  .action(() => {
    applyEvolutions();
  });

program
  .command("assert-unique-evolution-numbers")
  .description("Checks that all evolution numbers are unique")
  .action(() => {
    assertUniqueEvolutionNumbers();
  });

program.showHelpAfterError();
program.parse(process.argv);
