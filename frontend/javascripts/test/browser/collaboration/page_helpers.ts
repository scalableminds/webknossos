import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
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
fs.rmSync(LOG_DIR, { recursive: true, force: true });
fs.mkdirSync(LOG_DIR, { recursive: true });
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
  const logFile = path.join(LOG_DIR, `session_${sessionId}_${Date.now()}.log`);
  const log = (line: string) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);

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
  await page.route("**/api.airbrake.io/**", async (route) => {
    // We swallow requests to airbrake to circumvent this error:
    // Request header field x-auth-token is not allowed by Access-Control-Allow-Headers in preflight response.
    const body = route.request().postData();
    log(`[airbrake] swallowed request to ${route.request().url()} — payload: ${body ?? "<empty>"}`);
    await route.fulfill({ status: 200, body: "{}" });
  });
  page.on("console", async (msg) => {
    const args = await Promise.all(
      msg.args().map((arg) => arg.jsonValue().catch(() => arg.toString())),
    );
    const text = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    log(`[console.${msg.type()}] ${text}`);
  });
  page.on("pageerror", (err) => log(`[pageerror] ${err.message}\n${err.stack ?? ""}`));
  // One page per browser — close the browser automatically when the page closes.
  page.on("close", () => {
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

function decodeRequestBody(buffer: Buffer | null): string {
  if (buffer == null) return "<empty>";
  try {
    // The save saga gzip-compresses the payload in production (magic bytes 1f 8b).
    const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
    const decoded = isGzip ? zlib.gunzipSync(buffer) : buffer;
    return JSON.stringify(JSON.parse(decoded.toString("utf-8")), null, 2);
  } catch {
    return `<binary ${buffer.byteLength}B: ${buffer.subarray(0, 64).toString("hex")}>`;
  }
}

export type UpdateRequestEntry = { timestamp: number; body: string };

export function trackAnnotationUpdateRequests(
  page: Page,
  annotationId: string,
): (sinceMs: number) => UpdateRequestEntry[] {
  const captured: UpdateRequestEntry[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      req.url().includes(`/tracings/annotation/${annotationId}/update`)
    ) {
      captured.push({ timestamp: Date.now(), body: decodeRequestBody(req.postDataBuffer()) });
    }
  });
  return (sinceMs: number) => captured.filter((r) => r.timestamp >= sinceMs);
}

export async function waitUntilNotBusy(page: Page): Promise<void> {
  const startTime = Date.now();
  while (
    await page.evaluate(
      () =>
        window.webknossos.DEV.store.getState().operationContext.activeOperations.length > 0,
    )
  ) {
    await sleep(1_000);
  }
  const totalWait = Date.now() - startTime;
  if (totalWait > 1_000) {
    console.log(`Waited ${totalWait}ms for busy state to clear`);
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
