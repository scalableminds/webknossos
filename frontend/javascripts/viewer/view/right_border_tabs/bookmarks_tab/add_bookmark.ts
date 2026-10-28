import { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import type { Dispatch } from "redux";
import type { APIAnnotationBookmark } from "types/api_types";
import { urlStateToBookmarkState } from "viewer/controller/bookmark_state";
import UrlManager from "viewer/controller/url_manager";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { ANNOTATION_SCOPED_TRACING_ID, dispatchGetNewIdAsync } from "viewer/model/actions/actions";
import { addBookmarkAction, type BookmarkThumbnail } from "viewer/model/actions/annotation_actions";
import { waitUntilRebaseFinished } from "viewer/model/helpers/bounding_box_creation_helpers";
import Store from "viewer/store";
import { type BookmarkThumbnails, captureBookmarkThumbnails } from "viewer/view/rendering_utils";

export const getCurrentBookmarkState = () =>
  urlStateToBookmarkState(UrlManager.getUrlState(Store.getState()));

export const toUnsavedBookmarkThumbnail = (thumbnails: BookmarkThumbnails): BookmarkThumbnail => ({
  smallThumbnailDataBase64: thumbnails.smallDataBase64,
  largeThumbnailDataBase64: thumbnails.largeDataBase64,
  thumbnailVersion: null,
});

export async function captureThumbnailsSafely(): Promise<BookmarkThumbnails | null> {
  try {
    return await captureBookmarkThumbnails();
  } catch (error) {
    console.error("Could not capture bookmark thumbnails.", error);
    return null;
  }
}

// Used by the bookmarks tab, the keyboard shortcut and the command palette.
// Returns the id of the new bookmark, or null if it could not be created.
export async function addBookmarkForCurrentView(dispatch: Dispatch): Promise<number | null> {
  const state = getCurrentBookmarkState();
  const thumbnails = await captureThumbnailsSafely();
  let id: number;
  try {
    id = await dispatchGetNewIdAsync(dispatch, ANNOTATION_SCOPED_TRACING_ID, "Bookmark");
  } catch (error) {
    handleGenericError(error as Error, "Could not create a new bookmark.");
    return null;
  }
  await waitUntilRebaseFinished();
  const bookmark: APIAnnotationBookmark = {
    id,
    created: Date.now(),
    name: null,
    state,
    createdAtVersion: null,
    metadata: [],
    ...(thumbnails != null
      ? toUnsavedBookmarkThumbnail(thumbnails)
      : { smallThumbnailDataBase64: null, largeThumbnailDataBase64: null, thumbnailVersion: null }),
  };
  // The bookmark diffing (see bookmark_diffing.ts) adds it to the save queue.
  dispatch(addBookmarkAction(bookmark));
  return id;
}

// For the keyboard shortcut and the command palette, which work while the bookmarks tab
// may be hidden, so they confirm the new bookmark with a toast.
export async function addBookmarkForCurrentViewFromAnywhere(dispatch: Dispatch): Promise<void> {
  if (!mayEditAnnotation(Store.getState())) {
    Toast.warning("Bookmarks cannot be added to this annotation.");
    return;
  }
  const id = await addBookmarkForCurrentView(dispatch);
  if (id != null) {
    Toast.success("Added a bookmark for the current view.");
  }
}
