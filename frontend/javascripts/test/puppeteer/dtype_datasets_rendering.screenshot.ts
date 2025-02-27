import type { DatasetLayerConfiguration, PartialDatasetConfiguration } from "oxalis/store";
import "test/mocks/lz4";
import urljoin from "url-join";
import {
  assertDatasetIds,
  createAnnotationForDatasetScreenshot,
  getDefaultRequestOptions,
  getNewPage,
  screenshotDataset,
  screenshotTracingView,
  setupBeforeEachAndAfterEach,
  test,
  withRetry,
  writeDatasetNameToIdMapping,
} from "./dataset_rendering_helpers";
import {
  compareScreenshot,
  getUrlForScreenshotTests,
  isPixelEquivalent,
  SCREENSHOTS_BASE_PATH,
} from "./screenshot_helpers";
import _ from "lodash";
import {
  getDtypeConfigForElementClass,
  getSupportedValueRangeForElementClass,
} from "oxalis/model/bucket_data_handling/data_rendering_logic";
import Semaphore from "semaphore-promise";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
  updateTemporarySettingAction,
} from "oxalis/model/actions/settings_actions";
import { setPositionAction, setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import type { Action } from "oxalis/model/actions/actions";
import { ExecutionContext } from "ava";
import { Browser } from "puppeteer-core";

const semaphore = new Semaphore(1);
const testColor = true;
const testSegmentation = true;

const dtypes = [
  // biome-ignore format: don't format array (for easier commenting-out)
  "uint8",
  "int8",
  "uint16",
  "int16",
  "uint32",
  "int32",
  "uint64",
  "int64",
  "float32",
] as const;
type DType = (typeof dtypes)[number];

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});
const URL = getUrlForScreenshotTests();

console.log(`[Info] Executing tests on URL ${URL}.`);

setupBeforeEachAndAfterEach(semaphore);

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

  let layerConfig: Partial<DatasetLayerConfiguration> = {
    alpha: 100,
  };
  if (minMax != null) {
    const [min, max] = minMax;
    layerConfig = {
      ...layerConfig,
      intensityRange: [min, max],
      min: min,
      max: max,
    } as Partial<DatasetLayerConfiguration>;
  }

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
  uint32: 2181570682,
  int32: 34087034,
  uint64: 4575085335741433,
  int64: -142971416741958,
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

    // No color support for 64 bit
    const colorSpecs = ["uint64", "int64"].includes(elementClass)
      ? []
      : [
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

    const segmentationSpecs =
      // No segmentation support for float
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

    if (testSegmentation && testColor) {
      return [...colorSpecs, ...segmentationSpecs];
    } else if (testSegmentation) {
      return segmentationSpecs;
    } else if (testColor) {
      return colorSpecs;
    } else {
      throw new Error("Both testColor and testSegmentation are set to false.");
    }
  }),
);

const datasetNames = _.uniq(specs.map((spec) => spec.datasetName));

const datasetNameToId: Record<string, string> = {};
test.before("Retrieve dataset ids", async () => {
  await writeDatasetNameToIdMapping(URL, datasetNames, datasetNameToId);
});
test.serial("Dataset IDs were retrieved successfully", (t) => {
  assertDatasetIds(t, datasetNames, datasetNameToId);
});

datasetNames.map(async (datasetName) => {
  test(`it should render ${datasetName} correctly`, async (t) => {
    console.time("Creating annotation...");
    const annotation = await createAnnotationForDatasetScreenshot(
      URL,
      datasetNameToId[datasetName],
    );
    console.timeEnd("Creating annotation...");
    const page = await getNewPage(t.context.browser);
    for (const spec of specs.filter((spec) => spec.datasetName === datasetName)) {
      await withRetry(
        1,
        async () => {
          console.log(`Starting: ${spec.name}...`);
          const { datasetConfig } = spec;
          const onLoaded = async () => {
            const [x, y, z, _, zoomValue] = spec.viewOverride
              .split(",")
              .map((el) => Number.parseFloat(el));

            const actions: Action[] = [
              updateDatasetSettingAction("selectiveSegmentVisibility", false),
              updateTemporarySettingAction("hoveredSegmentId", null),
              setPositionAction([x, y, z]),
              setZoomStepAction(zoomValue),
            ];
            if (datasetConfig?.layers != null) {
              const layerName = Object.keys(datasetConfig.layers)[0];
              const { intensityRange } = datasetConfig.layers[layerName];

              actions.push(updateLayerSettingAction(layerName, "intensityRange", intensityRange));
            }

            await page.evaluate((actions) => {
              return window.webknossos.apiReady().then(() => {
                for (const action of actions) {
                  window.webknossos.DEV.store.dispatch(action);
                }
              });
            }, actions);
          };
          console.time("Making screenshot...");
          const { screenshot, width, height } = await screenshotDataset(
            page,
            URL,
            datasetNameToId[spec.datasetName],
            annotation,
            {
              onLoaded,
              viewOverride: spec.viewOverride,
              datasetConfigOverride: spec.datasetConfig,
              ignore3DViewport: true,
            },
          );
          console.timeEnd("Making screenshot...");
          console.time("Comparing screenshot...");
          const changedPixels = await compareScreenshot(
            screenshot,
            width,
            height,
            SCREENSHOTS_BASE_PATH,
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
            const { screenshot, width, height } = await screenshotTracingView(page, true);
            console.timeEnd("Making screenshot...");
            console.time("Comparing screenshot...");
            const changedPixels = await compareScreenshot(
              screenshot,
              width,
              height,
              SCREENSHOTS_BASE_PATH,
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
    }
    await page.close();
  });
});
