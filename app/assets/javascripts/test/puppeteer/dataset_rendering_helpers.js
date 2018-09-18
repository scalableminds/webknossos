/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}], no-await-in-loop: 0 */
const urljoin = require("url-join");
const fetch = require("node-fetch");
const pixelmatch = require("pixelmatch");
const mergeImg = require("merge-img");

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

async function waitForTracingViewLoad(page) {
  let inputCatchers;
  while (inputCatchers == null || inputCatchers.length < 4) {
    inputCatchers = await page.$(".inputcatcher");
    await page.waitFor(500);
  }
}

async function waitForRenderingFinish(page) {
  const tdView = await page.$("#inputcatcher_TDView");
  const { width, height } = await tdView.boundingBox();

  let currentShot;
  let lastShot = await tdView.screenshot();
  let changedPixels = Infinity;
  // If the screenshot of the TDView didn't change in the last x seconds, we're probably done
  while (currentShot == null || changedPixels > 0) {
    await page.waitFor(10000);
    currentShot = await tdView.screenshot();
    if (lastShot != null) {
      changedPixels = pixelmatch(lastShot, currentShot, {}, width, height, {
        threshold: 0.0,
      });
    }
    lastShot = currentShot;
  }

  return { screenshot: currentShot, width, height };
}

async function openTracingViewAndScreenshot(page, baseUrl, annotationId) {
  await page.goto(urljoin(baseUrl, `/annotations/Explorational/${annotationId}`), {
    timeout: 0,
  });

  await waitForTracingViewLoad(page);

  const {
    screenshot: tdViewScreenshot,
    width: tdViewWidth,
    height: tdViewHeight,
  } = await waitForRenderingFinish(page);

  // Take screenshots of the other rendered planes
  const PLANE_IDS = ["#inputcatcher_PLANE_XY", "#inputcatcher_PLANE_YZ", "#inputcatcher_PLANE_XZ"];
  const screenshots = [tdViewScreenshot];
  for (const planeId of PLANE_IDS) {
    const element = await page.$(planeId);
    const screenshot = await element.screenshot();
    screenshots.push(screenshot);
  }

  // Concatenate all screenshots
  const img = await mergeImg(screenshots);
  return new Promise(resolve =>
    img.getBuffer("image/png", (_, buffer) =>
      resolve({
        screenshot: buffer,
        width: tdViewWidth * 4,
        height: tdViewHeight,
      }),
    ),
  );
}

module.exports = {
  screenshotDataset,
  DEV_AUTH_TOKEN,
};
