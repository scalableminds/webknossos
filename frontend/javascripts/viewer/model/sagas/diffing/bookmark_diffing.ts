import type { APIAnnotationBookmark } from "types/api_types";
import { diffMetadata } from "viewer/model/sagas/diffing/volume_diffing";
import {
  addBookmark,
  deleteBookmark,
  type UpdateActionWithoutIsolationRequirement,
  updateBookmark,
  updateBookmarkState,
  updateBookmarkThumbnail,
  updateMetadataOfBookmark,
} from "viewer/model/sagas/volume/update_actions";

// Identifies the thumbnail of a bookmark. The local image data (if any) is kept when the
// thumbnail is saved, so that setting the thumbnailVersion afterwards is not a change.
function getThumbnailIdentity(bookmark: APIAnnotationBookmark): string | null {
  return (
    bookmark.largeThumbnailDataBase64 ??
    (bookmark.thumbnailVersion != null ? `v${bookmark.thumbnailVersion}` : null)
  );
}

export function* diffBookmarks(
  prevBookmarks: APIAnnotationBookmark[],
  bookmarks: APIAnnotationBookmark[],
): Generator<UpdateActionWithoutIsolationRequirement, void, void> {
  if (prevBookmarks === bookmarks) return;

  const prevBookmarksById = new Map(prevBookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const bookmarkIds = new Set(bookmarks.map((bookmark) => bookmark.id));

  for (const prevBookmark of prevBookmarks) {
    if (!bookmarkIds.has(prevBookmark.id)) {
      yield deleteBookmark(prevBookmark.id);
    }
  }

  for (const bookmark of bookmarks) {
    const prevBookmark = prevBookmarksById.get(bookmark.id);
    if (prevBookmark == null) {
      yield addBookmark(bookmark);
      continue;
    }
    if (prevBookmark === bookmark) continue;

    if (prevBookmark.name !== bookmark.name) {
      yield updateBookmark(bookmark.id, bookmark.name);
    }
    if (prevBookmark.metadata !== bookmark.metadata) {
      const { upsertEntriesByKey, removeEntriesByKey } = diffMetadata(
        prevBookmark.metadata,
        bookmark.metadata,
      );
      if (upsertEntriesByKey.length > 0 || removeEntriesByKey.length > 0) {
        yield updateMetadataOfBookmark(bookmark.id, upsertEntriesByKey, removeEntriesByKey);
      }
    }
    if (prevBookmark.state !== bookmark.state) {
      yield updateBookmarkState(bookmark.id, bookmark.state);
    }
    const thumbnailIdentity = getThumbnailIdentity(bookmark);
    // A missing thumbnail (e.g. if capturing it failed) does not replace the previous one.
    if (thumbnailIdentity != null && thumbnailIdentity !== getThumbnailIdentity(prevBookmark)) {
      yield updateBookmarkThumbnail(bookmark);
    }
  }
}
