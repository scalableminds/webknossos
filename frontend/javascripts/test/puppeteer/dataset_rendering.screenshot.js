// @flow
import type { PartialDatasetConfiguration } from "oxalis/store";
import anyTest, { type TestInterface } from "ava";
import fetch, { Headers, Request, Response, FetchError } from "node-fetch";
import path from "path";
import puppeteer, { type Browser } from "puppeteer";

import { compareScreenshot, isPixelEquivalent } from "./screenshot_helpers";
import {
  screenshotDataset,
  screenshotDatasetWithMapping,
  screenshotDatasetWithMappingLink,
  screenshotSandboxWithMappingLink,
  WK_AUTH_TOKEN,
} from "./dataset_rendering_helpers";

if (!WK_AUTH_TOKEN) {
  throw new Error("No WK_AUTH_TOKEN specified.");
}

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
    "X-Auth-Token": WK_AUTH_TOKEN,
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
      "--use-gl=swiftshader",
    ],
    dumpio: true,
  });
  console.log(`\nRunning chrome version ${await t.context.browser.version()}\n`);
  global.Headers = Headers;
  global.fetch = fetch;
  global.Request = Request;
  global.Response = Response;
  global.FetchError = FetchError;
});

// These are the datasets that are available on our dev instance
const datasetNames = [
  "ROI2017_wkw",
  "2017-05-31_mSEM_aniso-test",
  "dsA_2",
  "2017-05-31_mSEM_scMS109_bk_100um_v01-aniso",
  "ROI2017_wkw_fallback",
  "float_test_dataset",
  "Multi-Channel-Test",
  "connectome_file_test_dataset",
];

const viewOverrides: { [key: string]: string } = {
  "2017-05-31_mSEM_scMS109_bk_100um_v01-aniso": "4608,4543,386,0,4.00",
  ROI2017_wkw_fallback: "535,536,600,0,1.18",
  dsA_2: "1024,1024,64,0,0.424",
  "Multi-Channel-Test": "1201,1072,7,0,0.683",
  "test-agglomerate-file":
    '{"position":[60,60,60],"mode":"orthogonal","zoomStep":0.5,"stateByLayer":{"segmentation":{"mappingInfo":{"mappingName":"agglomerate_view_70","mappingType":"HDF5","agglomerateIdsToImport":[1, 6]}}}}',
  "test-agglomerate-file-with-meshes":
    '{"position":[63,67,118],"mode":"orthogonal","zoomStep":0.826,"stateByLayer":{"segmentation":{"meshInfo":{"meshFileName":"meshfile-with-name","meshes":[{"segmentId":4,"seedPosition":[64,75,118],"isPrecomputed":true,"meshFileName":"meshfile-with-name"},{"segmentId":12,"seedPosition":[107,125,118],"isPrecomputed":false,"mappingName":"agglomerate_view_70","mappingType":"HDF5"},{"segmentId":79,"seedPosition":[110,78,118],"isPrecomputed":false,"mappingName":null,"mappingType":null}]}}}}',
  connectome_file_test_dataset:
    '{"position":[60,60,60],"mode":"orthogonal","zoomStep":0.734,"stateByLayer":{"segmentation":{"connectomeInfo":{"connectomeName":"connectome","agglomerateIdsToImport":[1]}}}}',
};

const datasetConfigOverrides: { [key: string]: PartialDatasetConfiguration } = {
  ROI2017_wkw_fallback: {
    layers: {
      color: {
        alpha: 100,
        intensityRange: [0, 255],
        min: 0,
        max: 255,
      },
    },
    segmentationPatternOpacity: 50,
    loadingStrategy: "BEST_QUALITY_FIRST",
  },
  connectome_file_test_dataset: {
    layers: {
      another_segmentation: { isDisabled: true },
      segmentation: { isDisabled: false },
    },
  },
};

async function withRetry(
  retryCount: number,
  testFn: () => Promise<boolean>,
  resolveFn: boolean => void,
) {
  for (let i = 0; i < retryCount; i++) {
    // eslint-disable-next-line no-await-in-loop
    const condition = await testFn();
    if (condition || i === retryCount - 1) {
      // Either the test passed or we executed the last attempt
      resolveFn(condition);
      return;
    }
    console.error(`Test failed, retrying. This will be attempt ${i + 2}/${retryCount}.`);
  }
}

datasetNames.map(async datasetName => {
  test.serial(`it should render dataset ${datasetName} correctly`, async t => {
    await withRetry(
      3,
      async () => {
        const datasetId = { name: datasetName, owningOrganization: "sample_organization" };
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

        return isPixelEquivalent(changedPixels, width, height);
      },
      condition => {
        t.true(
          condition,
          `Dataset with name: "${datasetName}" does not look the same, see ${datasetName}.diff.png for the difference and ${datasetName}.new.png for the new screenshot.`,
        );
      },
    );
  });
});

test.serial("it should render a dataset with mappings correctly", async t => {
  const datasetName = "ROI2017_wkw";
  const mappingName = "astrocyte";
  await withRetry(
    3,
    async () => {
      const datasetId = { name: datasetName, owningOrganization: "sample_organization" };
      const { screenshot, width, height } = await screenshotDatasetWithMapping(
        await getNewPage(t.context.browser),
        URL,
        datasetId,
        mappingName,
      );
      const changedPixels = await compareScreenshot(
        screenshot,
        width,
        height,
        BASE_PATH,
        `${datasetName}_with_mapping_${mappingName}`,
      );

      return isPixelEquivalent(changedPixels, width, height);
    },
    condition => {
      t.true(
        condition,
        `Dataset with name: "${datasetName}" and mapping: "${mappingName}" does not look the same.`,
      );
    },
  );
});

test.serial(
  "it should render a dataset linked to with an active mapping and agglomerate skeletons correctly",
  async t => {
    const datasetName = "test-agglomerate-file";
    const viewOverride = viewOverrides[datasetName];
    await withRetry(
      3,
      async () => {
        const datasetId = { name: datasetName, owningOrganization: "sample_organization" };
        const { screenshot, width, height } = await screenshotDatasetWithMappingLink(
          await getNewPage(t.context.browser),
          URL,
          datasetId,
          viewOverride,
        );
        const changedPixels = await compareScreenshot(
          screenshot,
          width,
          height,
          BASE_PATH,
          `${datasetName}_with_mapping_link`,
        );

        return isPixelEquivalent(changedPixels, width, height);
      },
      condition => {
        t.true(
          condition,
          `Dataset with name: "${datasetName}", mapping link and loaded agglomerate skeletons does not look the same.`,
        );
      },
    );
  },
);

test.serial(
  "it should render a dataset sandbox linked to with an active mapping and agglomerate skeletons correctly",
  async t => {
    const datasetName = "test-agglomerate-file";
    const viewOverride = viewOverrides[datasetName];
    await withRetry(
      3,
      async () => {
        const datasetId = { name: datasetName, owningOrganization: "sample_organization" };
        const { screenshot, width, height } = await screenshotSandboxWithMappingLink(
          await getNewPage(t.context.browser),
          URL,
          datasetId,
          viewOverride,
        );
        const changedPixels = await compareScreenshot(
          screenshot,
          width,
          height,
          BASE_PATH,
          // Should look the same as an explorative tracing on the same dataset with the same mapping link
          `${datasetName}_with_mapping_link`,
        );

        return isPixelEquivalent(changedPixels, width, height);
      },
      condition => {
        t.true(
          condition,
          `Sandbox of dataset with name: "${datasetName}", mapping link and loaded agglomerate skeletons does not look the same.`,
        );
      },
    );
  },
);

test.serial(
  "it should render a dataset linked to with ad-hoc and precomputed meshes correctly",
  async t => {
    const datasetName = "test-agglomerate-file";
    const viewOverride = viewOverrides["test-agglomerate-file-with-meshes"];
    await withRetry(
      3,
      async () => {
        const datasetId = { name: datasetName, owningOrganization: "sample_organization" };
        const { screenshot, width, height } = await screenshotDataset(
          await getNewPage(t.context.browser),
          URL,
          datasetId,
          viewOverride,
        );
        const changedPixels = await compareScreenshot(
          screenshot,
          width,
          height,
          BASE_PATH,
          `${datasetName}_with_meshes_link`,
        );

        return isPixelEquivalent(changedPixels, width, height);
      },
      condition => {
        t.true(
          condition,
          `Dataset with name: "${datasetName}", ad-hoc and precomputed meshes does not look the same.`,
        );
      },
    );
  },
);

test.afterEach(async t => {
  await t.context.browser.close();
});
