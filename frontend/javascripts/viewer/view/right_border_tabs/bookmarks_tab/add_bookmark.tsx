import ErrorHandling, { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import { getUid } from "libs/uid_generator";
import type { Dispatch } from "redux";
import type { APIAnnotationBookmark } from "types/api_types";
import { urlStateToBookmarkState } from "viewer/controller/bookmark_state";
import UrlManager from "viewer/controller/url_manager";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { ANNOTATION_SCOPED_TRACING_ID, dispatchGetNewIdAsync } from "viewer/model/actions/actions";
import { addBookmarkAction, type BookmarkThumbnail } from "viewer/model/actions/annotation_actions";
import { setBookmarkIdToFocusAction } from "viewer/model/actions/ui_actions";
import { waitUntilRebaseFinished } from "viewer/model/helpers/rebase_helpers";
import Store from "viewer/store";
import { LayoutEvents, layoutEmitter } from "viewer/view/layouting/layout_persistence";
import { type BookmarkThumbnails, captureBookmarkThumbnails } from "viewer/view/rendering_utils";

export const getCurrentBookmarkState = () =>
  urlStateToBookmarkState(UrlManager.getUrlState(Store.getState()));

export const toUnsavedBookmarkThumbnail = (thumbnails: BookmarkThumbnails): BookmarkThumbnail => ({
  smallThumbnailDataBase64: thumbnails.smallDataBase64,
  largeThumbnailDataBase64: thumbnails.largeDataBase64,
  thumbnailSavedAtVersion: null,
  thumbnailViewport: thumbnails.viewport,
  thumbnailId: getUid(),
});

// Capturing is not expected to fail, so a failure aborts the operation instead of leaving
// the bookmark without a (current) thumbnail. Returns undefined in that case and null if no
// viewport is rendered (the bookmark has no thumbnail then).
// For when no viewport is rendered.
export const NO_BOOKMARK_THUMBNAIL: BookmarkThumbnail = {
  smallThumbnailDataBase64: null,
  largeThumbnailDataBase64: null,
  thumbnailSavedAtVersion: null,
  thumbnailViewport: null,
  thumbnailId: null,
};

export async function captureThumbnailsOrNotify(
  failureMessage: string,
): Promise<BookmarkThumbnails | null | undefined> {
  try {
    return await captureBookmarkThumbnails();
  } catch (error) {
    ErrorHandling.notify(error as Error);
    handleGenericError(error as Error, `${failureMessage} Please reload the page and try again.`);
    return undefined;
  }
}

// Used by the bookmarks tab, the keyboard shortcut and the command palette.
// Returns the id of the new bookmark, or null if it could not be created.
export async function addBookmarkForCurrentView(dispatch: Dispatch): Promise<number | null> {
  const state = getCurrentBookmarkState();
  const thumbnails = await captureThumbnailsOrNotify("Could not create the bookmark.");
  if (thumbnails === undefined) return null;
  let id: number;
  try {
    id = await dispatchGetNewIdAsync(dispatch, ANNOTATION_SCOPED_TRACING_ID, "Bookmark");
  } catch (error) {
    handleGenericError(error as Error, "Could not create a new bookmark.");
    return null;
  }
  // While a rebase is running, the save-queue diffing ignores changes and resets its baseline
  // afterwards, so a bookmark added in the meantime would never be saved (see
  // waitUntilRebaseFinished). The reserved id stays valid across the rebase.
  await waitUntilRebaseFinished();
  const bookmark: APIAnnotationBookmark = {
    id,
    created: Date.now(),
    name: null,
    description: null,
    state,
    createdAtVersion: null,
    metadata: [],
    ...(thumbnails != null ? toUnsavedBookmarkThumbnail(thumbnails) : NO_BOOKMARK_THUMBNAIL),
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
  if (id == null) return;
  const toastKey = `bookmark-added-${id}`;
  Toast.success(
    <>
      Added a bookmark for the current view.{" "}
      <a
        onClick={() => {
          Toast.close(toastKey);
          dispatch(setBookmarkIdToFocusAction(id));
          layoutEmitter.emit(LayoutEvents.showBookmarksTab);
        }}
      >
        Show
      </a>
    </>,
    { key: toastKey },
  );
}
