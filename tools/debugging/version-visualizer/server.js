import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = 9999;

const DATA_DIR = path.join(process.cwd(), "tools", "debugging", "version-visualizer", "data");
const PUBLIC_DIR = path.join(process.cwd(), "tools", "debugging", "version-visualizer", "public");

app.use(express.static(PUBLIC_DIR));

app.get("/versions", (req, res) => {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

  const versions = files
    .map((file) => {
      const json = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
      return json;
    })
    .sort((a, b) => a.version - b.version);

  res.json(versions);
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/creationTime", (req, res) => {
  try {
    
      const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
      if (files.length === 0) {
        return res.status(404).json({ error: "no json files in data directory" });
      }
      const fileName = files[0];

    const filePath = path.join(DATA_DIR, fileName);

    const stat = fs.statSync(filePath);
    const tsMs = stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs;
    const creationTime = new Date(tsMs).toISOString();

    res.json({ creationTime });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Visualizer running at http://localhost:${PORT}`);
});
