import path from "node:path";
import type { DatasetLayerConfiguration, PartialDatasetConfiguration } from "oxalis/store";
import "test/mocks/lz4";
import urljoin from "url-join";
import {
  createAnnotationForDatasetScreenshot,
  getDefaultRequestOptions,
  getNewPage,
  screenshotDataset,
  setupBeforeEachAndAfterEach,
  test,
  withRetry,
} from "./dataset_rendering_helpers";
import { compareScreenshot, isPixelEquivalent } from "./screenshot_helpers";
import _ from "lodash";
import { getSupportedValueRangeForElementClass } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import Semaphore from "semaphore-promise";

const semaphore = new Semaphore(4);

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
  minMax: [number, number],
): PartialDatasetConfiguration => {
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
    segmentationPatternOpacity: 50,
    loadingStrategy: "BEST_QUALITY_FIRST",
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

// const dtypes = ["uint8", "int8", "uint16", "int16", "uint32", "int32", "float"];

const specs: Array<{
  name: string;
  datasetName: string;
  viewOverride: string;
  datasetConfig: PartialDatasetConfiguration;
}> = [
  // uint8
  {
    name: `01_dtype_uint8_color_${zoomedIn.postfix}`,
    datasetName: "dtype_test_uint8_color",
    viewOverride: zoomedIn.viewOverride,
    datasetConfig: datasetConfigHelper("uint8_color", [0, 10]),
  },
  {
    name: `02_dtype_uint8_color_${zoomedOut.postfix}`,
    datasetName: "dtype_test_uint8_color",
    viewOverride: zoomedOut.viewOverride,
    datasetConfig: datasetConfigHelper(
      "uint8_color",
      getSupportedValueRangeForElementClass("uint8"),
    ),
  },
  // int8
  {
    name: `03_dtype_int8_color_${zoomedIn.postfix}`,
    datasetName: "dtype_test_int8_color",
    viewOverride: zoomedIn.viewOverride,
    datasetConfig: datasetConfigHelper("int8_color", [-10, 10]),
  },
  {
    name: `04_dtype_int8_color_${zoomedOut.postfix}`,
    datasetName: "dtype_test_int8_color",
    viewOverride: zoomedOut.viewOverride,
    datasetConfig: datasetConfigHelper("int8_color", getSupportedValueRangeForElementClass("int8")),
  },
  // uint16
  {
    name: `05_dtype_uint16_color_${zoomedIn.postfix}`,
    datasetName: "dtype_test_uint16_color",
    viewOverride: zoomedIn.viewOverride,
    datasetConfig: datasetConfigHelper("uint16_color", [0, 10]),
  },
  {
    name: `06_dtype_uint16_color_${zoomedOut.postfix}`,
    datasetName: "dtype_test_uint16_color",
    viewOverride: zoomedOut.viewOverride,
    datasetConfig: datasetConfigHelper(
      "uint16_color",
      getSupportedValueRangeForElementClass("uint16"),
    ),
  },
  // int16
  {
    name: `07_dtype_int16_color_${zoomedIn.postfix}`,
    datasetName: "dtype_test_int16_color",
    viewOverride: zoomedIn.viewOverride,
    datasetConfig: datasetConfigHelper("int16_color", [-10, 10]),
  },
  {
    name: `08_dtype_int16_color_${zoomedOut.postfix}`,
    datasetName: "dtype_test_int16_color",
    viewOverride: zoomedOut.viewOverride,
    datasetConfig: datasetConfigHelper(
      "int16_color",
      getSupportedValueRangeForElementClass("int16"),
    ),
  },
  // uint32
  {
    name: `09_dtype_uint32_color_${zoomedIn.postfix}`,
    datasetName: "dtype_test_uint32_color",
    viewOverride: zoomedIn.viewOverride,
    datasetConfig: datasetConfigHelper("uint32_color", [0, 10]),
  },
  {
    name: `10_dtype_uint32_color_${zoomedOut.postfix}`,
    datasetName: "dtype_test_uint32_color",
    viewOverride: zoomedOut.viewOverride,
    datasetConfig: datasetConfigHelper(
      "uint32_color",
      getSupportedValueRangeForElementClass("uint32"),
    ),
  },
  // int32
  {
    name: `11_dtype_int32_color_${zoomedIn.postfix}`,
    datasetName: "dtype_test_int32_color",
    viewOverride: zoomedIn.viewOverride,
    datasetConfig: datasetConfigHelper("int32_color", [-10, 10]),
  },
  {
    name: `12_dtype_int32_color_${zoomedOut.postfix}`,
    datasetName: "dtype_test_int32_color",
    viewOverride: zoomedOut.viewOverride,
    datasetConfig: datasetConfigHelper(
      "int32_color",
      getSupportedValueRangeForElementClass("int32"),
    ),
  },
  // float
  {
    name: `13_dtype_float32_color_${zoomedIn.postfix}`,
    datasetName: "dtype_test_float32_color",
    viewOverride: zoomedIn.viewOverride,
    datasetConfig: datasetConfigHelper("float32_color", [-10, 10]),
  },
  {
    name: `14_dtype_float32_color_${zoomedOut.postfix}`,
    datasetName: "dtype_test_float32_color",
    viewOverride: zoomedOut.viewOverride,
    datasetConfig: datasetConfigHelper(
      "float32_color",
      getSupportedValueRangeForElementClass("float"),
    ),
  },
];
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
            return isPixelEquivalent(changedPixels, width, height);
          },
          (condition) => {
            t.true(
              condition,
              `Dataset spec with name: "${spec.name}" does not look the same, see ${spec.name}.diff.png for the difference and ${spec.name}.new.png for the new screenshot.`,
            );
          },
        );
      }
    } finally {
      release();
    }
  });
});
