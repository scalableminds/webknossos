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

    const nameChanged = prevBookmark.name !== bookmark.name;
    const descriptionChanged = prevBookmark.description !== bookmark.description;
    if (nameChanged || descriptionChanged) {
      yield updateBookmark(bookmark.id, {
        ...(nameChanged ? { name: bookmark.name } : {}),
        ...(descriptionChanged ? { description: bookmark.description } : {}),
      });
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
    // Also clears the thumbnail on the server if it was removed (e.g. by an undo to a state without
    // one). A failed capture keeps the previous thumbnail in the store and is therefore no change.
    if (bookmark.thumbnailId !== prevBookmark.thumbnailId) {
      yield updateBookmarkThumbnail(bookmark);
    }
  }
}
