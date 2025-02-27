import urljoin from "url-join";
import "test/mocks/lz4";
import type { PartialDatasetConfiguration } from "oxalis/store";
import {
  compareScreenshot,
  getUrlForScreenshotTests,
  isPixelEquivalent,
  SCREENSHOTS_BASE_PATH,
} from "./screenshot_helpers";
import {
  test,
  getNewPage,
  screenshotAnnotation,
  screenshotDataset,
  screenshotDatasetWithMapping,
  screenshotDatasetWithMappingLink,
  screenshotSandboxWithMappingLink,
  setupBeforeEachAndAfterEach,
  withRetry,
  WK_AUTH_TOKEN,
  getDefaultRequestOptions,
  writeDatasetNameToIdMapping,
  assertDatasetIds,
} from "./dataset_rendering_helpers";

if (!WK_AUTH_TOKEN) {
  throw new Error("No WK_AUTH_TOKEN specified.");
}

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});

const URL = getUrlForScreenshotTests();

console.log(`[Info] Executing tests on URL ${URL}.`);

setupBeforeEachAndAfterEach();

// These datasets are available on our dev instance (e.g., master.webknossos.xyz)
const datasetNames = [
  "ROI2017_wkw",
  "2017-05-31_mSEM_aniso-test",
  "dsA_2",
  "2017-05-31_mSEM_scMS109_bk_100um_v01-aniso",
  "ROI2017_wkw_fallback",
  "float_test_dataset",
  "Multi-Channel-Test",
  "connectome_file_test_dataset",
  "kiwi", // This dataset is rotated and translated.
];

type DatasetName = string;
type FallbackLayerName = string | null;
const annotationSpecs: Array<[DatasetName, FallbackLayerName]> = [
  ["ROI2017_wkw_fallback", "segmentation"],
  ["ROI2017_wkw_fallback", null],
];

const viewOverrides: Record<string, string> = {
  "2017-05-31_mSEM_scMS109_bk_100um_v01-aniso": "4608,4543,386,0,4.00",
  ROI2017_wkw_fallback: "535,536,600,0,1.18",
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
test.before("Retrieve dataset ids", async () => {
  await writeDatasetNameToIdMapping(
    URL,
    datasetNames.concat(["test-agglomerate-file"]),
    datasetNameToId,
  );
});

test.serial("Dataset IDs were retrieved successfully", (t) => {
  assertDatasetIds(t, datasetNames, datasetNameToId);
});

datasetNames.map(async (datasetName) => {
  test.serial(`it should render dataset ${datasetName} correctly`, async (t) => {
    await withRetry(
      3,
      async () => {
        const page = await getNewPage(t.context.browser);
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
        t.true(
          condition,
          `Dataset with name: "${datasetName}" does not look the same, see ${datasetName}.diff.png for the difference and ${datasetName}.new.png for the new screenshot.`,
        );
      },
    );
  });
});

annotationSpecs.map(async (annotationSpec) => {
  const [datasetName, fallbackLayerName] = annotationSpec;

  test.serial(
    `It should render an annotation for ${datasetName} with fallback_layer=${fallbackLayerName} correctly`,
    async (t) => {
      console.log(
        `It should render an annotation for ${datasetName} with fallback_layer=${fallbackLayerName} correctly`,
      );
      await withRetry(
        3,
        async () => {
          const page = await getNewPage(t.context.browser);
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
            `annotation_${datasetName}_${fallbackLayerName}`,
          );
          await page.close();
          return isPixelEquivalent(changedPixels, width, height);
        },
        (condition) => {
          t.true(
            condition,
            `Annotation for dataset with name: "${datasetName}" does not look the same, see annotation_${datasetName}_${fallbackLayerName}.diff.png for the difference and annotation_${datasetName}_${fallbackLayerName}.new.png for the new screenshot.`,
          );
        },
      );
    },
  );
});

test.serial("it should render a dataset with mappings correctly", async (t) => {
  const datasetName = "ROI2017_wkw";
  const mappingName = "astrocyte";
  await withRetry(
    3,
    async () => {
      const page = await getNewPage(t.context.browser);
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
      t.true(
        condition,
        `Dataset with name: "${datasetName}" and mapping: "${mappingName}" does not look the same.`,
      );
    },
  );
});
test.serial(
  "it should render a dataset linked to with an active mapping and agglomerate skeleton correctly",
  async (t) => {
    const datasetName = "test-agglomerate-file";
    const viewOverride = viewOverrides[datasetName];
    await withRetry(
      3,
      async () => {
        const page = await getNewPage(t.context.browser);
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
        t.true(
          condition,
          `Dataset with name: "${datasetName}", mapping link and loaded agglomerate skeleton does not look the same.`,
        );
      },
    );
  },
);
test.serial(
  "it should render a dataset sandbox linked to with an active mapping and agglomerate skeleton correctly",
  async (t) => {
    const datasetName = "test-agglomerate-file";
    const viewOverride = viewOverrides[datasetName];
    await withRetry(
      3,
      async () => {
        const page = await getNewPage(t.context.browser);
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
        t.true(
          condition,
          `Sandbox of dataset with name: "${datasetName}", mapping link and loaded agglomerate skeleton does not look the same.`,
        );
      },
    );
  },
);
test.serial(
  "it should render a dataset linked to with ad-hoc and precomputed meshes correctly",
  async (t) => {
    const datasetName = "test-agglomerate-file";
    const viewOverride = viewOverrides["test-agglomerate-file-with-meshes"];
    await withRetry(
      3,
      async () => {
        const page = await getNewPage(t.context.browser);
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
        t.true(
          condition,
          `Dataset with name: "${datasetName}", ad-hoc and precomputed meshes does not look the same.`,
        );
      },
    );
  },
);
