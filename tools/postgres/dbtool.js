#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { Command } = require("commander");

const repoRootPath = path.resolve(path.join(__dirname, "..", ".."));
const schemaPath = path.join(repoRootPath, "schema", "schema.sql");
const evolutionsPath = path.join(repoRootPath, "schema", "evolutions");
const SCHEMA_DUMP_CACHE_DIR = path.join(repoRootPath, "target", "db-schema-dump");
const SCHEMA_DUMP_CACHE_HASH_FILE = path.join(SCHEMA_DUMP_CACHE_DIR, ".schema-hash");

const PG_CONFIG = (() => {
  let rawUrl = process.env.POSTGRES_URL || "postgres://postgres:postgres@127.0.0.1:5432/webknossos";
  if (rawUrl.startsWith("jdbc:")) {
    rawUrl = rawUrl.substring(5);
  }
  const url = new URL(rawUrl);
  url.username = url.username
    ? url.username
    : (process.env.POSTGRES_USER ?? process.env.PGUSER ?? "postgres");
  url.password = url.password
    ? url.password
    : (process.env.POSTGRES_PASSWORD ?? process.env.PGPASSWORD ?? "postgres");
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

// Order matters: ForeignKey constraints require parent tables before child tables.
// E.g. user_dataSetConfigurations references users and datasets, so users must be imported first.
// session_replication_role = replica (set below per-file) should bypass FK triggers,
// but requires superuser/replication privileges which may not be available.
const TEST_CSV_IMPORT_ORDER = [
  "multiusers.csv",             // no deps
  "tracingStores.csv",          // no deps
  "dataStores.csv",             // no deps
  "folders.csv",                // no deps
  "organizations.csv",          // → folders
  "teams.csv",                  // → organizations
  "users.csv",                  // → multiusers, organizations
  "folder_paths.csv",           // → folders
  "datasets.csv",               // → organizations, dataStores, users, folders
  "dataset_layers.csv",         // → datasets
  "dataset_mags.csv",           // → datasets
  "dataset_allowedTeams.csv",   // → datasets, teams
  "scripts.csv",                // → users
  "taskTypes.csv",              // → teams, organizations
  "projects.csv",               // → teams, users, organizations
  "tasks.csv",                  // → projects, scripts, taskTypes
  "annotations.csv",            // → datasets, tasks, teams, users
  "annotation_layers.csv",      // → annotations
  "user_team_roles.csv",        // → users, teams
  "user_datasetConfigurations.csv", // → users, datasets
  "user_datasetLayerConfigurations.csv", // → user_dataset, dataset_layer
  "user_experiences.csv",       // → users
  "timeSpans.csv",              // → users, annotations
  "tokens.csv",                 // no strict FK, but after users
];

function importTestCsvFiles() {
  const csvFolder = path.join(__dirname, "..", "..", "test", "db");
  const allCsvFiles = new Set(fs.readdirSync(csvFolder).filter((f) => f.endsWith(".csv")));
  const unknownFiles = [...allCsvFiles].filter((f) => !TEST_CSV_IMPORT_ORDER.includes(f));
  if (unknownFiles.length > 0) {
    throw new Error(
      `Some test DB CSV files are not listed in TEST_CSV_IMPORT_ORDER (add them in ForeignKey dependency order):\n${unknownFiles.join("\n")}`,
    );
  }

  for (const filename of TEST_CSV_IMPORT_ORDER) {
    if (!allCsvFiles.has(filename)) continue;
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

function prepareTestDb() {
  ensureDb();
  refreshSchema();
  importTestCsvFiles();
  console.log("✨✨ Done preparing test database");
}

function prepareTestDbWithoutSchemaRefresh() {
  ensureDb();
  callPsql(`
    DO $$ BEGIN
      EXECUTE (
        SELECT 'TRUNCATE TABLE ' || string_agg('webknossos.' || quote_ident(tablename), ', ') || ' CASCADE'
        FROM pg_tables
        WHERE schemaname = 'webknossos' AND tablename != 'releaseinformation'
      );
    END $$;
  `);
  importTestCsvFiles();
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

  let t = Date.now();
  const items = safePsqlSpawn([databaseUrl, "-c", "\\d+ webknossos.*"]).trimEnd();
  console.error(`[timing] \\d+ psql call: ${Date.now() - t}ms`);

  t = Date.now();
  for (const block of items.split("\n\n")) {
    const [type, identifier] = block
      .split("\n")[0]
      .trim()
      .split('"')
      .map((s) => s.trim().replace(/"/g, "").replace(/ /g, ""));
    if (!silent) console.log(type, identifier);
    fs.writeFileSync(path.join(schemaDir, `${type}__${identifier}`), block + "\n");
  }
  console.error(`[timing] \\d+ file write: ${Date.now() - t}ms`);

  t = Date.now();
  const functions = safePsqlSpawn([databaseUrl, "-c", "\\df+ webknossos.*"]);
  console.error(`[timing] \\df+ psql call: ${Date.now() - t}ms`);

  t = Date.now();
  fs.writeFileSync(path.join(schemaDir, "Functions"), functions);
  console.error(`[timing] \\df+ file write: ${Date.now() - t}ms`);

  t = Date.now();
  const schemaVersion = safePsqlSpawn([
    databaseUrl,
    "-tAc",
    "SELECT schemaVersion FROM webknossos.releaseInformation;",
  ]);
  console.error(`[timing] schemaVersion psql call: ${Date.now() - t}ms`);

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
    let t = Date.now();
    // Create tmp database
    safePsqlSpawn([PG_CONFIG.urlWithDefaultDatabase, "-c", `CREATE DATABASE ${tmpDbName}`]);
    console.error(`[timing] CREATE DATABASE: ${Date.now() - t}ms`);

    const urlWithDatabase = new URL(PG_CONFIG.urlWithDefaultDatabase);
    urlWithDatabase.pathname = "/" + tmpDbName;

    t = Date.now();
    // Load schema into tmp database
    safePsqlSpawn([
      urlWithDatabase.toString(),
      "-v",
      "ON_ERROR_STOP=ON",
      "-q",
      ...sqlFilePaths.flatMap((filePath) => ["-f", filePath]),
    ]);
    console.error(`[timing] load schema.sql: ${Date.now() - t}ms`);

    // Dump schema into diffable files
    dumpCurrentSchema(urlWithDatabase.toString(), tmpSchemaDir, true);
    return tmpSchemaDir;
  } finally {
    const t = Date.now();
    safePsqlSpawn([PG_CONFIG.urlWithDefaultDatabase, "-c", `DROP DATABASE ${tmpDbName}`]);
    console.error(`[timing] DROP DATABASE: ${Date.now() - t}ms`);
  }
}

function getCachedExpectedSchemaDump() {
  const currentHash = crypto.createHash("md5").update(fs.readFileSync(schemaPath)).digest("hex");

  if (fs.existsSync(SCHEMA_DUMP_CACHE_HASH_FILE)) {
    const cachedHash = fs.readFileSync(SCHEMA_DUMP_CACHE_HASH_FILE, { encoding: "utf-8" }).trim();
    if (cachedHash === currentHash) {
      console.error("[timing] expected schema dump: cache hit");
      return SCHEMA_DUMP_CACHE_DIR;
    }
  }

  console.error("[timing] expected schema dump: cache miss, regenerating");
  const tmpDir = dumpExpectedSchema([schemaPath]);
  cleanSchemaDump(tmpDir);

  if (fs.existsSync(SCHEMA_DUMP_CACHE_DIR)) {
    fs.rmSync(SCHEMA_DUMP_CACHE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(SCHEMA_DUMP_CACHE_DIR, { recursive: true });
  for (const filename of fs.readdirSync(tmpDir)) {
    fs.copyFileSync(path.join(tmpDir, filename), path.join(SCHEMA_DUMP_CACHE_DIR, filename));
  }
  fs.writeFileSync(SCHEMA_DUMP_CACHE_HASH_FILE, currentHash);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return SCHEMA_DUMP_CACHE_DIR;
}

function checkDbSchema() {
  const total = Date.now();
  const dbDumpDir = fs.mkdtempSync("temp-webknossos-schema-");
  try {
    console.error("[timing] --- dumpCurrentSchema (live db) ---");
    let t = Date.now();
    dumpCurrentSchema(PG_CONFIG.url, dbDumpDir, true);
    console.error(`[timing] dumpCurrentSchema total: ${Date.now() - t}ms`);

    t = Date.now();
    cleanSchemaDump(dbDumpDir);
    console.error(`[timing] cleanSchemaDump (live db): ${Date.now() - t}ms`);

    console.error("[timing] --- expected schema dump ---");
    t = Date.now();
    const schemaDumpDir = getCachedExpectedSchemaDump();
    console.error(`[timing] getCachedExpectedSchemaDump: ${Date.now() - t}ms`);

    t = Date.now();
    try {
      safeSpawn("diff", ["--strip-trailing-cr", "-r", dbDumpDir, schemaDumpDir]);
    } catch (err) {
      throw new Error(`Database schema is not up-to-date:\n${err.stdout}`);
    }
    console.error(`[timing] diff: ${Date.now() - t}ms`);
  } finally {
    if (fs.existsSync(dbDumpDir)) {
      fs.rmSync(dbDumpDir, { recursive: true, force: true });
    }
  }
  console.error(`[timing] checkDbSchema total: ${Date.now() - total}ms`);
  console.log("✨✨ Database schema is up-to-date");
}

function findEvolutionFiles() {
  return fs
    .readdirSync(evolutionsPath)
    .filter((filename) => filename.endsWith(".sql"))
    .map((filename) => {
      const num = Number.parseInt(filename.split("-")[0], 10);
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
    for (const evolutionFilename of evolutions) {
      console.log(`Applying evolution: ${evolutionFilename}`);
      safePsqlSpawn([
        PG_CONFIG.url,
        "-v",
        "ON_ERROR_STOP=ON",
        "-f",
        path.join(evolutionsPath, evolutionFilename),
      ]);
    }
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
  .command("prepare-test-db-no-schema-refresh")
  .description("Sets up database for testing without dropping/recreating the schema (truncates all tables instead, avoids postgres cache lookup errors)")
  .action(() => {
    prepareTestDbWithoutSchemaRefresh();
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
  .description(
    "Inserts local datastore (note that this is redundant to initialData on webknossos startup)",
  )
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
        `INSERT INTO webknossos.workers(_id, _dataStore, key, supportedJobCommands, name) VALUES('6194dc03040200b0027f28a1', 'localhost', 'secretWorkerKey', '{compute_mesh_file, convert_to_wkw, export_tiff, find_largest_segment_id, globalize_floodfills, infer_nuclei, infer_neurons, materialize_volume_annotation, render_animation, compute_segment_index_file, infer_mitochondria, train_neuron_model, train_instance_model, infer_instances, align_sections}', 'Dev Worker') ON CONFLICT (_id) DO UPDATE SET supportedJobCommands = EXCLUDED.supportedJobCommands;`,
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
  .command("enable-storage-scan")
  .description("Activates dataset storage scan in WEBKNOSSOS for the default datastore.")
  .action(() => {
    console.log("Activating dataset storage scan in WEBKNOSSOS for the default datastore...");
    console.log(
      callPsql(
        `UPDATE webknossos.datastores SET reportUsedStorageEnabled = TRUE WHERE name = 'localhost'`,
      ),
    );
    console.log(
      callPsql(
        `UPDATE webknossos.organizations SET lastStorageScanTime = '1970-01-01T00:00:00.000Z' WHERE _id = 'sample_organization'`,
      ),
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
  .command("check-schema-evolutions")
  .description("Compares the schema of SQL files against the evolutions (alias for check-evolutions-schema)")
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
