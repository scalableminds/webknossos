// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}], no-await-in-loop: 0 */
import urljoin from "url-join";

import type { DatasetConfiguration } from "oxalis/store";
import type { Page } from "puppeteer";
import mergeImg from "merge-img";
import pixelmatch from "pixelmatch";

import type { APIDatasetId } from "../../admin/api_flow_types";
import { createExplorational, updateDatasetConfiguration } from "../../admin/admin_rest_api";

export const DEV_AUTH_TOKEN = "secretScmBoyToken";

type Screenshot = {
  screenshot: Buffer,
  width: number,
  height: number,
};

function getDefaultRequestOptions(baseUrl: string) {
  return {
    host: baseUrl,
    doNotInvestigate: true,
    headers: {
      "X-Auth-Token": DEV_AUTH_TOKEN,
    },
  };
}

export async function screenshotDataset(
  page: Page,
  baseUrl: string,
  datasetId: APIDatasetId,
  optionalViewOverride: ?string,
  optionalDatasetConfigOverride: ?DatasetConfiguration,
): Promise<Screenshot> {
  const options = getDefaultRequestOptions(baseUrl);
  const createdExplorational = await createExplorational(datasetId, "skeleton", false, options);
  if (optionalDatasetConfigOverride != null) {
    await updateDatasetConfiguration(datasetId, optionalDatasetConfigOverride, options);
  }
  return openTracingViewAndScreenshot(page, baseUrl, createdExplorational.id, optionalViewOverride);
}

async function waitForTracingViewLoad(page: Page) {
  let inputCatchers;
  while (inputCatchers == null || inputCatchers.length < 4) {
    inputCatchers = await page.$(".inputcatcher");
    await page.waitFor(500);
  }
}

async function waitForRenderingFinish(page: Page) {
  let currentShot;
  let lastShot = await page.screenshot({ fullPage: true });
  let changedPixels = Infinity;
  // If the screenshot of the page didn't change in the last x seconds, rendering should be finished
  while (currentShot == null || changedPixels > 0) {
    await page.waitFor(10000);
    currentShot = await page.screenshot({ fullPage: true });
    if (lastShot != null) {
      changedPixels = pixelmatch(lastShot, currentShot, {}, 1920, 1080, {
        threshold: 0.0,
      });
    }
    lastShot = currentShot;
  }
}

async function openTracingViewAndScreenshot(
  page: Page,
  baseUrl: string,
  annotationId: string,
  optionalViewOverride: ?string,
): Promise<Screenshot> {
  const urlSlug = optionalViewOverride != null ? `#${optionalViewOverride}` : "";
  await page.goto(urljoin(baseUrl, `/annotations/Explorational/${annotationId}${urlSlug}`), {
    timeout: 0,
  });

  await waitForTracingViewLoad(page);
  await waitForRenderingFinish(page);

  // Take screenshots of the other rendered planes
  const PLANE_IDS = [
    "#inputcatcher_TDView",
    "#inputcatcher_PLANE_XY",
    "#inputcatcher_PLANE_YZ",
    "#inputcatcher_PLANE_XZ",
  ];
  const screenshots = [];
  for (const planeId of PLANE_IDS) {
    const element = await page.$(planeId);
    if (element == null)
      throw new Error(`Element ${planeId} not present, although page is loaded.`);
    const screenshot = await element.screenshot();
    screenshots.push(screenshot);
  }

  // Concatenate all screenshots
  const img = await mergeImg(screenshots);
  return new Promise(resolve =>
    img.getBuffer("image/png", (_, buffer) =>
      resolve({
        screenshot: buffer,
        width: img.bitmap.width,
        height: img.bitmap.height,
      }),
    ),
  );
}

export default {};
