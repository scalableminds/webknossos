const childProcess = require("child_process");

const mongoHost = process.env.MONGO_HOST || "localhost";
const mongoPort = process.env.MONGO_PORT || "27017";
const mongoURL = `${mongoHost}:${mongoPort}`;
const mongoDB = process.env.MONGO_DB || "webknossos-testing";

childProcess.execFileSync("./tools/dropDB.sh", [mongoDB, mongoHost, mongoPort]);
childProcess.execFileSync("./tools/import_export/import.sh", [mongoDB, "test/db", mongoURL], {
  stdio: "ignore",
});
