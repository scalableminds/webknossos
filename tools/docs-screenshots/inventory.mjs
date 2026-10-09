import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const inventory = JSON.parse(
  await readFile(new URL("./assets.json", import.meta.url), "utf8"),
);
const imageExtension = /\.(?:png|jpe?g|gif|svg|webp|avif)$/i;
const slash = (value) => value.split(path.sep).join("/");

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(filename) : [filename];
    }),
  );
  return nested.flat();
}

/** Extract inline, reference-style Markdown, and HTML image URLs. */
export function imageReferences(source) {
  // Code examples should not create missing-image errors.
  const text = source
    .replace(/^\s*(```|~~~)[\s\S]*?^\s*\1[^\n]*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const definitions = new Map(
    [...text.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)].map((match) => [
      match[1].trim().toLowerCase(),
      match[2] ?? match[3],
    ]),
  );
  const references = [];
  for (const match of text.matchAll(
    /!\[([^\]]*)\](?:\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][\s\S]*?["'])?\s*\)|\[([^\]]*)\])?/g,
  )) {
    const reference =
      match[2] ?? match[3] ?? definitions.get((match[4] || match[1]).trim().toLowerCase());
    if (reference) references.push(reference);
  }
  for (const match of text.matchAll(
    /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
  )) {
    references.push(match[1] ?? match[2] ?? match[3]);
  }
  return references;
}

/** Includes unreferenced assets so old screenshots cannot silently escape coverage. */
export async function scanDocumentation(root = repositoryRoot) {
  const files = await filesUnder(path.join(root, "docs"));
  const assets = files
    .filter((filename) => imageExtension.test(filename))
    .map((filename) => slash(path.relative(root, filename)))
    .sort();
  const references = [];
  for (const filename of files.filter((name) => /\.(?:md|mdx|html)$/i.test(name))) {
    for (const url of imageReferences(await readFile(filename, "utf8"))) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
      let decoded;
      try {
        decoded = decodeURIComponent(url.split(/[?#]/)[0]);
      } catch {
        decoded = url;
      }
      if (!imageExtension.test(decoded)) continue;
      const absolute = decoded.startsWith("/")
        ? path.join(root, "docs", decoded.slice(1))
        : path.resolve(path.dirname(filename), decoded);
      references.push({
        source: slash(path.relative(root, filename)),
        path: slash(path.relative(root, absolute)),
      });
    }
  }
  return { assets, references };
}

/** Recipes must expose output (repository-relative docs image path). */
export async function checkCoverage(recipes, { root = repositoryRoot, catalog = inventory } = {}) {
  const { assets, references } = await scanDocumentation(root);
  const errors = [];
  const actual = new Set(assets);
  const classified = new Map();
  for (const asset of catalog) {
    if (classified.has(asset.path)) errors.push(`Duplicate inventory entry: ${asset.path}`);
    classified.set(asset.path, asset);
    if (!actual.has(asset.path)) errors.push(`Inventory asset does not exist: ${asset.path}`);
    if (!["screenshot", "static", "animation"].includes(asset.kind))
      errors.push(`Invalid asset kind: ${asset.path}`);
    if (asset.kind !== "screenshot" && !asset.reason?.trim())
      errors.push(`Exclusion needs a reason: ${asset.path}`);
  }
  for (const asset of assets)
    if (!classified.has(asset)) errors.push(`Unclassified image: ${asset}`);
  for (const reference of references)
    if (!actual.has(reference.path))
      errors.push(`Missing image ${reference.path} referenced by ${reference.source}`);
  const outputs = new Set();
  for (const recipe of recipes) {
    if (outputs.has(recipe.output)) errors.push(`Duplicate recipe output: ${recipe.output}`);
    outputs.add(recipe.output);
    if (classified.get(recipe.output)?.kind !== "screenshot")
      errors.push(`Recipe output is not a cataloged screenshot: ${recipe.output}`);
  }
  for (const asset of catalog)
    if (asset.kind === "screenshot" && !outputs.has(asset.path))
      errors.push(`Screenshot has no recipe: ${asset.path}`);
  return {
    errors: [...new Set(errors)],
    assets,
    references,
    screenshots: catalog.filter((asset) => asset.kind === "screenshot"),
    excluded: catalog.filter((asset) => asset.kind !== "screenshot"),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [{ recipes: viewerRecipes }, { recipes: adminRecipes }] = await Promise.all([
    import("./viewer.mjs"),
    import("./admin.mjs"),
  ]);
  const result = await checkCoverage([...viewerRecipes, ...adminRecipes]);
  console.log(
    `${result.assets.length} documentation images: ${result.screenshots.length} screenshots, ${result.excluded.length} explained static/animation exclusions.`,
  );
  for (const excluded of result.excluded)
    console.log(`Excluded ${excluded.kind}: ${excluded.path} — ${excluded.reason}`);
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Every screenshot has exactly one recipe; all local image references resolve.");
  }
}
