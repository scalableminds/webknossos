/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}], no-await-in-loop: 0 */
const fetch = require("node-fetch");
const pixelmatch = require("pixelmatch");

const DEV_AUTH_TOKEN =
  "815aeacaec3392040b5232557599362e93f2155f942cb17ca75de51b954f3835f364bc5df0ab323807136942acae8cbaca8451c4e0240e011bcce68cfd05afb41f1baf37b9f36d4cc87cdd44cc221046ac720233f247e0bc5adb90a512cb4f405093d6c4552bbe86dc12cdb77458fa760385cb9690d81df5435334b58ab901dd";

async function createExplorational(datasetName, typ, withFallback, branchName) {
  const url = `https://${branchName}.webknossos.xyz/api/datasets/${datasetName}/createExplorational`;
  return (await fetch(url, {
    body: JSON.stringify({ typ, withFallback }),
    method: "POST",
    headers: {
      "X-Auth-Token": DEV_AUTH_TOKEN,
      "Content-Type": "application/json",
    },
  })).json();
}

async function screenshotDataset(page, branchName, datasetName) {
  const createdExplorational = await createExplorational(
    datasetName,
    "skeleton",
    false,
    branchName,
  );
  return openTracingViewAndScreenshot(page, branchName, createdExplorational.id);
}

async function openTracingViewAndScreenshot(page, branchName, annotationId) {
  await page.goto(
    `https://${branchName}.webknossos.xyz/annotations/Explorational/${annotationId}`,
    { timeout: 0 },
  );

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
