/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
const test = require("ava");
const puppeteer = require("puppeteer");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");
const fs = require("fs");
const path = require("path");
const { screenshotDataset, DEV_AUTH_TOKEN } = require("./dataset_rendering_helpers");

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

function compareScreenshot(screenshotBuffer, name, width, height) {
  return new Promise(resolve => {
    let readFiles = 0;
    const existingScreenshot = fs
      .createReadStream(`${BASE_PATH}/${name}.png`)
      // If there is no existing screenshot, save the current one
      .on("error", saveScreenshot)
      .pipe(new PNG())
      .on("parsed", doneReading);

    const newScreenshot = new PNG({ width, height });
    newScreenshot.parse(screenshotBuffer, doneReading);

    function doneReading() {
      if (++readFiles < 2) return;
      const diff = new PNG({ width, height });

      const pixelErrors = pixelmatch(
        existingScreenshot.data,
        newScreenshot.data,
        diff.data,
        existingScreenshot.width,
        existingScreenshot.height,
        { threshold: 0.0 },
      );

      if (pixelErrors > 0) {
        diff
          .pack()
          .pipe(fs.createWriteStream(`${BASE_PATH}/${name}-diff.png`))
          .on("finish", () => resolve(pixelErrors));
      } else {
        resolve(0);
      }
    }

    function saveScreenshot() {
      const png = new PNG({ width, height });
      png.parse(screenshotBuffer, () => {
        png
          .pack()
          .pipe(fs.createWriteStream(`${BASE_PATH}/${name}.png`))
          .on("finish", () => resolve(0));
      });
    }
  });
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

test("it should render all datasets correctly", async t => {
  // await api.triggerDatasetCheck("http://localhost:9000");
  // const datasets = await api.getActiveDatasets();
  const datasetNames = [
    "ROI2017_wkw",
    "Cortex_knossos",
    "2017-05-31_mSEM_aniso-test",
    "e2006_knossos",
    "confocal-multi_knossos",
    "fluro-rgb_knossos",
  ];

  const results = await Promise.all(
    datasetNames.map(async datasetName => {
      const { screenshot, width, height } = await screenshotDataset(
        await getNewPage(t.context.browser),
        BRANCH,
        datasetName,
      );
      return compareScreenshot(screenshot, datasetName, width, height);
    }),
  );
  for (let i = 0; i < datasetNames.length; i++) {
    t.is(
      results[i],
      0,
      `Dataset with name: "${datasetNames[i]}" does not look the same, see ${BASE_PATH}/${
        datasetNames[i]
      }-diff.png for the difference.`,
    );
  }
});

test.afterEach(async t => {
  await t.context.browser.close();
});
