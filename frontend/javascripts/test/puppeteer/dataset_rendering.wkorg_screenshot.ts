import "test/mocks/lz4";
import path from "node:path";
import { compareScreenshot, isPixelEquivalent } from "./screenshot_helpers";
import {
  test,
  getNewPage,
  screenshotDatasetView,
  setupBeforeEachAndAfterEach,
  withRetry,
  checkBrowserstackCredentials,
} from "./dataset_rendering_helpers";
import { encodeUrlHash } from "oxalis/controller/url_manager";

checkBrowserstackCredentials();

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});
const SCREENSHOTS_BASE_PATH = path.join(
  __dirname,
  "../../../../frontend/javascripts/test/screenshots-wkorg",
);
const URL = "https://webknossos.org";

console.log(`[Info] Executing tests on URL ${URL}.`);
setupBeforeEachAndAfterEach();

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

test.serial(`it should render dataset ${demoDatasetName} correctly`, async (t) => {
  await withRetry(
    3,
    async () => {
      const response = await fetch(
        `${URL}/api/datasets/disambiguate/${owningOrganization}/${demoDatasetName}/toId`,
      );
      const { id: datasetId } = await response.json();
      const { screenshot, width, height } = await screenshotDatasetView(
        await getNewPage(t.context.browser),
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
      return isPixelEquivalent(changedPixels, width, height);
    },
    (condition) => {
      t.true(
        condition,
        `Dataset with name: "${demoDatasetName}" does not look the same, see ${demoDatasetName}.diff.png for the difference and ${demoDatasetName}.new.png for the new screenshot.`,
      );
    },
  );
});
