import type { APIAnnotationBookmark } from "types/api_types";

// Shown for bookmarks without a name.
export const getDefaultBookmarkName = (bookmark: APIAnnotationBookmark) =>
  `Bookmark ${bookmark.id}`;
