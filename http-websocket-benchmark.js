import { WebSocketServer } from "ws";
import http2 from "node:http2";
import fs from "node:fs";
import url from "node:url";

// --- CONFIG ---
const PORT = 8888;

// --- CREATE HTTP/2 SERVER ---
const server = http2.createSecureServer({
  key: fs.readFileSync("bench-dev.key.pem"),
  cert: fs.readFileSync("bench-dev.cert.pem"),
  allowHTTP1: true, // important for fetch()
});

// --- FRONTEND HTML ---
const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Network Benchmark</title>
  <style>
    body { font-family: sans-serif; padding: 2em; }
    label { display: block; margin-top: 1em; }
    button { margin-top: 1em; padding: 0.5em 1em; }
    #output { margin-top: 2em; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Network Benchmark</h1>

  <label>
    Protocol:
    <select id="protocol">
      <option>HTTP</option>
      <option>WebSocket</option>
    </select>
  </label>

  <label>
    Chunk size (KB):
    <input id="chunkSize" type="number" value="32" min="1" max="1024" />
  </label>

  <label>
    Batch size (1–20):
    <input id="batchSize" type="number" value="1" min="1" max="20" />
  </label>

  <label>
    Parallelization degree:
    <input id="parallel" type="number" value="4" min="1" max="100" />
  </label>

  <button id="run">Run Benchmark (10s)</button>

  <div id="output"></div>

  <script>
    const runBtn = document.getElementById('run');
    const out = document.getElementById('output');

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    async function runHTTP(batchSize, chunkSize, parallel) {
      let count = 0;
      const endTime = Date.now() + 5000;
      const url = () => \`/data?batchSize=\${batchSize}&chunkSize=\${chunkSize}\`;

      async function worker() {
        while (Date.now() < endTime) {
          await fetch(url()).then(r => r.arrayBuffer());
          count += batchSize;
        }
      }

      await Promise.all(Array.from({ length: parallel }, worker));
      return count;
    }

    async function runWS(batchSize, chunkSize, parallel) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(\`wss://\${location.host}/ws\`);
        ws.binaryType = "arraybuffer";

        let count = 0;
        const endTime = Date.now() + 5000;
        let active = 0;

        ws.onopen = () => {
          for (let i = 0; i < parallel; i++) sendReq();
        };

        ws.onmessage = () => {
          --active;
          count += batchSize;
          if (Date.now() < endTime) {
            sendReq();
          } else if (active === 0) {
            ws.close();
            resolve(count);
          }
        };

        function sendReq() {
          active++;
          ws.send(JSON.stringify({ batchSize, chunkSize }));
        }

        ws.onerror = reject;
      });
    }

    runBtn.onclick = async () => {
      const proto = document.getElementById('protocol').value;
      const batchSize = +document.getElementById('batchSize').value;
      const chunkSize = +document.getElementById('chunkSize').value;
      const parallel = +document.getElementById('parallel').value;

      out.textContent = 'Running...';
      const start = performance.now();
      let count;
      try {
        count = proto === 'HTTP'
          ? await runHTTP(batchSize, chunkSize, parallel)
          : await runWS(batchSize, chunkSize, parallel);
      } catch (err) {
        out.textContent = 'Error: ' + err;
        return;
      }
      const secs = (performance.now() - start) / 1000;
      const totalBytes = count * chunkSize * 1024;
      const mbps = (totalBytes / secs / (1024 * 1024)).toFixed(2);
      out.textContent =
        \`Downloaded \${count} buckets in \${secs.toFixed(2)}s (≈ \${mbps} MB/s)\`;
    };
  </script>
</body>
</html>`;

// --- RAW HTTP HANDLER (no Express) ---
server.on("request", (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  if (parsed.pathname === "/data") {
    const batchSize = parseInt(parsed.query.batchSize || "1", 10);
    const chunkSizeKB = parseInt(parsed.query.chunkSize || "32", 10);
    const totalBytes = batchSize * chunkSizeKB * 1024;

    const buf = Buffer.alloc(totalBytes);

    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(buf);
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    try {
      const { batchSize = 1, chunkSize = 32 } = JSON.parse(msg.toString());
      const totalBytes = batchSize * chunkSize * 1024;
      const buf = Buffer.alloc(totalBytes);
      ws.send(buf);
    } catch (e) {
      console.error("Bad WS message:", e);
    }
  });
});

// --- START SERVER ---
server.listen(PORT, () => console.log(`Benchmark server running at https://localhost:${PORT}`));
