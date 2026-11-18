import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
export function imagePath(root, relative) {
  if (!/^docs\/.+\.(png|jpe?g)$/i.test(relative) || relative.split("/").includes(".."))
    throw new Error(`Unsafe screenshot path: ${relative}`);
  return path.join(root, relative);
}
// The review directory keeps all images of one kind (old, new, excluded) in a single flat
// folder, regardless of their docs subdirectory. Filenames are unique across the docs.
export function reviewPath(base, relative) {
  return path.join(base, path.basename(relative));
}
// Reviews captured before the flat layout keep images under their docs path.
async function readCapture(output, relative) {
  const candidates = [
    reviewPath(path.join(output, "new"), relative),
    imagePath(path.join(output, "new"), relative),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    `Missing capture of ${relative} in ${path.join(output, "new")}; capture it again before applying.`,
  );
}
export async function applyReport(root, output, recipes) {
  const report = JSON.parse(await fs.readFile(path.join(output, "report.json"), "utf8"));
  const allowed = new Set(recipes.map((recipe) => recipe.output));
  const writes = [];
  for (const entry of report.results) {
    if (entry.status !== "success") continue;
    if (!allowed.has(entry.output)) throw new Error(`Unknown recipe output: ${entry.output}`);
    const target = imagePath(root, entry.output);
    const bytes = await readCapture(output, entry.output);
    if (digest(bytes) !== entry.sha256)
      throw new Error(
        `Generated image changed: ${entry.output} doesn't match report.json; capture it again before applying.`,
      );
    if (digest(await fs.readFile(target)) !== entry.previousSha256)
      throw new Error(
        `Docs image changed since capture: ${entry.output}; regenerate before applying.`,
      );
    writes.push({ target, bytes });
  }
  for (const { target, bytes } of writes) await fs.writeFile(target, bytes);
  return writes.length;
}
// Images are compared as decoded RGBA pixels ({ width, height, data }). The per-pixel color
// threshold absorbs JPEG re-encoding noise; the returned ratio is the share of differing pixels.
// Images of different size count as entirely changed and get no diff image.
export function diffImages(before, after) {
  if (before.width !== after.width || before.height !== after.height) return { ratio: 1 };
  const diff = new PNG({ width: after.width, height: after.height });
  const pixels = pixelmatch(before.data, after.data, diff.data, after.width, after.height, {
    threshold: 0.1,
  });
  return { ratio: pixels / (after.width * after.height), image: PNG.sync.write(diff) };
}
export const isChanged = (entry, threshold) =>
  entry.status === "success" && (entry.diffRatio === undefined || entry.diffRatio >= threshold);
const formatPercent = (ratio) => `${Number((ratio * 100).toFixed(1))} %`;
export async function writeReport(output, report) {
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  const threshold = report.diffThreshold ?? 0;
  const cards = report.results
    .map(
      (entry) =>
        `<article data-status="${escapeHtml(entry.status)}"${isChanged(entry, threshold) ? " data-changed" : ""}><h2>${escapeHtml(entry.id)}</h2><p>${escapeHtml(entry.output)} — ${escapeHtml(entry.status)}${entry.diffRatio === undefined ? "" : ` · ${formatPercent(entry.diffRatio)} of pixels changed`}</p>${entry.status === "success" ? `<div class="pair"><figure><figcaption>Before</figcaption><img loading="lazy" src="old/${escapeHtml(path.basename(entry.output))}"></figure><figure><figcaption>After</figcaption><img loading="lazy" src="new/${escapeHtml(path.basename(entry.output))}"></figure></div>${entry.diffImage ? `<details><summary>Changed pixels</summary><img loading="lazy" src="${escapeHtml(entry.diffImage)}"></details>` : ""}` : `<pre>${escapeHtml(entry.error)}</pre>${entry.failureImage ? `<a href="${escapeHtml(entry.failureImage)}">Failed page screenshot</a>` : ""}${entry.trace ? `<p><a href="${escapeHtml(entry.trace)}">Playwright trace</a></p>` : ""}<details><summary>Diagnostics</summary><pre>${escapeHtml(JSON.stringify({ details: entry.details, browserErrors: entry.browserErrors, consoleErrors: entry.consoleErrors, requestErrors: entry.requestErrors }, null, 2))}</pre></details>`}</article>`,
    )
    .join("\n");
  const excluded = report.excluded ?? [];
  const excludedCards = excluded
    .map(
      (asset) =>
        `<article data-status="excluded"><h2>${escapeHtml(asset.path)}</h2><p>excluded ${escapeHtml(asset.kind)} — ${escapeHtml(asset.reason)}</p><img class="thumbnail" src="excluded/${escapeHtml(path.basename(asset.path))}"></article>`,
    )
    .join("\n");
  const succeeded = report.results.filter((entry) => entry.status === "success").length;
  const failed = report.results.length - succeeded;
  const changed = report.results.filter((entry) => isChanged(entry, threshold)).length;
  // Filtering is CSS-only (radio buttons + :has()), so the review page contains no scripts.
  const filter = (value, label, checked = false) =>
    `<label><input type="radio" name="filter" value="${value}"${checked ? " checked" : ""}> ${label}</label>`;
  await fs.writeFile(
    path.join(output, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Docs screenshot review</title><style>body{font:16px system-ui;margin:32px;background:#f5f5f5}header{position:sticky;top:0;z-index:1;background:#f5f5f5;padding:8px 0;border-bottom:1px solid #ddd}.summary{display:flex;flex-wrap:wrap;gap:24px;align-items:center}.count{font-weight:600}.success{color:#1a7f37}.failed{color:#a00}label{cursor:pointer}body:has(input[value=success]:checked) article:not([data-status=success]),body:has(input[value=failed]:checked) article:not([data-status=failed]),body:has(input[value=excluded]:checked) article:not([data-status=excluded]),body:has(input[value=changed]:checked) article:not([data-changed]){display:none}.changed{color:#0958d9}details{margin-top:12px}.excluded{color:#8a6d00}.thumbnail{max-width:480px;max-height:320px}article{background:white;padding:20px;margin:20px 0}.pair{display:flex;gap:16px}figure{margin:0;min-width:0;flex:1}img{max-width:100%;border:1px solid #ddd}pre{white-space:pre-wrap;color:#a00}</style><header><h1>Docs screenshot review</h1><p>${escapeHtml(report.baseUrl)} · ${escapeHtml(report.createdAt)}</p><div class="summary"><span class="count">${report.results.length} captured</span><span class="count success">${succeeded} succeeded</span><span class="count changed">${changed} changed (≥ ${formatPercent(threshold)})</span><span class="count failed">${failed} failed</span><span class="count excluded">${excluded.length} excluded</span><span>${filter("all", "All", true)} ${filter("success", "Succeeded")} ${filter("changed", "Changed")} ${filter("failed", "Failed")} ${filter("excluded", "Excluded")}</span></div></header>${cards}${excludedCards}`,
  );
}
