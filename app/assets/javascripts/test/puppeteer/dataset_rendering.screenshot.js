/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
const test = require("ava");
const puppeteer = require("puppeteer");
const path = require("path");
const { screenshotDataset, DEV_AUTH_TOKEN } = require("./dataset_rendering_helpers");
const { compareScreenshot } = require("./screenshot_helpers");

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});

const BASE_PATH = path.join(__dirname, "../screenshots");

let BRANCH = "master";
if (!process.env.BRANCH) {
  console.warn(
    "[Warning] No branch specified, assuming branch master. If you want to specify a branch, prepend BRANCH=<branchname> to the command.",
  );
} else {
  BRANCH = process.env.BRANCH;
  console.log(`[Info] Executing tests on branch ${BRANCH}.`);
}

async function getNewPage(browser) {
  const page = await browser.newPage();
  page.setViewport({ width: 1920, height: 1080 });
  page.setExtraHTTPHeaders({
    "X-Auth-Token": DEV_AUTH_TOKEN,
  });
  return page;
}

test.beforeEach(async t => {
  t.context.browser = await puppeteer.launch({
    args: ["--headless", "--hide-scrollbars", "--no-sandbox", "--disable-setuid-sandbox"],
  });
});

// These are the datasets that are available on our dev instance
const datasetNames = [
  "ROI2017_wkw",
  "Cortex_knossos",
  "2017-05-31_mSEM_aniso-test",
  "e2006_knossos",
  "confocal-multi_knossos",
  "fluro-rgb_knossos",
];

datasetNames.map(async datasetName => {
  test(`it should render dataset ${datasetName} correctly`, async t => {
    const { screenshot, width, height } = await screenshotDataset(
      await getNewPage(t.context.browser),
      BRANCH,
      datasetName,
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
