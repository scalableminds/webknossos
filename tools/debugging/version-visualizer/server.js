import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = 9999;

const DATA_DIR = path.join(process.cwd(), "data");
const PUBLIC_DIR = path.join(process.cwd(), "public");

app.use(express.static(PUBLIC_DIR));

app.get("/versions", (req, res) => {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter(f => f.endsWith(".json"));

  const versions = files
    .map(file => {
      const json = JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, file), "utf8")
      );
      return json;
    })
    .sort((a, b) => a.version - b.version);

  res.json(versions);
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Visualizer running at http://localhost:${PORT}`);
});
