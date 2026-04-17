import path from "node:path";

export const SCREENSHOTS_BASE_PATH = path.join(__dirname, "../screenshots");

export const PAGE_WIDTH = 1920;
export const PAGE_HEIGHT = 1080;

export const USE_LOCAL_CHROME = false;
// Only relevant when USE_LOCAL_CHROME. Set to false to actually see the browser open.
export const HEADLESS = true;
