import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkCoverage, imageReferences, inventory, scanDocumentation } from "./inventory.mjs";

test("reads Markdown and HTML images, excluding code and remote links during scanning", () => {
  assert.deepEqual(
    imageReferences(`
![inline](./one.png "Caption")
![space](<./two words.png>)
![reference][other]
![implicit][]
[other]: ./three.jpg
[implicit]: ./four.png
<img alt="HTML" src='./five.jpeg'>
<!-- ![ignored](comment.png) -->
\`\`\`markdown
![ignored](example.png)
\`\`\`
`),
    ["./one.png", "./two words.png", "./three.jpg", "./four.png", "./five.jpeg"],
  );
});

test("coverage detects unreferenced assets, missing images, duplicates and missing recipes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "docs-image-inventory-"));
  await mkdir(path.join(root, "docs", "nested"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "docs", "one.png"), ""),
    writeFile(path.join(root, "docs", "orphan.jpg"), ""),
    writeFile(
      path.join(root, "docs", "nested", "page.md"),
      `![one](../one.png?x=1) ![bad](missing.png) ![remote](https://example.org/a.png)`,
    ),
  ]);
  const result = await checkCoverage([{ output: "docs/one.png" }, { output: "docs/one.png" }], {
    root,
    catalog: [
      { path: "docs/one.png", kind: "screenshot" },
      { path: "docs/gone.png", kind: "screenshot" },
    ],
  });
  assert(result.errors.some((error) => error.includes("Unclassified image: docs/orphan.jpg")));
  assert(result.errors.some((error) => error.includes("Missing image docs/nested/missing.png")));
  assert(result.errors.some((error) => error.includes("Duplicate recipe output")));
  assert(result.errors.some((error) => error.includes("Screenshot has no recipe: docs/gone.png")));
  assert.equal(result.references.length, 2);
});

test("every repository image has an explicit classification and exclusions explain why", async () => {
  const { assets } = await scanDocumentation();
  assert.deepEqual(inventory.map((asset) => asset.path).sort(), assets);
  assert(inventory.every((asset) => asset.kind === "screenshot" || asset.reason?.trim()));
});
