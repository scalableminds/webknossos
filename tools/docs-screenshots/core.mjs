import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
export async function applyReport(root, output, recipes) {
  const report = JSON.parse(await fs.readFile(path.join(output, "report.json"), "utf8"));
  const allowed = new Set(recipes.map((recipe) => recipe.output));
  const writes = [];
  for (const entry of report.results) {
    if (entry.status !== "success") continue;
    if (!allowed.has(entry.output)) throw new Error(`Unknown recipe output: ${entry.output}`);
    const target = imagePath(root, entry.output);
    const bytes = await fs.readFile(imagePath(path.join(output, "new"), entry.output));
    if (digest(bytes) !== entry.sha256) throw new Error(`Generated image changed: ${entry.output}`);
    if (digest(await fs.readFile(target)) !== entry.previousSha256)
      throw new Error(
        `Docs image changed since capture: ${entry.output}; regenerate before applying.`,
      );
    writes.push({ target, bytes });
  }
  for (const { target, bytes } of writes) await fs.writeFile(target, bytes);
  return writes.length;
}
export async function writeReport(output, report) {
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  const cards = report.results
    .map(
      (entry) =>
        `<article data-status="${escapeHtml(entry.status)}"><h2>${escapeHtml(entry.id)}</h2><p>${escapeHtml(entry.output)} — ${escapeHtml(entry.status)}</p>${entry.status === "success" ? `<div class="pair"><figure><figcaption>Before</figcaption><img src="old/${escapeHtml(entry.output)}"></figure><figure><figcaption>After</figcaption><img src="new/${escapeHtml(entry.output)}"></figure></div>` : `<pre>${escapeHtml(entry.error)}</pre>${entry.failureImage ? `<a href="${escapeHtml(entry.failureImage)}">Failed page screenshot</a>` : ""}${entry.trace ? `<p><a href="${escapeHtml(entry.trace)}">Playwright trace</a></p>` : ""}<details><summary>Diagnostics</summary><pre>${escapeHtml(JSON.stringify({ details: entry.details, browserErrors: entry.browserErrors, consoleErrors: entry.consoleErrors, requestErrors: entry.requestErrors }, null, 2))}</pre></details>`}</article>`,
    )
    .join("\n");
  const excluded = report.excluded ?? [];
  const excludedCards = excluded
    .map(
      (asset) =>
        `<article data-status="excluded"><h2>${escapeHtml(asset.path)}</h2><p>excluded ${escapeHtml(asset.kind)} — ${escapeHtml(asset.reason)}</p><img class="thumbnail" src="excluded/${escapeHtml(asset.path)}"></article>`,
    )
    .join("\n");
  const succeeded = report.results.filter((entry) => entry.status === "success").length;
  const failed = report.results.length - succeeded;
  // Filtering is CSS-only (radio buttons + :has()), so the review page contains no scripts.
  const filter = (value, label, checked = false) =>
    `<label><input type="radio" name="filter" value="${value}"${checked ? " checked" : ""}> ${label}</label>`;
  await fs.writeFile(
    path.join(output, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Docs screenshot review</title><style>body{font:16px system-ui;margin:32px;background:#f5f5f5}header{position:sticky;top:0;z-index:1;background:#f5f5f5;padding:8px 0;border-bottom:1px solid #ddd}.summary{display:flex;flex-wrap:wrap;gap:24px;align-items:center}.count{font-weight:600}.success{color:#1a7f37}.failed{color:#a00}label{cursor:pointer}body:has(input[value=success]:checked) article:not([data-status=success]),body:has(input[value=failed]:checked) article:not([data-status=failed]),body:has(input[value=excluded]:checked) article:not([data-status=excluded]){display:none}.excluded{color:#8a6d00}.thumbnail{max-width:480px;max-height:320px}article{background:white;padding:20px;margin:20px 0}.pair{display:flex;gap:16px}figure{margin:0;min-width:0;flex:1}img{max-width:100%;border:1px solid #ddd}pre{white-space:pre-wrap;color:#a00}</style><header><h1>Docs screenshot review</h1><p>${escapeHtml(report.baseUrl)} · ${escapeHtml(report.createdAt)}</p><div class="summary"><span class="count">${report.results.length} captured</span><span class="count success">${succeeded} succeeded</span><span class="count failed">${failed} failed</span><span class="count excluded">${excluded.length} excluded</span><span>${filter("all", "All", true)} ${filter("success", "Succeeded")} ${filter("failed", "Failed")} ${filter("excluded", "Excluded")}</span></div></header>${cards}${excludedCards}`,
  );
}
