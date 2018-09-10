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
  "dsA_2",
];

datasetNames.map(async datasetName => {
  test(`it should render dataset ${datasetName} correctly`, async t => {
    const { screenshot, width, height } = await screenshotDataset(
      await getNewPage(t.context.browser),
      URL,
      { name: datasetName, owningOrganization: "Connectomics department" },
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
