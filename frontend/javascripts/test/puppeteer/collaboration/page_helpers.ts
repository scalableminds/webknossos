import { sleep } from "libs/utils";
import type { Browser, Page } from "puppeteer-core";
import {
  updateLayerSettingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import { setHideUnregisteredSegmentsAction } from "viewer/model/actions/volumetracing_actions";
import { launchBrowser, waitForTracingViewLoad } from "../dataset_rendering_helpers";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../screenshot_test_config";
import { BASE_URL, NETWORK_THROTTLE, WK_AUTH_TOKEN } from "./config";

export async function getNewPage(authToken: string): Promise<{ page: Page; browser: Browser }> {
  // Each page gets its own browser process so Chrome doesn't throttle background tabs.
  const browser = await launchBrowser("Live Collaboration");
  const page = await browser.newPage();
  await page.setViewport({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  await page.setExtraHTTPHeaders({ "X-Auth-Token": authToken });
  if (NETWORK_THROTTLE != null) {
    const client = await page.target().createCDPSession();
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      ...NETWORK_THROTTLE,
    });
  }
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
  page.on("pageerror", (err) => errors.push((err as any).message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}
