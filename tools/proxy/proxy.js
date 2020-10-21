// @noflow
const express = require("express");
const httpProxy = require("http-proxy");
const { spawn } = require("child_process");
const path = require("path");
const prefixLines = require("prefix-stream-lines");

const proxy = httpProxy.createProxyServer();
const app = express();

const ROOT = path.resolve(path.join(__dirname, "..", ".."));
const PORT = parseInt(process.env.PORT || 9000, 10);
const HOST = `http://localhost:${PORT}`;

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
    'sbt "run 9001" -jvm-debug 5005 -J-XX:MaxMetaspaceSize=2048m -J-Xmx8g',
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
  if (!process.argv.includes(keyword)) return spawn(command, args, options);
  else return null;
}

function killAll() {
  for (const proc of Object.values(processes).filter(x => x)) {
    if (proc.connected) {
      proc.kill("SIGKILL");
    }
  }
}

for (const [key, proc] of Object.entries(processes).filter(x => x[1] !== null)) {
  proc.stdout.pipe(prefixLines(`${key}: `)).pipe(process.stdout);
  proc.stderr.pipe(prefixLines(`${key}: `)).pipe(process.stderr);
  proc.on("error", err => console.error(err, err.stack));
  proc.on("exit", killAll);
}
process.on("SIGTERM", killAll);

proxy.on("error", (err, req, res) => {
  console.error("### Sending Bad gateway due to the following error: ", err);
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
console.log("PROXY", "Listening on", PORT);
