#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer-core";
import { recipes as adminRecipes } from "./admin.mjs";
import { authenticateLocalPage } from "./browser.mjs";
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
    list: { type: "boolean" },
    apply: { type: "boolean" },
    headed: { type: "boolean" },
    help: { type: "boolean" },
  },
});
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
    "Usage: yarn docs:screenshots [--base-url http://localhost:9000] [--only id,id] [--fixtures file.json] [--dataset-id ID] [--organization sample_organization] [--executable CHROME_PATH] [--browser-url URL] [--headed] [--output .docs-screenshots] [--list | --apply]\nSee tools/docs-screenshots/README.md. WK_AUTH_TOKEN authenticates to the local instance.",
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
  const fixtures = values.fixtures ? JSON.parse(await fs.readFile(values.fixtures, "utf8")) : {};
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
  const datasetId =
    values["dataset-id"] ||
    (
      await api(
        `/api/datasets/disambiguate/${encodeURIComponent(values.organization)}/l4_sample/toId`,
      )
    ).id;
  const dataset = await api(`/api/datasets/${datasetId}`);
  if (dataset.name !== "l4_sample" && dataset.directoryName !== "l4_sample")
    throw new Error(
      "All dataset screenshots must use published l4_sample. Selected dataset has a different name.",
    );
  if (!dataset.dataSource?.dataLayers?.length)
    throw new Error(
      "l4_sample has no available layers. Make the published dataset available to the local instance first.",
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
    ? await puppeteer.connect({ browserURL: values["browser-url"] })
    : await puppeteer.launch({
        ...(values.executable || process.env.PUPPETEER_EXECUTABLE_PATH
          ? { executablePath: values.executable || process.env.PUPPETEER_EXECUTABLE_PATH }
          : { channel: "chrome" }),
        headless: !values.headed,
        args: ["--lang=en-US", "--window-size=1600,1000"],
      });
  const report = {
    createdAt: new Date().toISOString(),
    baseUrl,
    datasetId,
    browser: await browser.version(),
    results: [],
  };
  try {
    for (const recipe of selected) {
      console.log(`Capturing ${recipe.id}`);
      const context = await browser.createBrowserContext();
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
      page.on("requestfailed", (request) =>
        requestErrors.push(`${request.url().split("?")[0]}: ${request.failure()?.errorText}`),
      );
      page.on("response", (response) => {
        if (
          response.headers()["failure-bucket-indices"] &&
          response.headers()["failure-bucket-indices"] !== "[]" &&
          requestErrors.length < 20
        )
          requestErrors.push(
            `${response.url().split("?")[0]}: unreadable buckets ${response.headers()["failure-bucket-indices"]}`,
          );
        if (response.status() >= 400 && requestErrors.length < 20)
          requestErrors.push(`${response.url().split("?")[0]}: HTTP ${response.status()}`);
      });
      page.on("pageerror", (error) => browserErrors.push(error.message));
      try {
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(60000);
        await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
        await page.emulateTimezone("UTC");
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        let authenticate = true;
        await authenticateLocalPage(page, baseUrl, token, () => authenticate);
        const ctx = {
          page,
          baseUrl,
          dataset,
          fixtures,
          async anonymous() {
            authenticate = false;
            await context.deleteCookie(...(await context.cookies()));
          },
          async clickText(text, { exact = true } = {}) {
            const handle = await page.waitForFunction(
              (text, exact) =>
                Array.from(
                  document.querySelectorAll("button,a,[role=tab],[role=menuitem],label,span"),
                ).find((element) => {
                  const content = element.textContent?.trim();
                  return (
                    element.getClientRects().length &&
                    (exact ? content === text : content?.includes(text))
                  );
                }),
              {},
              text,
              exact,
            );
            const element = handle.asElement();
            if (!element) throw new Error(`Cannot click ${text}`);
            await element.click();
            await handle.dispose();
          },
          async waitForViewer() {
            await page.waitForFunction(() => {
              const error = document.querySelector(".initialization-error-message");
              if (error) throw new Error(`Viewer initialization failed: ${error.textContent}`);
              return !!window.webknossos?.apiReady;
            });
            await page.evaluate(async () => {
              await Promise.race([
                window.webknossos.apiReady(),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("Viewer API initialization timed out")), 60000),
                ),
              ]);
            });
            await page.waitForSelector(".inputcatcher", { visible: true });
            await page.evaluate(async () => {
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
              await window.webknossos.DEV.waitForCompletedDataLoading(60000, 1000);
            });
          },
          async openViewer({ mode = "view", hash = {}, persist = false } = {}) {
            let route = `/datasets/${dataset.id}/${mode === "view" ? "view" : `sandbox/${mode}`}`;
            if (persist || mode === "hybrid" || mode === "volume") {
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
        await page.addStyleTag({
          content:
            "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
        });
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        if (await page.$(".initialization-error-message"))
          throw new Error("Viewer initialization failed.");
        if (browserErrors.length) throw new Error(`Browser error: ${browserErrors.join("; ")}`);
        const target = selector ? await page.waitForSelector(selector, { visible: true }) : page;
        const image = Buffer.from(
          await target.screenshot({
            type: /\.jpe?g$/i.test(recipe.output) ? "jpeg" : "png",
            captureBeyondViewport: false,
          }),
        );
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
    if (values["browser-url"]) browser.disconnect();
    else await browser.close();
  }
  console.log(`Review: ${path.join(output, "index.html")}`);
  if (report.results.some((entry) => entry.status === "failed")) process.exitCode = 1;
}
