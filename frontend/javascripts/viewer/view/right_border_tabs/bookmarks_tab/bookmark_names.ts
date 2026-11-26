import type { APIViewport } from "types/api_types";

// Shown for bookmarks without a name.
export const DEFAULT_BOOKMARK_NAME = "Unnamed Bookmark";

const THUMBNAIL_VIEWPORT_NAMES: Record<APIViewport, string> = {
  XY: "XY",
  YZ: "YZ",
  XZ: "XZ",
  TD: "3D",
  FLIGHT: "Flight",
};

export const getThumbnailViewportName = (viewport: APIViewport) =>
  THUMBNAIL_VIEWPORT_NAMES[viewport];
