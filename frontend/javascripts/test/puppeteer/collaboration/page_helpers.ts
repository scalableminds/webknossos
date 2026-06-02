import fs from "node:fs";
import path from "node:path";
import { sleep } from "libs/utils";
import type { Browser, Page } from "playwright-core";
import { chromium } from "playwright-core";
import {
  updateLayerSettingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import { setHideUnregisteredSegmentsAction } from "viewer/model/actions/volumetracing_actions";
import { HEADLESS, PAGE_HEIGHT, PAGE_WIDTH } from "../screenshot_test_config";
import { BASE_URL, NETWORK_THROTTLE } from "./config";

const LOG_DIR = path.join(__dirname, "logs");
let sessionCounter = 0;

async function waitForTracingViewLoad(page: Page): Promise<void> {
  let inputCatchers;
  let iterationCount = 0;

  while (inputCatchers == null || inputCatchers.length < 4) {
    iterationCount++;
    if (iterationCount > 5) {
      console.log("Waiting suspiciously long for page to load...");
    }
    await sleep(500);
    const inputCatcherPromise = page
      .waitForSelector(".inputcatcher", { timeout: 0 })
      .then(() => page.$$(".inputcatcher"))
      .then((elements) => ({ type: "inputcatchers" as const, elements }));

    const errorPromise = page
      .waitForSelector(".initialization-error-message", { timeout: 0 })
      .then((element) => ({ type: "error" as const, elements: [element] }));

    const raceResult = await Promise.race([inputCatcherPromise, errorPromise]);

    if (raceResult.type === "error") {
      await sleep(1000);
      throw new Error("Initialization error detected");
    }

    inputCatchers = raceResult.elements;
  }
}

export async function getNewPage(authToken: string): Promise<{ page: Page; browser: Browser }> {
  const sessionId = ++sessionCounter;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logStream = fs.createWriteStream(
    path.join(LOG_DIR, `session_${sessionId}_${Date.now()}.log`),
  );
  const log = (line: string) => logStream.write(`${new Date().toISOString()} ${line}\n`);

  // Each page gets its own browser process so Chrome doesn't throttle background tabs.
  const browser = await chromium.launch({
    args: [
      "--hide-scrollbars",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--use-angle=gl-egl",
      `--window-size=${PAGE_WIDTH},${PAGE_HEIGHT}`,
    ],
    headless: HEADLESS,
    executablePath: "/usr/bin/google-chrome",
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  await page.setExtraHTTPHeaders({ "X-Auth-Token": authToken });
  if (NETWORK_THROTTLE != null) {
    const client = await page.context().newCDPSession(page);
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      ...NETWORK_THROTTLE,
    });
  }
  page.on("console", (msg) => log(`[console.${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => log(`[pageerror] ${err.message}\n${err.stack ?? ""}`));
  // One page per browser — close the browser automatically when the page closes.
  page.on("close", () => {
    logStream.end();
    browser.close().catch(() => {});
  });
  return { page, browser };
}

export async function openAnnotationPage(page: Page, annotationId: string): Promise<void> {
  const url = `${BASE_URL}/annotations/${annotationId}`;
  console.log(`Opening annotation at ${url}`);
  await page.goto(url, { timeout: 0 });
  await waitForTracingViewLoad(page);
  console.log("Annotation view loaded");
}

export async function waitForDataLoading(page: Page): Promise<void> {
  await page.evaluate(
    (maxWait) => window.webknossos.DEV.waitForCompletedDataLoading(maxWait),
    60_000,
  );
}

export async function setupPageForProofreading(page: Page): Promise<void> {
  const layers = await page.evaluate(() =>
    window.webknossos.DEV.store
      .getState()
      .dataset.dataSource.dataLayers.map((l: any) => ({ name: l.name, category: l.category })),
  );

  const actions = [
    ...layers
      .filter((l: { name: string; category: string }) => l.category !== "segmentation")
      .map((l: { name: string; category: string }) =>
        updateLayerSettingAction(l.name, "isDisabled", true),
      ),
    ...layers
      .filter((l: { name: string; category: string }) => l.category === "segmentation")
      .map((l: { name: string; category: string }) =>
        updateLayerSettingAction(l.name, "alpha", 100),
      ),
    setHideUnregisteredSegmentsAction(false),
    updateUserSettingAction("selectiveVisibilityInProofreading", false),
  ];

  await page.evaluate((actions) => {
    for (const action of actions) {
      window.webknossos.DEV.store.dispatch(action);
    }
  }, actions);
}

export async function waitForMappingEnabled(page: Page): Promise<void> {
  let enabled = false;
  while (!enabled) {
    await sleep(1_000);
    enabled = await page.evaluate(() =>
      window.webknossos.apiReady().then((api) => api.data.isMappingEnabled()),
    );
  }
}

export function startCollectionOfPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}
