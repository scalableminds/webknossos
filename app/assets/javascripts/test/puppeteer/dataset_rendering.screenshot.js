// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import anyTest, { type TestInterface } from "ava";
import fetch, { Headers, Request, Response, FetchError } from "node-fetch";
import path from "path";
import puppeteer, { type Browser } from "puppeteer";

import { compareScreenshot } from "./screenshot_helpers";
import { screenshotDataset, DEV_AUTH_TOKEN } from "./dataset_rendering_helpers";

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});

const BASE_PATH = path.join(__dirname, "../../../../app/assets/javascripts/test/screenshots");

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
  });
  global.Headers = Headers;
  global.fetch = fetch;
  global.Request = Request;
  global.Response = Response;
  global.FetchError = FetchError;
});

// These are the datasets that are available on our dev instance
const datasetNames = [
  "ROI2017_wkw",
  "Cortex_knossos",
  "2017-05-31_mSEM_aniso-test",
  "e2006_knossos",
  "confocal-multi_knossos",
  "fluro-rgb_knossos",
  "dsA_2",
];

const viewOverrides: { [key: string]: string } = {
  e2006_knossos: "4736,4992,2176,0,1.0",
};

datasetNames.map(async datasetName => {
  test.serial(`it should render dataset ${datasetName} correctly`, async t => {
    const { screenshot, width, height } = await screenshotDataset(
      await getNewPage(t.context.browser),
      URL,
      { name: datasetName, owningOrganization: "Connectomics_Department" },
      viewOverrides[datasetName],
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
