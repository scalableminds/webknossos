import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyReport,
  diffImages,
  digest,
  imagePath,
  isChanged,
  reviewPath,
  writeReport,
} from "./core.mjs";

test("rejects paths outside documentation raster images", () => {
  for (const value of ["../image.png", "docs/../../image.png", "docs/x.svg", "/docs/x.png"])
    assert.throws(() => imagePath("/tmp", value));
});

test("apply validates all captures before updating any originals", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wk-docs-screenshots-"));
  const output = path.join(root, "review");
  // Images from different docs directories share one flat review folder.
  const recipes = ["images/a", "automation/images/b"].map((id) => ({
    id,
    output: `docs/${id}.png`,
  }));
  const report = { createdAt: "test", baseUrl: "http://localhost", results: [] };
  for (const recipe of recipes) {
    await fs.mkdir(path.dirname(imagePath(root, recipe.output)), { recursive: true });
    await fs.mkdir(path.join(output, "new"), { recursive: true });
    await fs.writeFile(imagePath(root, recipe.output), "old");
    await fs.writeFile(reviewPath(path.join(output, "new"), recipe.output), "new");
    report.results.push({
      ...recipe,
      status: "success",
      sha256: digest("new"),
      previousSha256: digest("old"),
    });
  }
  await writeReport(output, report);
  await fs.writeFile(imagePath(root, recipes[1].output), "edited");
  await assert.rejects(applyReport(root, output, recipes), /changed since capture/);
  assert.equal(await fs.readFile(imagePath(root, recipes[0].output), "utf8"), "old");
  await fs.writeFile(imagePath(root, recipes[1].output), "old");
  assert.equal(await applyReport(root, output, recipes), 2);
  assert.equal(await fs.readFile(imagePath(root, recipes[0].output), "utf8"), "new");
});

test("review escapes failure text", async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "wk-docs-gallery-"));
  await writeReport(output, {
    baseUrl: "local",
    createdAt: "now",
    results: [
      { id: "bad", output: "docs/x.png", status: "failed", error: "<script>oops</script>" },
    ],
  });
  const html = await fs.readFile(path.join(output, "index.html"), "utf8");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});

test("failed captures cannot replace originals and tampered captures are refused", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wk-docs-apply-"));
  const output = path.join(root, "review");
  const recipe = { id: "a", output: "docs/a.png" };
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.mkdir(path.join(output, "new"), { recursive: true });
  await fs.writeFile(imagePath(root, recipe.output), "original");
  await fs.writeFile(reviewPath(path.join(output, "new"), recipe.output), "stale");
  const entry = {
    ...recipe,
    status: "failed",
    sha256: digest("capture"),
    previousSha256: digest("original"),
    error: "rendering failed",
  };
  await writeReport(output, { results: [entry] });
  assert.equal(await applyReport(root, output, [recipe]), 0);
  // Reviews from before the flat layout keep captures under their docs path.
  await fs.mkdir(path.join(output, "new", "docs"), { recursive: true });
  await fs.rename(
    reviewPath(path.join(output, "new"), recipe.output),
    imagePath(path.join(output, "new"), recipe.output),
  );
  entry.status = "success";
  await writeReport(output, { results: [entry] });
  await assert.rejects(applyReport(root, output, [recipe]), /Generated image changed/);
  await fs.rm(path.join(output, "new"), { recursive: true });
  await assert.rejects(applyReport(root, output, [recipe]), /Missing capture of docs\/a\.png/);
  assert.equal(await fs.readFile(imagePath(root, recipe.output), "utf8"), "original");
});

test("diff ratio counts differing pixels and ignores small color noise", () => {
  const image = (pixels) => ({ width: 10, height: 10, data: Buffer.from(pixels.flat()) });
  const gray = Array.from({ length: 100 }, () => [200, 200, 200, 255]);
  const noisy = gray.map(([r, g, b, a]) => [r + 2, g - 2, b + 1, a]);
  const changed = gray.map((pixel, index) => (index < 5 ? [0, 0, 0, 255] : pixel));
  assert.equal(diffImages(image(gray), image(noisy)).ratio, 0);
  const diff = diffImages(image(gray), image(changed));
  assert.equal(diff.ratio, 0.05);
  assert.ok(diff.image.length > 0);
  assert.deepEqual(diffImages(image(gray), { width: 5, height: 20, data: image(gray).data }), {
    ratio: 1,
  });
  assert.equal(isChanged({ status: "success", diffRatio: 0.05 }, 0.03), true);
  assert.equal(isChanged({ status: "success", diffRatio: 0.01 }, 0.03), false);
  assert.equal(isChanged({ status: "failed" }, 0.03), false);
});
