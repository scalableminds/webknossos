#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { recipes as adminRecipes } from "./admin.mjs";
import {
  addBrowserFrame,
  authenticateLocalPage,
  captureContextOptions,
  captureScreenshot,
  clickText,
  waitForViewer,
} from "./browser.mjs";
import { applyReport, digest, imagePath, writeReport } from "./core.mjs";
import { checkCoverage } from "./inventory.mjs";
import { recipes as viewerRecipes } from "./viewer.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { values } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://localhost:9000" },
    output: { type: "string", default: ".docs-screenshots" },
    only: { type: "string" },
    fixtures: { type: "string" },
    "dataset-id": { type: "string" },
    organization: { type: "string", default: "sample_organization" },
    executable: { type: "string" },
    "browser-url": { type: "string" },
    "browser-frame": { type: "string", default: "none" },
    list: { type: "boolean" },
    apply: { type: "boolean" },
    headed: { type: "boolean" },
    help: { type: "boolean" },
  },
});
if (!["none", "generic"].includes(values["browser-frame"]))
  throw new Error("--browser-frame must be none or generic.");
const recipes = [...viewerRecipes, ...adminRecipes];
const outputs = new Set();
const ids = new Set();
for (const recipe of recipes) {
  imagePath(root, recipe.output);
  if (outputs.has(recipe.output) || ids.has(recipe.id))
    throw new Error(`Duplicate recipe: ${recipe.id} / ${recipe.output}`);
  outputs.add(recipe.output);
  ids.add(recipe.id);
}
if (values.help) {
  console.log(
    "Usage: yarn docs:screenshots [--base-url http://localhost:9000] [--only id,id] [--fixtures file.json] [--dataset-id ID] [--organization sample_organization] [--executable CHROME_PATH] [--browser-url URL] [--browser-frame none|generic] [--headed] [--output .docs-screenshots] [--list | --apply]\nSee tools/docs-screenshots/README.md. WK_AUTH_TOKEN authenticates to the local instance.",
  );
} else if (values.list) {
  for (const recipe of recipes) console.log(`${recipe.id}\t${recipe.output}`);
} else if (values.apply) {
  console.log(
    `Updated ${await applyReport(root, path.resolve(root, values.output), recipes)} documentation images.`,
  );
} else {
  await run();
}

// Checked-in defaults (dataset, viewer scene, portable curated scenes) are merged with an
// optional local fixtures file, which holds instance-specific IDs.
async function loadFixtures(file) {
  const defaults = JSON.parse(
    await fs.readFile(new URL("./fixtures.default.json", import.meta.url), "utf8"),
  );
  const local = file ? JSON.parse(await fs.readFile(file, "utf8")) : {};
  return {
    ...defaults,
    ...local,
    viewer: { ...defaults.viewer, ...local.viewer },
    scenes: { ...defaults.scenes, ...local.scenes },
  };
}

async function run() {
  const coverage = await checkCoverage(recipes);
  if (coverage.errors.length) throw new Error(coverage.errors.join("\n"));
  const baseUrl = new URL(values["base-url"]).origin;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname))
    throw new Error(
      "Use a local WEBKNOSSOS instance; these recipes include local fixture operations.",
    );
  const requested = values.only?.split(",");
  if (requested?.some((id) => !ids.has(id)))
    throw new Error(`Unknown recipe IDs: ${requested.filter((id) => !ids.has(id)).join(", ")}`);
  const selected = recipes.filter((recipe) => !requested || requested.includes(recipe.id));
  const fixtures = await loadFixtures(values.fixtures);
  const token = process.env.WK_AUTH_TOKEN;
  async function api(route, method = "GET", body) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(token ? { "X-Auth-Token": token } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      const message = detail?.messages
        ?.map((item) => item.error)
        .filter(Boolean)
        .join("; ");
      throw new Error(`${route}: HTTP ${response.status}${message ? ` — ${message}` : ""}`);
    }
    return response.json();
  }
  const datasetName = fixtures.dataset;
  const datasetId =
    values["dataset-id"] ||
    (
      await api(
        `/api/datasets/disambiguate/${encodeURIComponent(values.organization)}/${encodeURIComponent(datasetName)}/toId`,
      )
    ).id;
  const dataset = await api(`/api/datasets/${datasetId}`);
  if (dataset.name !== datasetName && dataset.directoryName !== datasetName)
    throw new Error(
      `All dataset screenshots must use ${datasetName} (fixtures.dataset). Selected dataset has a different name.`,
    );
  if (!dataset.dataSource?.dataLayers?.length)
    throw new Error(
      `${datasetName} has no available layers. Make the dataset available to the local instance first.`,
    );
  const output = path.resolve(root, values.output);
  if (
    output === root ||
    output === path.join(root, "docs") ||
    output.startsWith(`${path.join(root, "docs")}${path.sep}`)
  )
    throw new Error("Review output must be outside docs/.");
  await fs.mkdir(output, { recursive: true });
  const browser = values["browser-url"]
    ? await chromium.connectOverCDP(values["browser-url"])
    : await chromium.launch({
        ...(values.executable || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: values.executable || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : { channel: "chrome" }),
        headless: !values.headed,
        args: ["--lang=en-US", "--window-size=1600,1000"],
      });
  for (const { path: asset } of coverage.excluded) {
    const target = path.join(output, "excluded", asset);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(root, asset), target);
  }
  const report = {
    createdAt: new Date().toISOString(),
    baseUrl,
    datasetId,
    browser: await browser.version(),
    browserFrame: values["browser-frame"],
    // Excluded images are listed in the review so they are not overlooked.
    excluded: coverage.excluded.map(({ path, kind, reason }) => ({ path, kind, reason })),
    results: [],
  };
  try {
    for (const recipe of selected) {
      console.log(`Capturing ${recipe.id}`);
      const context = await browser.newContext(captureContextOptions(recipe));
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page = await context.newPage();
      const entry = { id: recipe.id, output: recipe.output };
      const temporaryAnnotations = [];
      const browserErrors = [];
      const requestErrors = [];
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error" && consoleErrors.length < 20)
          consoleErrors.push(message.text().replaceAll(token || "__no_token__", "[redacted]"));
      });
      page.on(
        "requestfailed",
        (request) =>
          requestErrors.length < 20 &&
          requestErrors.push(`${request.url().split("?")[0]}: ${request.failure()?.errorText}`),
      );
      page.on("response", async (response) => {
        const headers = await response.allHeaders().catch(() => ({}));
        if (
          headers["failure-bucket-indices"] &&
          headers["failure-bucket-indices"] !== "[]" &&
          requestErrors.length < 20
        )
          requestErrors.push(
            `${response.url().split("?")[0]}: unreadable buckets ${headers["failure-bucket-indices"]}`,
          );
        if (response.status() >= 400 && requestErrors.length < 20)
          requestErrors.push(`${response.url().split("?")[0]}: HTTP ${response.status()}`);
      });
      page.on("pageerror", (error) => browserErrors.push(error.message));
      try {
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(60000);
        let authenticate = true;
        await authenticateLocalPage(page, baseUrl, token, () => authenticate);
        const ctx = {
          page,
          baseUrl,
          dataset,
          fixtures,
          async anonymous() {
            authenticate = false;
            await context.clearCookies();
          },
          clickText: (text, options) => clickText(page, text, options),
          waitForViewer: () => waitForViewer(page),
          async openViewer({ mode = "view", hash = {}, persist = false } = {}) {
            let route = `/datasets/${dataset.id}/${mode === "view" ? "view" : `sandbox/${mode}`}`;
            if (persist || mode !== "view") {
              if (!token)
                throw new Error("WK_AUTH_TOKEN is required for temporary annotation screenshots.");
              const layers = [];
              if (mode !== "volume") layers.push({ typ: "Skeleton", name: "Skeleton" });
              if (mode !== "skeleton")
                layers.push({ typ: "Volume", name: "Volume", autoFallbackLayer: true });
              const annotation = await api(
                `/api/datasets/${dataset.id}/createExplorational`,
                "POST",
                layers,
              );
              temporaryAnnotations.push(annotation.id);
              route = `/annotations/${annotation.id}`;
            }
            await page.goto(`${baseUrl}${route}#${encodeURIComponent(JSON.stringify(hash))}`, {
              waitUntil: "domcontentloaded",
            });
            await ctx.waitForViewer();
          },
        };
        let recipeTimer;
        let selector;
        try {
          selector = await Promise.race([
            recipe.capture(ctx),
            new Promise((_, reject) => {
              recipeTimer = setTimeout(
                () => reject(new Error("Recipe exceeded 180 seconds")),
                180000,
              );
            }),
          ]);
        } finally {
          clearTimeout(recipeTimer);
        }
        if (temporaryAnnotations.length) {
          await page.evaluate(async () => {
            await (await window.webknossos.apiReady()).tracing.save();
          });
        }
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        if (await page.locator(".initialization-error-message").count())
          throw new Error("Viewer initialization failed.");
        if (browserErrors.length) throw new Error(`Browser error: ${browserErrors.join("; ")}`);
        let image = Buffer.from(await captureScreenshot(page, selector, recipe));
        if (values["browser-frame"] === "generic") {
          image = Buffer.from(await addBrowserFrame(page, image, recipe.output, baseUrl));
        }
        const old = await fs.readFile(imagePath(root, recipe.output));
        for (const [folder, bytes] of [
          ["old", old],
          ["new", image],
        ]) {
          const targetPath = imagePath(path.join(output, folder), recipe.output);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, bytes);
        }
        Object.assign(entry, {
          status: "success",
          sha256: digest(image),
          previousSha256: digest(old),
        });
      } catch (error) {
        const failureImage = `failure-${encodeURIComponent(recipe.id)}.png`;
        await page
          .screenshot({ path: path.join(output, failureImage) })
          .then(() => {
            entry.failureImage = failureImage;
          })
          .catch(() => {});
        const details = await page
          .evaluate(() => ({
            url: location.origin + location.pathname,
            queues: window.webknossos?.DEV?.model?.getAllLayers().map((layer) => ({
              name: layer.name,
              empty: layer.pullQueue.isEmpty(),
              fetching: layer.pullQueue.fetchingBatchCount,
              pending: layer.pullQueue.priorityQueue.length,
              retries: layer.pullQueue.consecutiveErrorCount,
            })),
            initializationError: document.querySelector(".initialization-error-message")
              ?.textContent,
            notifications: Array.from(
              document.querySelectorAll(
                ".ant-message-notice-content, .ant-notification-notice-description",
              ),
            ).map((el) => el.textContent),
          }))
          .catch(() => ({}));
        Object.assign(entry, {
          status: "failed",
          error: error.message,
          details,
          browserErrors,
          requestErrors,
          consoleErrors,
          stack: error.stack,
        });
        console.error(`${recipe.id}: ${error.message}`);
      } finally {
        const trace = `trace-${encodeURIComponent(recipe.id)}.zip`;
        await context.tracing
          .stop(entry.status === "failed" ? { path: path.join(output, trace) } : {})
          .catch(() => {});
        if (entry.status === "failed") entry.trace = trace;
        await context.close();
        for (const id of temporaryAnnotations) {
          try {
            await api(`/api/annotations/Explorational/${id}`, "DELETE");
          } catch (error) {
            entry.status = "failed";
            entry.error = `Temporary annotation ${id} cleanup failed: ${error.message}`;
          }
        }
      }
      report.results.push(entry);
      await writeReport(output, report);
    }
  } finally {
    await browser.close();
  }
  console.log(
    `${report.results.filter((entry) => entry.status === "success").length} succeeded; ${report.results.filter((entry) => entry.status === "failed").length} failed.`,
  );
  console.log(`Review: ${path.join(output, "index.html")}`);
  if (report.results.some((entry) => entry.status === "failed")) process.exitCode = 1;
}
