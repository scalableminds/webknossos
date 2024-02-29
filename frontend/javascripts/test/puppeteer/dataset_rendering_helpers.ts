/* eslint no-await-in-loop: 0 */
import urljoin from "url-join";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'node... Remove this comment to see the full error message
import fetch, { Headers, Request, Response, FetchError } from "node-fetch";
import type { Browser } from "puppeteer";
import type { TestInterface } from "ava";
import anyTest from "ava";
import type { PartialDatasetConfiguration } from "oxalis/store";
import type { Page } from "puppeteer";
import mergeImg from "merge-img";
import pixelmatch from "pixelmatch";
import { RequestOptions } from "libs/request";
import { bufferToPng, isPixelEquivalent } from "./screenshot_helpers";
import type { APIDatasetId } from "../../types/api_flow_types";
import { createExplorational, updateDatasetConfiguration } from "../../admin/admin_rest_api";
import puppeteer from "puppeteer";
import { sleep } from "libs/utils";

export const { WK_AUTH_TOKEN } = process.env;

type Screenshot = {
  screenshot: Buffer;
  width: number;
  height: number;
};

function getDefaultRequestOptions(baseUrl: string): RequestOptions {
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

export async function screenshotDataset(
  page: Page,
  baseUrl: string,
  datasetId: APIDatasetId,
  optionalViewOverride?: string | null | undefined,
  optionalDatasetConfigOverride?: PartialDatasetConfiguration | null | undefined,
): Promise<Screenshot> {
  return _screenshotAnnotationHelper(
    page,
    baseUrl,
    datasetId,
    "skeleton",
    null,
    optionalViewOverride,
    optionalDatasetConfigOverride,
  );
}

export async function screenshotAnnotation(
  page: Page,
  baseUrl: string,
  datasetId: APIDatasetId,
  fallbackLayerName: string | null,
  optionalViewOverride?: string | null | undefined,
  optionalDatasetConfigOverride?: PartialDatasetConfiguration | null | undefined,
): Promise<Screenshot> {
  return _screenshotAnnotationHelper(
    page,
    baseUrl,
    datasetId,
    "hybrid",
    fallbackLayerName,
    optionalViewOverride,
    optionalDatasetConfigOverride,
  );
}

async function _screenshotAnnotationHelper(
  page: Page,
  baseUrl: string,
  datasetId: APIDatasetId,
  typ: "skeleton" | "volume" | "hybrid",
  fallbackLayerName: string | null,
  optionalViewOverride?: string | null | undefined,
  optionalDatasetConfigOverride?: PartialDatasetConfiguration | null | undefined,
): Promise<Screenshot> {
  const options = getDefaultRequestOptions(baseUrl);
  const createdExplorational = await createExplorational(
    datasetId,
    typ,
    false,
    fallbackLayerName,
    null,
    null,
    options,
  );

  if (optionalDatasetConfigOverride != null) {
    await updateDatasetConfiguration(datasetId, optionalDatasetConfigOverride, options);
  }

  await openTracingView(page, baseUrl, createdExplorational.id, optionalViewOverride);
  return screenshotTracingView(page);
}

export async function screenshotDatasetView(
  page: Page,
  baseUrl: string,
  datasetId: APIDatasetId,
  optionalViewOverride?: string | null | undefined,
): Promise<Screenshot> {
  const url = `${baseUrl}/datasets/${datasetId.owningOrganization}/${datasetId.name}`;

  await openDatasetView(page, url, optionalViewOverride);
  return screenshotTracingView(page);
}

export async function screenshotDatasetWithMapping(
  page: Page,
  baseUrl: string,
  datasetId: APIDatasetId,
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
  datasetId: APIDatasetId,
  optionalViewOverride: string | null | undefined,
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
  await openTracingView(page, baseUrl, createdExplorational.id, optionalViewOverride);
  await waitForMappingEnabled(page);
  return screenshotTracingView(page);
}
export async function screenshotSandboxWithMappingLink(
  page: Page,
  baseUrl: string,
  datasetId: APIDatasetId,
  optionalViewOverride: string | null | undefined,
): Promise<Screenshot> {
  await openSandboxView(page, baseUrl, datasetId, optionalViewOverride);
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

async function waitForTracingViewLoad(page: Page) {
  let inputCatchers;

  // @ts-expect-error ts-migrate(2339) FIXME: Property 'length' does not exist on type 'ElementH... Remove this comment to see the full error message
  while (inputCatchers == null || inputCatchers.length < 4) {
    await sleep(500);
    inputCatchers = await page.$(".inputcatcher");
  }
}

async function waitForRenderingFinish(page: Page) {
  const width = 1920;
  const height = 1080;
  let currentShot;
  let lastShot = await page.screenshot({
    fullPage: true,
  });
  let changedPixels = Infinity;

  // If the screenshot of the page didn't change in the last x seconds, rendering should be finished
  while (currentShot == null || !isPixelEquivalent(changedPixels, width, height)) {
    console.log(`Waiting for rendering to finish. Changed pixels: ${changedPixels}`);
    await sleep(20000);
    currentShot = await page.screenshot({
      fullPage: true,
    });

    if (lastShot != null) {
      changedPixels = pixelmatch(
        // The buffers need to be converted to png before comparing them
        // as they might have different lengths, otherwise (probably due to different png encodings)
        (await bufferToPng(lastShot, width, height)).data,
        (await bufferToPng(currentShot, width, height)).data,
        null,
        width,
        height,
        {
          threshold: 0.0,
        },
      );
    }

    lastShot = currentShot;
  }
}

async function openTracingView(
  page: Page,
  baseUrl: string,
  annotationId: string,
  optionalViewOverride?: string | null | undefined,
) {
  const urlSlug = optionalViewOverride != null ? `#${optionalViewOverride}` : "";
  const url = urljoin(baseUrl, `/annotations/${annotationId}${urlSlug}`);
  console.log(`Opening annotation view at ${url}`);
  await page.goto(url, {
    timeout: 0,
  });
  await waitForTracingViewLoad(page);
  console.log("Loaded annotation view");
  await waitForRenderingFinish(page);
  console.log("Finished rendering annotation view");
}

async function openDatasetView(
  page: Page,
  baseUrl: string,
  optionalViewOverride?: string | null | undefined,
) {
  const urlSlug = optionalViewOverride != null ? `#${optionalViewOverride}` : "";
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
  datasetId: APIDatasetId,
  optionalViewOverride: string | null | undefined,
) {
  const urlSlug = optionalViewOverride != null ? `#${optionalViewOverride}` : "";
  const url = urljoin(
    baseUrl,
    `/datasets/${datasetId.owningOrganization}/${datasetId.name}/sandbox/skeleton${urlSlug}`,
  );
  console.log(`Opening sandbox annotation view at ${url}`);
  await page.goto(url, {
    timeout: 0,
  });
  await waitForTracingViewLoad(page);
  console.log("Loaded annotation view");
  await waitForRenderingFinish(page);
  console.log("Finished rendering annotation view");
}

async function screenshotTracingView(page: Page): Promise<Screenshot> {
  console.log("Screenshot annotation view");
  // Take screenshots of the other rendered planes
  const PLANE_IDS = [
    "#screenshot_target_inputcatcher_TDView",
    "#screenshot_target_inputcatcher_PLANE_XY",
    "#screenshot_target_inputcatcher_PLANE_YZ",
    "#screenshot_target_inputcatcher_PLANE_XZ",
  ];
  const screenshots = [];

  for (const planeId of PLANE_IDS) {
    const element = await page.$(planeId);
    if (element == null)
      throw new Error(`Element ${planeId} not present, although page is loaded.`);
    const screenshot = await element.screenshot();
    screenshots.push(screenshot);
  }

  // Concatenate all screenshots
  const img = await mergeImg(screenshots);
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
    width: 1920,
    height: 1080,
  });
  page.setExtraHTTPHeaders({
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
    "X-Auth-Token": WK_AUTH_TOKEN,
  });
  return page;
}

export async function withRetry(
  retryCount: number,
  testFn: () => Promise<boolean>,
  resolveFn: (arg0: boolean) => void,
) {
  retryCount = 3;
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

// Ava's recommendation for Typescript types
// https://github.com/avajs/ava/blob/main/docs/recipes/typescript.md#typing-tcontext
export const test: TestInterface<{
  browser: Browser;
}> = anyTest as any;

export function setupBeforeEachAndAfterEach() {
  test.beforeEach(async (t) => {
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

    const caps = {
      browser: "chrome",
      browser_version: "latest",
      os: "os x",
      os_version: "mojave",
      "browserstack.username": process.env.BROWSERSTACK_USERNAME,
      "browserstack.accessKey": process.env.BROWSERSTACK_ACCESS_KEY,
    };
    t.context.browser = await puppeteer.connect({
      browserWSEndpoint: `ws://cdp.browserstack.com/puppeteer?caps=${encodeURIComponent(
        JSON.stringify(caps),
      )}`,
    });

    console.log(`\nRunning chrome version ${await t.context.browser.version()}\n`);
    global.Headers = Headers;
    global.fetch = fetch;
    global.Request = Request;
    global.Response = Response;
    // @ts-expect-error ts-migrate(7017) FIXME: Element implicitly has an 'any' type because type ... Remove this comment to see the full error message
    global.FetchError = FetchError;
  });

  test.afterEach.always(async (t) => {
    await t.context.browser.close();
  });
}

export function checkBrowserstackCredentials() {
  if (process.env.BROWSERSTACK_USERNAME == null || process.env.BROWSERSTACK_ACCESS_KEY == null) {
    throw new Error(
      "BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY must be defined as env variables.",
    );
  }
}

export default {};
