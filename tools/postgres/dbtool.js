#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { Command } = require("commander");

const schemaPath = path.join(__dirname, "schema.sql");
const evolutionsPath = path.resolve(path.join(__dirname, "..", "..", "conf", "evolutions"));

const PG_CONFIG = (() => {
  let rawUrl = process.env.POSTGRES_URL || "postgres://postgres:postgres@127.0.0.1:5432/webknossos";
  if (rawUrl.startsWith("jdbc:")) {
    rawUrl = rawUrl.substring(5);
  }
  const url = new URL(rawUrl);
  url.username = url.username
    ? url.username
    : process.env.POSTGRES_USER ?? process.env.PGUSER ?? "postgres";
  url.password = url.password
    ? url.password
    : process.env.POSTGRES_PASSWORD ?? process.env.PGPASSWORD ?? "postgres";
  url.port = url.port ? url.port : 5432;

  const urlWithDefaultDatabase = new URL(url);
  urlWithDefaultDatabase.pathname = "/postgres";

  return {
    url: url.toString(),
    urlWithDefaultDatabase: urlWithDefaultDatabase.toString(),
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    port: url.port,
    database:
      url.pathname.length > 1
        ? url.pathname.substring(1) // remove leading '/'`
        : "webknossos",
  };
})();

const program = new Command();

function safeSpawn(command, args, options = {}) {
  const prc = spawnSync(command, args, { ...options, encoding: "utf-8" });
  if (prc.status !== 0) {
    const error = new Error(`Exit code: ${prc.status}\Stderr:\n${prc.stderr}`);
    error.status = prc.status;
    error.stderr = prc.stderr;
    error.stdout = prc.stdout;
    throw error;
  }
  return prc.stdout;
}

function safePsqlSpawn(args, options = {}) {
  try {
    return safeSpawn("psql", args, options);
  } catch (err) {
    throw new Error(`PSQL exit code: ${err.status}\nPSQL stderr:\n${err.stderr}`);
  }
}

function callPsql(sql) {
  return safePsqlSpawn([PG_CONFIG.url, "-tAc", sql]);
}

function dropDb() {
  console.log(
    safePsqlSpawn([PG_CONFIG.urlWithDefaultDatabase, "-c", `DROP DATABASE ${PG_CONFIG.database}`]),
  );
}

function ensureDb() {
  const doesDbExist = safePsqlSpawn([
    PG_CONFIG.urlWithDefaultDatabase,
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname='${PG_CONFIG.database}'`,
  ]).trim();
  if (doesDbExist === "1") {
    console.log("Database already exists");
  } else {
    console.log(
      safePsqlSpawn([
        PG_CONFIG.urlWithDefaultDatabase,
        "-tAc",
        `CREATE DATABASE ${PG_CONFIG.database};`,
      ]),
    );
  }

  const existingSchemaName = callPsql(
    "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'webknossos';",
  ).trim();
  if (existingSchemaName === "webknossos") {
    console.log("Schema already exists");
  } else {
    refreshSchema();
  }
}

function prepareTestDb() {
  ensureDb();
  refreshSchema();

  const csvFolder = path.join(__dirname, "..", "..", "test", "db");
  for (const filename of fs.readdirSync(csvFolder)) {
    if (filename.endsWith(".csv")) {
      console.log(`IMPORT ${filename}`);
      safePsqlSpawn(
        [
          PG_CONFIG.url,
          "-c",
          `SET session_replication_role = replica; COPY webknossos.${filename.slice(
            0,
            -4,
          )} FROM STDOUT WITH CSV HEADER QUOTE ''''`,
        ],
        {
          input: fs.readFileSync(path.join(csvFolder, filename)),
        },
      );
    }
  }
  console.log("✨✨ Done preparing test database");
}

function refreshSchema() {
  console.log(safePsqlSpawn([PG_CONFIG.url, "-v", "ON_ERROR_STOP=ON", "-f", schemaPath]));
}

function dumpCurrentSchema(databaseUrl, schemaDir, silent = false) {
  if (!fs.existsSync(schemaDir) || !fs.statSync(schemaDir).isDirectory) {
    console.error("Schema directory $schemadir does not exist, aborting!");
    process.exit(1);
  }

  for (const filename of fs.readdirSync(schemaDir)) {
    fs.rmSync(path.join(schemaDir, filename), { recursive: true, force: true });
  }

  if (!silent) console.log(`Dumping database to ${schemaDir}.`);

  const items = safePsqlSpawn([databaseUrl, "-c", "\\d+ webknossos.*"]).trimEnd();
  for (const block of items.split("\n\n")) {
    const [type, identifier] = block
      .split("\n")[0]
      .trim()
      .split('"')
      .map((s) => s.trim().replace(/"/g, "").replace(/ /g, ""));
    if (!silent) console.log(type, identifier);
    fs.writeFileSync(path.join(schemaDir, `${type}__${identifier}`), block + "\n");
  }

  const functions = safePsqlSpawn([databaseUrl, "-c", "\\df+ webknossos.*"]);
  fs.writeFileSync(path.join(schemaDir, "Functions"), functions);

  const schemaVersion = safePsqlSpawn([
    databaseUrl,
    "-tAc",
    "SELECT schemaVersion FROM webknossos.releaseInformation;",
  ]);
  fs.writeFileSync(path.join(schemaDir, "schemaVersion"), schemaVersion);
}

function cleanSchemaDump(dumpDir) {
  for (const filename of fs.readdirSync(dumpDir)) {
    fs.writeFileSync(
      path.join(dumpDir, filename),
      fs
        .readFileSync(path.join(dumpDir, filename), { encoding: "utf-8" })
        .replace(/,$/gm, "")
        .replace(/\\r/gm, "  ")
        .split("\n")
        .sort()
        .join("\n"),
    );
  }
}

function dumpExpectedSchema(sqlFilePaths) {
  const tmpDbName = `webknossos_tmp_${Date.now()}`;
  const tmpSchemaDir = fs.mkdtempSync("temp-webknossos-schema-");

  try {
    // Create tmp database
    safePsqlSpawn([PG_CONFIG.urlWithDefaultDatabase, "-c", `CREATE DATABASE ${tmpDbName}`]);

    const urlWithDatabase = new URL(PG_CONFIG.urlWithDefaultDatabase);
    urlWithDatabase.pathname = "/" + tmpDbName;
    // Load schema into tmp database
    safePsqlSpawn([
      urlWithDatabase.toString(),
      "-v",
      "ON_ERROR_STOP=ON",
      "-q",
      ...sqlFilePaths.flatMap((filePath) => ["-f", filePath]),
    ]);

    // Dump schema into diffable files
    dumpCurrentSchema(urlWithDatabase.toString(), tmpSchemaDir, true);
    return tmpSchemaDir;
  } finally {
    safePsqlSpawn([PG_CONFIG.urlWithDefaultDatabase, "-c", `DROP DATABASE ${tmpDbName}`]);
  }
}

function checkDbSchema() {
  const dbDumpDir = fs.mkdtempSync("temp-webknossos-schema-");
  let schemaDumpDir = null;
  try {
    dumpCurrentSchema(PG_CONFIG.url, dbDumpDir, true);
    schemaDumpDir = dumpExpectedSchema([schemaPath]);

    cleanSchemaDump(dbDumpDir);
    cleanSchemaDump(schemaDumpDir);

    try {
      safeSpawn("diff", ["--strip-trailing-cr", "-r", dbDumpDir, schemaDumpDir]);
    } catch (err) {
      throw new Error(`Database schema is not up-to-date:\n${err.stdout}`);
    }
  } finally {
    if (fs.existsSync(dbDumpDir)) {
      fs.rmSync(dbDumpDir, { recursive: true, force: true });
    }
    if (fs.existsSync(schemaDumpDir)) {
      fs.rmSync(schemaDumpDir, { recursive: true, force: true });
    }
  }
  console.log("✨✨ Database schema is up-to-date");
}

function findEvolutionFiles() {
  return fs
    .readdirSync(evolutionsPath)
    .filter((filename) => filename.endsWith(".sql"))
    .map((filename) => {
      const num = Number.Number.parseInt(filename.split("-")[0], 10);
      return [num, filename];
    })
    .sort((a, b) => a[0] - b[0]);
}

function checkEvolutionsSchema() {
  let evolutionsDumpDir = null;
  let schemaDumpDir = null;
  try {
    evolutionsDumpDir = dumpExpectedSchema(
      findEvolutionFiles().map(([, evolutionFilename]) =>
        path.join(evolutionsPath, evolutionFilename),
      ),
    );
    schemaDumpDir = dumpExpectedSchema([schemaPath]);

    cleanSchemaDump(evolutionsDumpDir);
    cleanSchemaDump(schemaDumpDir);

    try {
      safeSpawn("diff", ["--strip-trailing-cr", "-r", evolutionsDumpDir, schemaDumpDir]);
    } catch (err) {
      throw new Error(`Evolutions do not match with schema file:\n${err.stdout}`);
    }
  } finally {
    if (fs.existsSync(evolutionsDumpDir)) {
      fs.rmSync(evolutionsDumpDir, { recursive: true, force: true });
    }
    if (fs.existsSync(schemaDumpDir)) {
      fs.rmSync(schemaDumpDir, { recursive: true, force: true });
    }
  }
  console.log("✨✨ Evolutions match with schema file");
}

function applyEvolutions() {
  const schemaVersion = Number.parseInt(
    callPsql("SELECT schemaVersion FROM webknossos.releaseInformation;").trim(),
    10,
  );
  if (isNaN(schemaVersion)) {
    console.error("Error: Schema version is not a number");
    process.exit(1);
  }
  console.log(`Schema version: ${schemaVersion}`);

  // get list of evolutions to apply
  const evolutions = findEvolutionFiles()
    .filter(([num]) => num > schemaVersion)
    .map(([, evolutionFilename]) => evolutionFilename);

  // apply evolutions
  if (evolutions.length > 0) {
    console.log(`Applying evolutions: ${evolutions}`);
    safePsqlSpawn([
      PG_CONFIG.url,
      "-v",
      "ON_ERROR_STOP=ON",
      "-q",
      ...evolutions.flatMap((evolutionFilename) => [
        "-f",
        path.join(evolutionsPath, evolutionFilename),
      ]),
    ]);
    console.log("✨✨ Successfully applied the evolutions");
  } else {
    console.log("There are no evolutions that can be applied.");
  }
}

function assertUniqueEvolutionNumbers() {
  const groupedEvolutions = new Map();
  for (const filename of fs.readdirSync(evolutionsPath)) {
    const num = Number.parseInt(filename.split("-")[0], 10);
    if (isNaN(num)) {
      console.log("Found invalid evolution filename:", filename);
    }
    if (groupedEvolutions.has(num)) {
      groupedEvolutions.get(num).push(filename);
    } else {
      groupedEvolutions.set(num, [filename]);
    }
  }

  if (Array.from(groupedEvolutions.values()).some((group) => group.length > 1)) {
    console.log("Duplicate evolutions found:");
    for (const [num, filenames] of groupedEvolutions.entries()) {
      if (filenames.length > 1) {
        console.log(num, filenames);
      }
    }

    process.exit(1);
  }
  console.log("✨✨ All evolution numbers are unique");
}

program.name("dbtool").description("Tool for managing the WEBKNOSSOS database");

program
  .command("drop-db")
  .description("Drop the current database")
  .action(() => {
    dropDb();
    console.log("✨✨ Done");
  });

program
  .command("drop-and-refresh-db")
  .description("Drop the current database and initializes a new one")
  .action(() => {
    try {
      dropDb();
    } catch (err) {
      if (!err.message.includes("does not exist")) {
        throw err;
      }
    }
    ensureDb();
    console.log("✨✨ Done");
  });

program
  .command("ensure-db")
  .description("Make sure that database is initialized, creates one if necessary")
  .action(() => {
    ensureDb();
    console.log("✨✨ Done");
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
    console.log("✨✨ Done");
  });

program
  .command("insert-local-datastore")
  .description("Inserts local datastore (note that this is redundant to initialData on webknossos startup)")
  .action(() => {
    console.log("Inserting local datastore in the local database");
    console.log(
      callPsql(
        `INSERT INTO webknossos.dataStores(name, url, publicUrl, key) VALUES('localhost', 'http://localhost:9000', 'http://localhost:9000', 'something-secure') ON CONFLICT DO NOTHING`,
      ),
    );
    console.log("✨✨ Done");
  });

program
  .command("enable-jobs")
  .description("Activates jobs in WEBKNOSSOS by registering a worker")
  .action(() => {
    console.log("Enabling jobs in the local database by inserting a worker.");
    console.log(
      callPsql(
        `INSERT INTO webknossos.workers(_id, _dataStore, key, supportedJobCommands, name) VALUES('6194dc03040200b0027f28a1', 'localhost', 'secretWorkerKey', '{compute_mesh_file, convert_to_wkw, export_tiff, find_largest_segment_id, globalize_floodfills, infer_nuclei, infer_neurons, materialize_volume_annotation, render_animation, compute_segment_index_file, infer_mitochondria, train_model, infer_with_model, align_sections}', 'Dev Worker') ON CONFLICT (_id) DO UPDATE SET supportedJobCommands = EXCLUDED.supportedJobCommands;`,
      ),
    );
    console.log("✨✨ Done");
  });

program
  .command("disable-jobs")
  .description("Deactivates jobs in WEBKNOSSOS by unregistering a worker")
  .action(() => {
    console.log(callPsql(`DELETE FROM webknossos.workers WHERE _id = '6194dc03040200b0027f28a1';`));
    console.log(
      "If existing jobs prevent the delete, use yarn refresh-schema to reset the db or remove the existing jobs manually.",
    );
    console.log("✨✨ Done");
  });

program
  .command("dump-schema <schemaDir>")
  .description("Dumps current schema into a folder")
  .action((schemaDir) => {
    dumpCurrentSchema(PG_CONFIG.url, schemaDir);
    console.log("✨✨ Done");
  });

program
  .command("check-db-schema")
  .description("Compares the schema of SQL files against the database")
  .action(() => {
    try {
      checkDbSchema();
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  });

program
  .command("check-evolutions-schema")
  .description("Compares the schema of SQL files against the evolutions")
  .action(() => {
    checkEvolutionsSchema();
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
