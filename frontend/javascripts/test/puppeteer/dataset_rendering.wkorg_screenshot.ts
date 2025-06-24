import path from "node:path";
import { compareScreenshot, isPixelEquivalent } from "./screenshot_helpers";
import {
  getDefaultRequestOptions,
  getNewPage,
  screenshotDatasetView,
  type ScreenshotTestContext,
  setupAfterEach,
  setupBeforeEach,
  withRetry,
} from "./dataset_rendering_helpers";
import { encodeUrlHash } from "viewer/controller/url_manager";
import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { updateDatasetDefaultConfiguration } from "admin/rest_api";
import type { DatasetConfiguration } from "viewer/store";
import type { BLEND_MODES } from "viewer/constants";

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});

const SCREENSHOTS_BASE_PATH = path.join(
  __dirname,
  "../../../../frontend/javascripts/test/screenshots-wkorg",
);
const URL = "https://webknossos.org";

console.log(`[Info] Executing tests on URL ${URL}.`);

const demoDatasetName = "l4dense_motta_et_al_demo";
const owningOrganization = "scalable_minds";

const viewOverrides: Record<string, string> = {
  l4dense_motta_et_al_demo: encodeUrlHash(
    JSON.stringify({
      position: [2816, 4352, 1792],
      mode: "orthogonal",
      zoomStep: 1.3,
      additionalCoordinates: [],
      stateByLayer: {
        color: { isDisabled: false },
        predictions: { isDisabled: true },
        segmentation: { isDisabled: false },
      },
    }),
  ),
};

// The following configuration will be set during the test.
// The tested dataset is *the* example dataset for WK which users
// are guided to from the landing page. We want to ensure good defaults
// and in case they were changed accidentally, it is good that they are
// reset automatically each night.
// If we want different defaults, they should be set here.
const datasetConfiguration: DatasetConfiguration = {
  layers: {
    color: {
      alpha: 100,
      gammaCorrectionValue: 1,
      min: 0,
      color: [255, 255, 255],
      max: 255,
      isInverted: false,
      isInEditMode: false,
      isDisabled: false,
      intensityRange: [74, 165],
    },
    predictions: {
      alpha: 50,
      gammaCorrectionValue: 1,
      min: 0,
      color: [255, 255, 255],
      max: 255,
      isInverted: false,
      isInEditMode: false,
      isDisabled: true,
      intensityRange: [103, 199],
    },
    segmentation: {
      alpha: 20,
      gammaCorrectionValue: 1,
      mapping: null,
      color: [255, 255, 255],
      isInverted: false,
      isInEditMode: false,
      isDisabled: false,
    },
  },
  fourBit: false,
  interpolation: false,
  segmentationPatternOpacity: 25,
  colorLayerOrder: ["color", "predictions"],
  position: [2924, 4474, 1770],
  zoom: 0.9,
  blendMode: "Additive" as BLEND_MODES,
  nativelyRenderedLayerName: null,
  loadingStrategy: "PROGRESSIVE_QUALITY",
  renderMissingDataBlack: true,
};

describe("webknossos.org Dataset Rendering", () => {
  beforeEach<ScreenshotTestContext>(async (context) => {
    await setupBeforeEach(context);
  });

  afterEach<ScreenshotTestContext>(async (context) => {
    await setupAfterEach(context);
  });

  it<ScreenshotTestContext>(`should render dataset ${demoDatasetName} correctly`, async ({
    browser,
  }) => {
    await withRetry(
      3,
      async () => {
        const response = await fetch(
          `${URL}/api/datasets/disambiguate/${owningOrganization}/${demoDatasetName}/toId`,
        );
        const { id: datasetId } = await response.json();

        await updateDatasetDefaultConfiguration(
          datasetId,
          datasetConfiguration,
          getDefaultRequestOptions(URL),
        );

        const page = await getNewPage(browser);
        const { screenshot, width, height } = await screenshotDatasetView(
          page,
          URL,
          datasetId,
          viewOverrides[demoDatasetName],
        );
        const changedPixels = await compareScreenshot(
          screenshot,
          width,
          height,
          SCREENSHOTS_BASE_PATH,
          demoDatasetName,
        );
        await page.close();

        return isPixelEquivalent(changedPixels, width, height);
      },
      (condition) => {
        expect(
          condition,
          `Dataset with name: "${demoDatasetName}" does not look the same, see ${demoDatasetName}.diff.png for the difference and ${demoDatasetName}.new.png for the new screenshot.`,
        ).toBe(true);
      },
    );
  });
});
