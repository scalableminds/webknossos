import type { PartialDatasetConfiguration } from "oxalis/store";
import {
  compareScreenshot,
  getUrlForScreenshotTests,
  isPixelEquivalent,
  SCREENSHOTS_BASE_PATH,
} from "./screenshot_helpers";
import {
  getNewPage,
  screenshotAnnotation,
  screenshotDataset,
  screenshotDatasetWithMapping,
  screenshotDatasetWithMappingLink,
  screenshotSandboxWithMappingLink,
  setupAfterEach,
  setupBeforeEach,
  type ScreenshotTestContext,
  withRetry,
  WK_AUTH_TOKEN,
  writeDatasetNameToIdMapping,
} from "./dataset_rendering_helpers";
import { describe, it, beforeAll, beforeEach, afterEach, expect, test } from "vitest";

if (!WK_AUTH_TOKEN) {
  throw new Error("No WK_AUTH_TOKEN specified.");
}

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});

const URL = getUrlForScreenshotTests();

console.log(`[Info] Executing tests on URL ${URL}.`);

// These datasets are available on our dev instance (e.g., master.webknossos.xyz)
const datasetNames = [
  "ROI2017_wkw",
  "2017-05-31_mSEM_aniso-test",
  "dsA_2",
  "2017-05-31_mSEM_scMS109_bk_100um_v01-aniso",
  "Multi-Channel-Test",
  "connectome_file_test_dataset",
  "kiwi", // This dataset is rotated and translated.
];

type DatasetName = string;
type FallbackLayerName = string | null;
const annotationSpecs: Array<[DatasetName, FallbackLayerName]> = [
  ["ROI2017_wkw", "segmentation"],
  ["ROI2017_wkw", null],
];

const viewOverrides: Record<string, string> = {
  "2017-05-31_mSEM_scMS109_bk_100um_v01-aniso": "4608,4543,386,0,4.00",
  ROI2017_wkw: "535,536,600,0,1.18",
  dsA_2: "1024,1024,64,0,0.424",
  "Multi-Channel-Test": "1201,1072,7,0,0.683",
  "test-agglomerate-file":
    '{"position":[60,60,60],"mode":"orthogonal","zoomStep":0.5,"stateByLayer":{"segmentation":{"mappingInfo":{"mappingName":"agglomerate_view_70","mappingType":"HDF5","agglomerateIdsToImport":[1, 6]}}}}',
  "test-agglomerate-file-with-meshes":
    '{"position":[63,67,118],"mode":"orthogonal","zoomStep":0.826,"stateByLayer":{"segmentation":{"meshInfo":{"meshFileName":"meshfile-with-name","meshes":[{"segmentId":7,"seedPosition":[64,75,118],"isPrecomputed":true,"meshFileName":"meshfile_1-1-1"},{"segmentId":12,"seedPosition":[107,125,118],"isPrecomputed":false,"mappingName":"agglomerate_view_70","mappingType":"HDF5"},{"segmentId":79,"seedPosition":[110,78,118],"isPrecomputed":false,"mappingName":null,"mappingType":null}]}}}}',
  connectome_file_test_dataset:
    '{"position":[102,109,60],"mode":"orthogonal","zoomStep":0.734,"stateByLayer":{"segmentation":{"connectomeInfo":{"connectomeName":"connectome","agglomerateIdsToImport":[1]}}}}',
  kiwi: "1191,1112,21,0,8.746",
};
const datasetConfigOverrides: Record<string, PartialDatasetConfiguration> = {
  ROI2017_wkw: {
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
      another_segmentation: {
        isDisabled: true,
      },
      segmentation: {
        isDisabled: false,
      },
    },
  },
  dsA_2: {
    interpolation: true,
  },
};

const datasetNameToId: Record<string, string> = {};

describe("Dataset Rendering", () => {
  beforeEach<ScreenshotTestContext>(async (context) => {
    await setupBeforeEach(context);
  });

  afterEach<ScreenshotTestContext>(async (context) => {
    await setupAfterEach(context);
  });

  beforeAll(async () => {
    await writeDatasetNameToIdMapping(
      URL,
      datasetNames.concat(["test-agglomerate-file"]),
      datasetNameToId,
    );
  });

  it("Dataset IDs were retrieved successfully", () => {
    const allRetrieved = [...datasetNames, "test-agglomerate-file"].every(
      (name) => !!datasetNameToId[name],
    );
    expect(allRetrieved).toBe(true);
  });

  test.sequential.for(datasetNames)(
    "should render dataset %s correctly",
    async (datasetName, context) => {
      // Type assertion to ensure context has browser property
      const { browser } = context as ScreenshotTestContext;

      await withRetry(
        3,
        async () => {
          const page = await getNewPage(browser);

          const { screenshot, width, height } = await screenshotDataset(
            page,
            URL,
            datasetNameToId[datasetName],
            undefined,
            {
              viewOverride: viewOverrides[datasetName],
              datasetConfigOverride: datasetConfigOverrides[datasetName],
            },
          );
          const changedPixels = await compareScreenshot(
            screenshot,
            width,
            height,
            SCREENSHOTS_BASE_PATH,
            datasetName,
          );
          await page.close();

          return isPixelEquivalent(changedPixels, width, height);
        },
        (condition) => {
          expect(
            condition,
            `Dataset with name: "${datasetName}" does not look the same, see ${datasetName}.diff.png for the difference and ${datasetName}.new.png for the new screenshot.`,
          ).toBe(true);
        },
      );
    },
  );

  test.sequential.for(annotationSpecs)(
    "should render an annotation for %s with fallback_layer=%s correctly",
    async ([datasetName, fallbackLayerName], context) => {
      const fallbackLabel = fallbackLayerName ?? "without_fallback";
      // Type assertion to ensure context has browser property
      const { browser } = context as ScreenshotTestContext;

      console.log(
        `It should render an annotation for ${datasetName} with fallback_layer=${fallbackLayerName} correctly`,
      );

      await withRetry(
        3,
        async () => {
          const page = await getNewPage(browser);

          const { screenshot, width, height } = await screenshotAnnotation(
            page,
            URL,
            datasetNameToId[datasetName],
            fallbackLayerName,
            {
              viewOverride: viewOverrides[datasetName],
              datasetConfigOverride: datasetConfigOverrides[datasetName],
            },
          );

          const changedPixels = await compareScreenshot(
            screenshot,
            width,
            height,
            SCREENSHOTS_BASE_PATH,
            `annotation_${datasetName}_${fallbackLabel}`,
          );
          await page.close();

          return isPixelEquivalent(changedPixels, width, height);
        },
        (condition) => {
          expect(
            condition,
            `Annotation for dataset with name: "${datasetName}" does not look the same, see annotation_${datasetName}_${fallbackLayerName}.diff.png for the difference and annotation_${datasetName}_${fallbackLayerName}.new.png for the new screenshot.`,
          ).toBe(true);
        },
      );
    },
  );

  it.sequential<ScreenshotTestContext>(
    "should render a dataset with mappings correctly",
    async ({ browser }) => {
      const datasetName = "ROI2017_wkw";
      const mappingName = "astrocyte";

      await withRetry(
        3,
        async () => {
          const page = await getNewPage(browser);

          const { screenshot, width, height } = await screenshotDatasetWithMapping(
            page,
            URL,
            datasetNameToId[datasetName],
            mappingName,
          );

          const changedPixels = await compareScreenshot(
            screenshot,
            width,
            height,
            SCREENSHOTS_BASE_PATH,
            `${datasetName}_with_mapping_${mappingName}`,
          );
          await page.close();

          return isPixelEquivalent(changedPixels, width, height);
        },
        (condition) => {
          expect(
            condition,
            `Dataset with name: "${datasetName}" and mapping: "${mappingName}" does not look the same.`,
          ).toBe(true);
        },
      );
    },
  );

  it.sequential<ScreenshotTestContext>(
    "should render a dataset linked to with an active mapping and agglomerate skeleton correctly",
    async ({ browser }) => {
      const datasetName = "test-agglomerate-file";
      const viewOverride = viewOverrides[datasetName];

      await withRetry(
        3,
        async () => {
          const page = await getNewPage(browser);

          const { screenshot, width, height } = await screenshotDatasetWithMappingLink(
            page,
            URL,
            datasetNameToId[datasetName],
            viewOverride,
          );

          const changedPixels = await compareScreenshot(
            screenshot,
            width,
            height,
            SCREENSHOTS_BASE_PATH,
            `${datasetName}_with_mapping_link`,
          );
          await page.close();

          return isPixelEquivalent(changedPixels, width, height);
        },
        (condition) => {
          expect(
            condition,
            `Dataset with name: "${datasetName}", mapping link and loaded agglomerate skeleton does not look the same.`,
          ).toBe(true);
        },
      );
    },
  );

  it.sequential<ScreenshotTestContext>(
    "should render a dataset sandbox linked to with an active mapping and agglomerate skeleton correctly",
    async ({ browser }) => {
      const datasetName = "test-agglomerate-file";
      const viewOverride = viewOverrides[datasetName];

      await withRetry(
        3,
        async () => {
          const page = await getNewPage(browser);
          const { screenshot, width, height } = await screenshotSandboxWithMappingLink(
            page,
            URL,
            datasetNameToId[datasetName],
            viewOverride,
          );
          const changedPixels = await compareScreenshot(
            screenshot,
            width,
            height,
            SCREENSHOTS_BASE_PATH, // Should look the same as an explorative tracing on the same dataset with the same mapping link
            `${datasetName}_with_mapping_link`,
          );
          await page.close();
          return isPixelEquivalent(changedPixels, width, height);
        },
        (condition) => {
          expect(
            condition,
            `Sandbox of dataset with name: "${datasetName}", mapping link and loaded agglomerate skeleton does not look the same.`,
          ).toBe(true);
        },
      );
    },
  );

  it.sequential<ScreenshotTestContext>(
    "should render a dataset linked to with ad-hoc and precomputed meshes correctly",
    async ({ browser }) => {
      const datasetName = "test-agglomerate-file";
      const viewOverride = viewOverrides["test-agglomerate-file-with-meshes"];

      await withRetry(
        3,
        async () => {
          const page = await getNewPage(browser);
          const { screenshot, width, height } = await screenshotDataset(
            page,
            URL,
            datasetNameToId[datasetName],
            undefined,
            {
              viewOverride: viewOverride,
            },
          );
          const changedPixels = await compareScreenshot(
            screenshot,
            width,
            height,
            SCREENSHOTS_BASE_PATH,
            `${datasetName}_with_meshes_link`,
          );
          await page.close();
          return isPixelEquivalent(changedPixels, width, height);
        },
        (condition) => {
          expect(
            condition,
            `Dataset with name: "${datasetName}", ad-hoc and precomputed meshes does not look the same.`,
          ).toBe(true);
        },
      );
    },
  );
});
