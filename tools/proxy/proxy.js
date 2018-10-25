const express = require("express");
const httpProxy = require("http-proxy");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const prefixLines = require("prefix-stream-lines");
const url = require("url");

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
  /*backend: spawn("yarn start", [], {
    cwd: ROOT,
    env: makeEnv(9000, HOST),
    shell: true,
  }),*/
};

function killAll() {
  for (const proc of Object.values(processes)) {
    if (proc.connected) {
      proc.kill();
    }
  }
}
for (const [key, proc] of Object.entries(processes)) {
  proc.stdout.pipe(prefixLines(`${key}: `)).pipe(process.stdout);
  proc.stderr.pipe(prefixLines(`${key}: `)).pipe(process.stderr);
  proc.on("error", err => console.error(err, err.stack));
  proc.on("exit", killAll);
}
process.on("SIGTERM", killAll);

proxy.on("error", (err, req, res) => {
  res.writeHead(503);
  res.end("Bad gateway");
});

function toBackend(req, res) {
  proxy.web(req, res, { target: `http://localhost:${PORT + 1}` });
}

function toStaticRessource(req, res) {
  const filepath = path.join(ROOT, "public", url.parse(req.url).pathname);
  res.set({
    "Access-Control-Allow-Origin": "*",
  });
  if (fs.existsSync(filepath)) res.sendFile(filepath);
  else res.status(404).send({ message: "File not found" });
}

function toIndexHtml(req, res) {
  res.sendFile(path.join(ROOT, "public", "bundle", "index.html"));
}

app.get(/^.+\..+$/, toStaticRessource);
app.all("/api/*", toBackend);
app.all("/data/*", toBackend);
app.all("/*", toIndexHtml);

app.listen(PORT);
console.log("PROXY", "Listening on", PORT);
