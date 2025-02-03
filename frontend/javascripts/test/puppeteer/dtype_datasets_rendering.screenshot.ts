import path from "node:path";
import type { DatasetLayerConfiguration, PartialDatasetConfiguration } from "oxalis/store";
import "test/mocks/lz4";
import urljoin from "url-join";
import {
  createAnnotationForDatasetScreenshot,
  getDefaultRequestOptions,
  getNewPage,
  screenshotDataset,
  screenshotTracingView,
  setupBeforeEachAndAfterEach,
  test,
  withRetry,
} from "./dataset_rendering_helpers";
import { compareScreenshot, isPixelEquivalent } from "./screenshot_helpers";
import _ from "lodash";
import {
  getDtypeConfigForElementClass,
  getSupportedValueRangeForElementClass,
} from "oxalis/model/bucket_data_handling/data_rendering_logic";
import Semaphore from "semaphore-promise";
import {
  updateDatasetSettingAction,
  updateTemporarySettingAction,
} from "oxalis/model/actions/settings_actions";

const semaphore = new Semaphore(3);
const onlyTestSegmentation = false;

const dtypes = [
  // biome-ignore format: don't format array (for easier commenting-out)
  "uint8",
  "int8",
  "uint16",
  "int16",
  "uint32",
  "int32",
  "float32",
] as const;
type DType = (typeof dtypes)[number];

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});
const BASE_PATH = path.join(__dirname, "../../../../frontend/javascripts/test/screenshots");
let URL = "http://localhost:9000/";

console.log(`[Info] Executing tests on URL ${URL}.`);

setupBeforeEachAndAfterEach();

// These datasets are available on our dev instance (e.g., master.webknossos.xyz)

const datasetConfigHelper = (
  layerName: string,
  minMax: [number, number] | undefined,
): PartialDatasetConfiguration => {
  const base = {
    segmentationPatternOpacity: 20,
    segmentationOpacity: 100,
    loadingStrategy: "BEST_QUALITY_FIRST",
  } as const;
  if (minMax == null) {
    return base;
  }
  const [min, max] = minMax;
  const layerConfig = {
    alpha: 100,
    intensityRange: [min, max],
    min: min,
    max: max,
  } as Partial<DatasetLayerConfiguration>;

  return {
    layers: {
      [layerName]: layerConfig,
    },
    ...base,
  };
};

const zoomedIn = {
  postfix: "zoomed_in",
  viewOverride: "512,1,0,0,0.047",
};
const zoomedOut = {
  postfix: "zoomed_out",
  viewOverride: "512,256,16,0,2.0",
};

const selectiveSegmentIdByDtype: Partial<Record<DType, number>> = {
  uint8: 122,
  int8: -6,
  uint16: 33280,
  int16: -527,
};

type Spec = {
  name: string;
  dtype: DType;
  datasetName: string;
  viewOverride: string;
  datasetConfig: PartialDatasetConfiguration;
  alsoTestSelectiveSegmentId?: boolean;
};

const specs: Array<Spec> = _.flatten(
  dtypes.map((dtype): Spec[] => {
    const elementClass = dtype === "float32" ? "float" : dtype;

    const colorSpecs = [
      {
        name: `dtype_${dtype}_color_${zoomedIn.postfix}`,
        dtype,
        datasetName: `dtype_test_${dtype}_color`,
        viewOverride: zoomedIn.viewOverride,
        datasetConfig: datasetConfigHelper(`${dtype}_color`, [
          getDtypeConfigForElementClass(elementClass).isSigned ? -10 : 0,
          10,
        ]),
      },
      {
        name: `dtype_${dtype}_color_${zoomedOut.postfix}`,
        dtype,
        datasetName: `dtype_test_${dtype}_color`,
        viewOverride: zoomedOut.viewOverride,
        datasetConfig: datasetConfigHelper(
          `${dtype}_color`,
          getSupportedValueRangeForElementClass(elementClass),
        ),
      },
    ];

    // No segmentation support for float
    const segmentationSpecs =
      elementClass === "float"
        ? []
        : [
            {
              name: `dtype_${dtype}_segmentation_${zoomedIn.postfix}`,
              dtype,
              datasetName: `dtype_test_${dtype}_segmentation`,
              viewOverride: zoomedIn.viewOverride,
              datasetConfig: datasetConfigHelper(`${dtype}_segmentation`, undefined),
              alsoTestSelectiveSegmentId: true,
            },
            {
              name: `dtype_${dtype}_segmentation_${zoomedOut.postfix}`,
              dtype,
              datasetName: `dtype_test_${dtype}_segmentation`,
              viewOverride: zoomedOut.viewOverride,
              datasetConfig: datasetConfigHelper(`${dtype}_segmentation`, undefined),
            },
          ];

    if (onlyTestSegmentation) {
      return segmentationSpecs;
    }
    return [...colorSpecs, ...segmentationSpecs];
  }),
);

const datasetNames = _.uniq(specs.map((spec) => spec.datasetName));

const datasetNameToId: Record<string, string> = {};
test.before("Retrieve dataset ids", async () => {
  for (const datasetName of datasetNames) {
    await withRetry(
      1,
      async () => {
        const options = getDefaultRequestOptions(URL);
        const path = `/api/datasets/disambiguate/sample_organization/${datasetName}/toId`;
        const url = urljoin(URL, path);
        const response = await fetch(url, options);
        const { id } = await response.json();
        datasetNameToId[datasetName] = id;
        return true;
      },
      () => {},
    );
  }
});
test.serial("Dataset IDs were retrieved successfully", (t) => {
  for (const datasetName of datasetNames) {
    t.truthy(datasetNameToId[datasetName], `Dataset ID not found for "${datasetName}"`);
  }
});

datasetNames.map(async (datasetName) => {
  test(`it should render ${datasetName} correctly`, async (t) => {
    console.time("Creating annotation...");
    const annotation = await createAnnotationForDatasetScreenshot(
      URL,
      datasetNameToId[datasetName],
    );
    console.timeEnd("Creating annotation...");
    const release = await semaphore.acquire();
    try {
      for (const spec of specs.filter((spec) => spec.datasetName === datasetName)) {
        const page = await getNewPage(t.context.browser);
        await withRetry(
          1,
          async () => {
            console.time("Making screenshot...");
            const { screenshot, width, height } = await screenshotDataset(
              page,
              URL,
              datasetNameToId[spec.datasetName],
              annotation,
              spec.viewOverride,
              spec.datasetConfig,
            );
            console.timeEnd("Making screenshot...");
            console.time("Comparing screenshot...");
            const changedPixels = await compareScreenshot(
              screenshot,
              width,
              height,
              BASE_PATH,
              spec.name,
            );
            console.timeEnd("Comparing screenshot...");

            let success = true;
            if (spec.alsoTestSelectiveSegmentId && selectiveSegmentIdByDtype[spec.dtype] != null) {
              const actions = [
                updateDatasetSettingAction("selectiveSegmentVisibility", true),
                updateTemporarySettingAction(
                  "hoveredSegmentId",
                  selectiveSegmentIdByDtype[spec.dtype] ?? null,
                ),
              ];
              console.time("evaluate");
              await page.evaluate((actions) => {
                for (const action of actions) {
                  window.webknossos.DEV.store.dispatch(action);
                }
              }, actions);
              console.timeEnd("evaluate");
              console.time("Making screenshot...");
              const { screenshot, width, height } = await screenshotTracingView(page);
              const hoveredSegmentId = await page.evaluate(() => {
                return window.webknossos.DEV.store.getState().temporaryConfiguration
                  .hoveredSegmentId;
              });
              console.log("hoveredSegmentId", hoveredSegmentId);
              console.timeEnd("Making screenshot...");
              console.time("Comparing screenshot...");
              const changedPixels = await compareScreenshot(
                screenshot,
                width,
                height,
                BASE_PATH,
                spec.name + "_selective_segment",
              );
              console.timeEnd("Comparing screenshot...");

              success = isPixelEquivalent(changedPixels, width, height);
            }

            return success && isPixelEquivalent(changedPixels, width, height);
          },
          (condition) => {
            t.true(
              condition,
              `Dataset spec with name: "${spec.name}" does not look the same, see ${spec.name}.diff.png for the difference and ${spec.name}.new.png for the new screenshot.`,
            );
          },
        );
        page.close();
      }
    } finally {
      release();
    }
  });
});
