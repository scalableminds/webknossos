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
  min: number,
  max: number,
): PartialDatasetConfiguration => {
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

const specs: Array<{
  name: string;
  datasetName: string;
  viewOverride: string;
  datasetConfig: PartialDatasetConfiguration;
}> = [
  // uint8
  {
    name: "01_dtype_uint8_color_zoomed_in",
    datasetName: "dtype_test_uint8_color",
    viewOverride: "512,1,0,0,0.047",
    datasetConfig: datasetConfigHelper("uint8_color", 0, 10),
  },
  {
    name: "02_dtype_uint8_color_zoomed_out",
    datasetName: "dtype_test_uint8_color",
    viewOverride: "512,256,16,0,2.0",
    datasetConfig: datasetConfigHelper("uint8_color", 0, 255),
  },
  // int8
  {
    name: "03_dtype_int8_color_zoomed_in",
    datasetName: "dtype_test_int8_color",
    viewOverride: "512,1,0,0,0.047",
    datasetConfig: datasetConfigHelper("int8_color", -10, 10),
  },
  {
    name: "04_dtype_int8_color_zoomed_out",
    datasetName: "dtype_test_int8_color",
    viewOverride: "512,256,16,0,2.0",
    datasetConfig: datasetConfigHelper("int8_color", -128, 127),
  },
  // uint16
  {
    name: "05_dtype_uint16_color_zoomed_in",
    datasetName: "dtype_test_uint16_color",
    viewOverride: "512,1,0,0,0.047",
    datasetConfig: datasetConfigHelper("uint16_color", 0, 10),
  },
  {
    name: "06_dtype_uint16_color_zoomed_out",
    datasetName: "dtype_test_uint16_color",
    viewOverride: "512,256,16,0,2.0",
    datasetConfig: datasetConfigHelper("uint16_color", 0, 2 ** 16 - 1),
  },
  // int16
  {
    name: "07_dtype_int16_color_zoomed_in",
    datasetName: "dtype_test_int16_color",
    viewOverride: "512,1,0,0,0.047",
    datasetConfig: datasetConfigHelper("int16_color", -10, 10),
  },
  {
    name: "08_dtype_int16_color_zoomed_out",
    datasetName: "dtype_test_int16_color",
    viewOverride: "512,256,16,0,2.0",
    datasetConfig: datasetConfigHelper("int16_color", -32768, 32768),
  },
  // uint32
  {
    name: "09_dtype_uint32_color_zoomed_in",
    datasetName: "dtype_test_uint32_color",
    viewOverride: "512,1,0,0,0.047",
    datasetConfig: datasetConfigHelper("uint32_color", 0, 10),
  },
  {
    name: "10_dtype_uint32_color_zoomed_out",
    datasetName: "dtype_test_uint32_color",
    viewOverride: "512,256,16,0,2.0",
    datasetConfig: datasetConfigHelper("uint32_color", 0, 2 ** 32 - 1),
  },
  // int32
  {
    name: "11_dtype_int32_color_zoomed_in",
    datasetName: "dtype_test_int32_color",
    viewOverride: "512,1,0,0,0.047",
    datasetConfig: datasetConfigHelper("int32_color", -10, 10),
  },
  {
    name: "12_dtype_int32_color_zoomed_out",
    datasetName: "dtype_test_int32_color",
    viewOverride: "512,256,16,0,2.0",
    datasetConfig: datasetConfigHelper("int32_color", -(2 ** 31), 2 ** 31 - 1),
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
    console.time("Getting new page...");
    console.timeEnd("Getting new page...");
    console.time("Creating annotation...");
    const annotation = await createAnnotationForDatasetScreenshot(
      URL,
      datasetNameToId[datasetName],
    );
    console.timeEnd("Creating annotation...");
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
  });
});
