import type { APIAnnotationBookmark, APIBookmarkThumbnailViewport } from "types/api_types";

// Shown for bookmarks without a name.
export const getDefaultBookmarkName = (bookmark: APIAnnotationBookmark) =>
  `Bookmark ${bookmark.id}`;

const THUMBNAIL_VIEWPORT_NAMES: Record<APIBookmarkThumbnailViewport, string> = {
  XY: "XY",
  YZ: "YZ",
  XZ: "XZ",
  TD: "3D",
  FLIGHT: "Flight",
};

export const getThumbnailViewportName = (viewport: APIBookmarkThumbnailViewport) =>
  THUMBNAIL_VIEWPORT_NAMES[viewport];
