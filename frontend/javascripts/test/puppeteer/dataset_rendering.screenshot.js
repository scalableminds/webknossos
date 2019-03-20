// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import type { DatasetConfiguration } from "oxalis/store";
import anyTest, { type TestInterface } from "ava";
import fetch, { Headers, Request, Response, FetchError } from "node-fetch";
import path from "path";
import puppeteer, { type Browser } from "puppeteer";

import { compareScreenshot } from "./screenshot_helpers";
import { screenshotDataset, DEV_AUTH_TOKEN } from "./dataset_rendering_helpers";

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});

const BASE_PATH = path.join(__dirname, "../../../../frontend/javascripts/test/screenshots");

let URL = "https://master.webknossos.xyz";
if (!process.env.URL) {
  console.warn(
    "[Warning] No url specified, assuming dev master. If you want to specify a URL, prepend URL=<url> to the command.",
  );
} else {
  URL = process.env.URL;
  // Prepend https:// if not specified
  if (!/^https?:\/\//i.test(URL)) {
    URL = `https://${URL}`;
  }
}
console.log(`[Info] Executing tests on URL ${URL}.`);

// Ava's recommendation for Flow types
// https://github.com/avajs/ava/blob/master/docs/recipes/flow.md#typing-tcontext
const test: TestInterface<{
  browser: Browser,
}> = (anyTest: any);

async function getNewPage(browser: Browser) {
  const page = await browser.newPage();
  page.setViewport({ width: 1920, height: 1080 });
  page.setExtraHTTPHeaders({
    "X-Auth-Token": DEV_AUTH_TOKEN,
  });
  return page;
}

test.beforeEach(async t => {
  t.context.browser = await puppeteer.launch({
    args: [
      "--headless",
      "--hide-scrollbars",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    dumpio: true,
  });
  global.Headers = Headers;
  global.fetch = fetch;
  global.Request = Request;
  global.Response = Response;
  global.FetchError = FetchError;
});

// These are the datasets that are available on our dev instance
const datasetNames = [
  // "ROI2017_wkw",
  // "Cortex_knossos",
  // "2017-05-31_mSEM_aniso-test",
  // "e2006_knossos",
  // "confocal-multi_knossos",
  // "fluro-rgb_knossos",
  "dsA_2",
  // "2017-05-31_mSEM_scMS109_bk_100um_v01-aniso",
  // "ROI2017_wkw_fallback",
];

const viewOverrides: { [key: string]: string } = {
  e2006_knossos: "4736,4992,2176,0,0.6",
  "2017-05-31_mSEM_scMS109_bk_100um_v01-aniso": "4608,4543,386,0,4.00",
  ROI2017_wkw_fallback: "535,536,600,0,1.18",
};

const datasetConfigOverrides: { [key: string]: DatasetConfiguration } = {
  ROI2017_wkw_fallback: {
    fourBit: false,
    interpolation: true,
    layers: { color: { color: [255, 255, 255], contrast: 1, brightness: 0, alpha: 100 } },
    quality: 0,
    segmentationOpacity: 0,
    highlightHoveredCellId: true,
    renderIsosurfaces: false,
    renderMissingDataBlack: false,
    loadingStrategy: "BEST_QUALITY_FIRST",
  },
};

datasetNames.map(async datasetName => {
  test.serial(`it should render dataset ${datasetName} correctly`, async t => {
    const datasetId = { name: datasetName, owningOrganization: "Connectomics_Department" };
    const { screenshot, width, height } = await screenshotDataset(
      await getNewPage(t.context.browser),
      URL,
      datasetId,
      viewOverrides[datasetName],
      datasetConfigOverrides[datasetName],
    );
    const changedPixels = await compareScreenshot(
      screenshot,
      width,
      height,
      BASE_PATH,
      datasetName,
    );

    t.is(
      changedPixels,
      0,
      `Dataset with name: "${datasetName}" does not look the same, see ${datasetName}.diff.png for the difference and ${datasetName}.new.png for the new screenshot.`,
    );
  });
});

test.afterEach(async t => {
  await t.context.browser.close();
});
