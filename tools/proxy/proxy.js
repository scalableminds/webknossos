// @noflow
const express = require("express");
const httpProxy = require("http-proxy");
const { spawn, exec } = require("child_process");
const path = require("path");
const prefixLines = require("prefix-stream-lines");

const proxy = httpProxy.createProxyServer({
  proxyTimeout: 5 * 60 * 1000, // 5 min
  timeout: 5 * 60 * 1000, // 5 min
});
const app = express();

const ROOT = path.resolve(path.join(__dirname, "..", ".."));
const PORT = parseInt(process.env.PORT || 9000, 10);
const HOST = `http://localhost:${PORT}`;
const loggingPrefix = "Proxy:";

function makeEnv(port, host) {
  const env = Object.assign({}, process.env);
  env.PORT = port;
  env.HOST = host;
  env.API_HOST = host;
  delete env.PWD;
  return env;
}

const processes = {
  backend: spawnIfNotSpecified(
    "noBackend",
    'sbt "~run 9001" -jvm-debug 5005 -J-XX:MaxMetaspaceSize=2048m -J-Xmx8g -Dlogger.file=conf/logback-dev.xml',
    [],
    {
      cwd: ROOT,
      env: makeEnv(PORT + 1, HOST),
      shell: true,
    },
  ),
  webpackDev: spawnIfNotSpecified("noWebpackDev", "node_modules/.bin/webpack-dev-server", [], {
    cwd: ROOT,
    env: makeEnv(PORT + 2, HOST),
    shell: true,
  }),
  fossildDB: spawnIfNotSpecified(
    "noFossilDB",
    `${ROOT}/fossildb/run.sh > ${ROOT}/fossildb/logs`,
    [],
    {
      cwd: ROOT,
      env: makeEnv(PORT, HOST),
      shell: true,
    },
  ),
};

function spawnIfNotSpecified(keyword, command, args, options) {
  if (!process.argv.includes(keyword)) {
    const childProcess = spawn(command, args, options);
    console.log(
      loggingPrefix,
      "Spawned child process with PID",
      childProcess.pid,
      "for command",
      command,
    );
    return childProcess;
  } else return null;
}

function shutdown() {
  console.log("", loggingPrefix, "Shutting down, terminating child processes...");
  for (const proc of Object.values(processes).filter(x => x)) {
    if (proc.connected) {
      proc.kill("SIGTERM");
    }
  }
  exec("kill $(lsof -t -i:5005)"); // Also kill Java debug subproces, as it’s sometimes not terminated by sbt properly.
  process.exit(0);
}

for (const [key, proc] of Object.entries(processes).filter(x => x[1] !== null)) {
  proc.stdout.pipe(prefixLines(`${key}: `)).pipe(process.stdout);
  proc.stderr.pipe(prefixLines(`${key}: `)).pipe(process.stderr);
  proc.on("error", err => console.error(err, err.stack));
  proc.on("exit", shutdown);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

proxy.on("error", (err, req, res) => {
  console.error(loggingPrefix, "Sending Bad gateway due to the following error: ", err);
  res.writeHead(503);
  res.end("Bad gateway");
});

function toBackend(req, res) {
  proxy.web(req, res, { target: `http://localhost:${PORT + 1}` });
}

function toWebpackDev(req, res) {
  proxy.web(req, res, { target: `http://localhost:${PORT + 2}` });
}

app.all("/assets/bundle/*", toWebpackDev);
app.all("/*", toBackend);

app.listen(PORT);
console.log(loggingPrefix, "Listening on port", PORT);
