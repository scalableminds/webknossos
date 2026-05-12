/* eslint no-await-in-loop: 0 */

import type { RequestOptions } from "libs/request";
import { sleep } from "libs/utils";
import mergeImg from "merge-img";
import type { Browser, Page } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import type { APIAnnotation } from "types/api_types";
import urljoin from "url-join";
import type { PartialDatasetConfiguration } from "viewer/store";
import { type TestContext, vi } from "vitest";
import { createExplorational, updateDatasetConfiguration } from "../../admin/rest_api";
import {
  HEADLESS,
  MAXIMUM_WAIT_TIME_FOR_DATASET_LOADING,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  USE_LOCAL_CHROME,
} from "./screenshot_test_config";

vi.mock("libs/request", async (importOriginal) => {
  // The request lib is globally mocked for the unit tests. In the screenshot tests, we actually want to run the proper fetch calls so we revert to the original implementation
  return await importOriginal();
});

export const { WK_AUTH_TOKEN } = process.env;

type Screenshot = {
  screenshot: Buffer;
  width: number;
  height: number;
};

export function getDefaultRequestOptions(baseUrl: string): RequestOptions {
  if (!WK_AUTH_TOKEN) {
    throw new Error("No WK_AUTH_TOKEN specified.");
  }

  return {
    host: baseUrl,
    doNotInvestigate: true,
    headers: {
      "X-Auth-Token": WK_AUTH_TOKEN,
    },
  };
}

export async function writeDatasetNameToIdMapping(
  baseUrl: string,
  datasetNames: string[],
  datasetNameToId: Record<string, string>,
) {
  for (const datasetName of datasetNames) {
    const options = getDefaultRequestOptions(baseUrl);
    const path = `/api/datasets/disambiguate/sample_organization/${datasetName}/toId`;
    const url = urljoin(baseUrl, path);
    const response = await fetch(url, options);
    const { id } = await response.json();
    datasetNameToId[datasetName] = id;
  }
}

export async function createAnnotationForDatasetScreenshot(baseUrl: string, datasetId: string) {
  const options = getDefaultRequestOptions(baseUrl);
  return createExplorational(datasetId, "skeleton", false, null, null, null, options);
}

type ScreenshotOptions = {
  onLoaded?: () => Promise<void>;
  viewOverride?: string | null | undefined;
  datasetConfigOverride?: PartialDatasetConfiguration | null | undefined;
  ignore3DViewport?: boolean;
};

export async function screenshotDataset(
  page: Page,
  baseUrl: string,
  datasetId: string,
  optAnnotation?: APIAnnotation,
  options?: ScreenshotOptions,
): Promise<Screenshot> {
  return _screenshotAnnotationHelper(
    page,
    async () => optAnnotation ?? createAnnotationForDatasetScreenshot(baseUrl, datasetId),
    baseUrl,
    datasetId,
    options,
  );
}

export async function screenshotAnnotation(
  page: Page,
  baseUrl: string,
  datasetId: string,
  fallbackLayerName: string | null,
  options?: ScreenshotOptions,
): Promise<Screenshot> {
  return _screenshotAnnotationHelper(
    page,
    () => {
      const requestOptions = getDefaultRequestOptions(baseUrl);
      return createExplorational(
        datasetId,
        "hybrid",
        false,
        fallbackLayerName,
        null,
        null,
        requestOptions,
      );
    },
    baseUrl,
    datasetId,
    options,
  );
}

async function _screenshotAnnotationHelper(
  page: Page,
  getAnnotation: () => Promise<APIAnnotation>,
  baseUrl: string,
  datasetId: string,
  options?: ScreenshotOptions,
): Promise<Screenshot> {
  const requestOptions = getDefaultRequestOptions(baseUrl);
  const createdExplorational = await getAnnotation();

  if (options?.datasetConfigOverride != null) {
    await updateDatasetConfiguration(datasetId, options.datasetConfigOverride, requestOptions);
  }

  await openTracingView(
    page,
    baseUrl,
    createdExplorational.id,
    options?.onLoaded,
    options?.viewOverride,
  );

  return screenshotTracingView(page, options?.ignore3DViewport);
}

export async function screenshotDatasetView(
  page: Page,
  baseUrl: string,
  datasetId: string,
  viewOverride?: string | null | undefined,
): Promise<Screenshot> {
  const url = `${baseUrl}/datasets/${datasetId}`;

  await openDatasetView(page, url, viewOverride);
  return screenshotTracingView(page);
}

export async function screenshotDatasetWithMapping(
  page: Page,
  baseUrl: string,
  datasetId: string,
  mappingName: string,
): Promise<Screenshot> {
  const options = getDefaultRequestOptions(baseUrl);
  const createdExplorational = await createExplorational(
    datasetId,
    "skeleton",
    false,
    null,
    null,
    null,
    options,
  );
  await openTracingView(page, baseUrl, createdExplorational.id);
  await page.evaluate(
    `webknossos.apiReady().then(async api => api.data.activateMapping("${mappingName}"))`,
  );
  await waitForMappingEnabled(page);

  return screenshotTracingView(page);
}
export async function screenshotDatasetWithMappingLink(
  page: Page,
  baseUrl: string,
  datasetId: string,
  viewOverride: string | null | undefined,
): Promise<Screenshot> {
  const options = getDefaultRequestOptions(baseUrl);
  const createdExplorational = await createExplorational(
    datasetId,
    "skeleton",
    false,
    null,
    null,
    null,
    options,
  );
  await openTracingView(page, baseUrl, createdExplorational.id, undefined, viewOverride);
  await waitForMappingEnabled(page);

  return screenshotTracingView(page);
}
export async function screenshotSandboxWithMappingLink(
  page: Page,
  baseUrl: string,
  datasetId: string,
  viewOverride: string | null | undefined,
): Promise<Screenshot> {
  await openSandboxView(page, baseUrl, datasetId, viewOverride);
  await waitForMappingEnabled(page);

  return screenshotTracingView(page);
}

async function waitForMappingEnabled(page: Page) {
  console.log("Waiting for mapping to be enabled");
  let isMappingEnabled;

  while (!isMappingEnabled) {
    await sleep(5000);
    isMappingEnabled = await page.evaluate(
      "webknossos.apiReady().then(async api => api.data.isMappingEnabled())",
    );
  }

  console.log("Mapping was enabled");
}

export async function waitForTracingViewLoad(page: Page) {
  let inputCatchers;
  let iterationCount = 0;

  while (inputCatchers == null || inputCatchers.length < 4) {
    iterationCount++;
    if (iterationCount > 5) {
      console.log("Waiting suspiciously long for page to load...");
    }
    await sleep(500);
    const inputCatcherPromise = page
      .waitForSelector(".inputcatcher")
      .then(() => page.$$(".inputcatcher"))
      .then((elements) => ({ type: "inputcatchers", elements }));

    const errorPromise = page
      .waitForSelector(".initialization-error-message")
      .then((element) => ({ type: "error", elements: [element] }));

    const raceResult = await Promise.race([inputCatcherPromise, errorPromise]);

    if (raceResult.type === "error") {
      // Sleep a bit so that we can visually inspect the error in (recorded) sessions.
      await sleep(1000);
      throw new Error("Initialization error detected");
    }

    inputCatchers = raceResult.elements;
  }
}

async function waitForRenderingFinish(page: Page) {
  await sleep(1000);
  await page.evaluate(
    (maxWaitTime) => window.webknossos.DEV.waitForCompletedDataLoading(maxWaitTime),
    MAXIMUM_WAIT_TIME_FOR_DATASET_LOADING,
  );
}

async function openTracingView(
  page: Page,
  baseUrl: string,
  annotationId: string,
  onLoaded?: () => Promise<void>,
  viewOverride?: string | null | undefined,
) {
  const urlSlug = viewOverride != null ? `#${viewOverride}` : "";
  const url = urljoin(baseUrl, `/annotations/${annotationId}${urlSlug}`);

  console.log(`Opening annotation view at ${url}`);
  await page.goto(url, {
    timeout: 0,
  });

  await waitForTracingViewLoad(page);
  console.log("Loaded annotation view");

  if (onLoaded != null) {
    await onLoaded();
  }

  await waitForRenderingFinish(page);
  console.log("Finished rendering annotation view");
}

async function openDatasetView(
  page: Page,
  baseUrl: string,
  viewOverride?: string | null | undefined,
) {
  const urlSlug = viewOverride != null ? `#${viewOverride}` : "";
  const url = urljoin(baseUrl, `/view${urlSlug}`);

  console.log(`Opening dataset view at ${url}`);
  await page.goto(url, {
    timeout: 0,
  });
  await waitForTracingViewLoad(page);
  console.log("Loaded dataset view");

  await waitForRenderingFinish(page);
  console.log("Finished rendering dataset view");
}

async function openSandboxView(
  page: Page,
  baseUrl: string,
  datasetId: string,
  viewOverride: string | null | undefined,
) {
  const urlSlug = viewOverride != null ? `#${viewOverride}` : "";
  const url = urljoin(baseUrl, `/datasets/${datasetId}/sandbox/skeleton${urlSlug}`);

  console.log(`Opening sandbox annotation view at ${url}`);
  await page.goto(url, {
    timeout: 0,
  });
  await waitForTracingViewLoad(page);
  console.log("Loaded annotation view");

  await waitForRenderingFinish(page);
  console.log("Finished rendering annotation view");
}

export async function screenshotTracingView(
  page: Page,
  ignore3DViewport?: boolean,
): Promise<Screenshot> {
  console.log("Screenshot annotation view");
  // Take screenshots of the other rendered planes
  const PLANE_IDS = [
    ...(ignore3DViewport ? [] : ["#screenshot_target_inputcatcher_TDView"]),
    "#screenshot_target_inputcatcher_PLANE_XY",
    "#screenshot_target_inputcatcher_PLANE_YZ",
    "#screenshot_target_inputcatcher_PLANE_XZ",
  ];
  const screenshots = [];

  async function setOpacity(value: number) {
    await page.evaluate((value: number) => {
      const element = document.getElementById("TDViewControls");
      if (element) {
        element.style.opacity = `${value}`;
      }
    }, value);
  }
  let revertOpacityIfNecessary = async () => {};
  if (!ignore3DViewport) {
    await setOpacity(0);
    revertOpacityIfNecessary = async () => {
      await setOpacity(1);
    };
  }

  for (const planeId of PLANE_IDS) {
    const element = await page.$(planeId);
    if (element == null)
      throw new Error(`Element ${planeId} not present, although page is loaded.`);

    // captureBeyondViewport=false prevents a react callstack error which was apparently
    // triggered by a resize event when capturing beyond the viewport. Concretely, some
    // antd observers got into an infinite loop. The symptom was an error toast in the UI.
    const screenshot = await element.screenshot({ captureBeyondViewport: false });
    screenshots.push(screenshot);
  }

  await revertOpacityIfNecessary();
  // Concatenate all screenshots
  const img = await mergeImg(screenshots as Array<Buffer>);

  return new Promise((resolve) => {
    img.getBuffer("image/png", (_, buffer) =>
      resolve({
        screenshot: buffer,
        width: img.bitmap.width,
        height: img.bitmap.height,
      }),
    );
  });
}

export async function getNewPage(browser: Browser) {
  const page = await browser.newPage();

  page.setViewport({
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  });
  page.setExtraHTTPHeaders({
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
    "X-Auth-Token": WK_AUTH_TOKEN,
  });

  return page;
}

// Define the test context type to be compatible with the test files
export interface ScreenshotTestContext extends TestContext {
  browser: Browser;
}

export async function launchBrowser(sessionName?: string): Promise<Browser> {
  let browser: Browser;

  if (USE_LOCAL_CHROME) {
    browser = await puppeteer.launch({
      args: (HEADLESS
        ? [
            "--hide-scrollbars",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--use-angle=gl-egl",
          ]
        : []
      ).concat([`--window-size=${PAGE_WIDTH},${PAGE_HEIGHT}`]),
      headless: HEADLESS,
      dumpio: true,
      executablePath: "/usr/bin/google-chrome", // Linux; this might need to be adapted to your local setup
      // executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // Mac
    });
  } else {
    checkBrowserstackCredentials();

    const caps = {
      browser: "chrome",
      browser_version: "latest",
      os: "os x",
      os_version: "sequoia",
      name: sessionName,
      "browserstack.username": process.env.BROWSERSTACK_USERNAME,
      "browserstack.accessKey": process.env.BROWSERSTACK_ACCESS_KEY,
    };
    browser = await puppeteer.connect({
      browserWSEndpoint: `ws://cdp.browserstack.com/puppeteer?caps=${encodeURIComponent(
        JSON.stringify(caps),
      )}`,
    });
    console.log(`\nBrowserStack Session Id ${await getBrowserstackSessionId(browser)}\n`);
  }

  console.log(`\nRunning chrome version ${await browser.version()}\n`);
  return browser;
}

export async function setupBeforeEach(context: ScreenshotTestContext) {
  context.browser = await launchBrowser(context.task.name);
}

export async function setupAfterEach(context: ScreenshotTestContext) {
  await context.browser.close();
}

async function getBrowserstackSessionId(browser: Browser) {
  const page = await browser.newPage();
  const response = (await page.evaluate(
    (_) => {},
    `browserstack_executor: ${JSON.stringify({ action: "getSessionDetails" })}`,
  )) as unknown as string;

  const sessionDetails = await JSON.parse(response);

  return sessionDetails.hashed_id;
}

export function checkBrowserstackCredentials() {
  if (process.env.BROWSERSTACK_USERNAME == null || process.env.BROWSERSTACK_ACCESS_KEY == null) {
    throw new Error(
      "BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY must be defined as env variables.",
    );
  }
}
