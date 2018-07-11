/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}], no-await-in-loop: 0 */
const urljoin = require("url-join");
const fetch = require("node-fetch");
const pixelmatch = require("pixelmatch");

const DEV_AUTH_TOKEN = "secretScmBoyToken";

async function createExplorational(datasetName, typ, withFallback, baseUrl) {
  const fullUrl = urljoin(baseUrl, `/api/datasets/${datasetName}/createExplorational`);
  return (await fetch(fullUrl, {
    body: JSON.stringify({ typ, withFallback }),
    method: "POST",
    headers: {
      "X-Auth-Token": DEV_AUTH_TOKEN,
      "Content-Type": "application/json",
    },
  })).json();
}

async function screenshotDataset(page, baseUrl, datasetName) {
  const createdExplorational = await createExplorational(datasetName, "skeleton", false, baseUrl);
  return openTracingViewAndScreenshot(page, baseUrl, createdExplorational.id);
}

async function openTracingViewAndScreenshot(page, baseUrl, annotationId) {
  await page.goto(urljoin(baseUrl, `/annotations/Explorational/${annotationId}`), {
    timeout: 0,
  });

  let canvas;
  while (canvas == null) {
    canvas = await page.$("#render-canvas");
    await page.waitFor(500);
  }
  const { width, height } = await canvas.boundingBox();

  let currentShot;
  let lastShot = await canvas.screenshot();
  let changedPixels = Infinity;
  // If the screenshot didn't change in the last x seconds, we're probably done
  while (currentShot == null || changedPixels > 0) {
    await page.waitFor(10000);
    currentShot = await canvas.screenshot();
    if (lastShot != null) {
      changedPixels = pixelmatch(lastShot, currentShot, {}, width, height, {
        threshold: 0.0,
      });
    }
    lastShot = currentShot;
  }

  return { screenshot: currentShot, width, height };
}

module.exports = {
  screenshotDataset,
  DEV_AUTH_TOKEN,
};
