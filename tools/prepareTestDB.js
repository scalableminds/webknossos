const childProcess = require("child_process");

const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/webknossos-testing";

childProcess.execFileSync("./dropDB.sh", [mongoURI]);
childProcess.execFileSync("./import_export/import.sh", [mongoURI, "test/db"], {
  stdio: "ignore",
});
