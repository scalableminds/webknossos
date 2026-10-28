import {
  getFlattenedUpdateActions,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import type { APIAnnotationBookmark } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  addBookmarkAction,
  deleteBookmarkAction,
  setBookmarkNameAction,
} from "viewer/model/actions/annotation_actions";
import { dispatchRedoAsync, dispatchUndoAsync } from "viewer/model/actions/save_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import Store from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const bookmark: APIAnnotationBookmark = {
  id: 1,
  created: 123,
  name: null,
  state: {
    position: [1, 2, 3] as Vector3,
    mode: "orthogonal",
    zoomStep: 1,
    rotation: [0, 0, 0] as Vector3,
    clippingDistance: 50,
    clipSkeletonToCurrentSection: false,
    layers: [],
  },
  createdAtVersion: null,
  thumbnailVersion: null,
  metadata: [],
  smallThumbnailDataBase64: "small",
  largeThumbnailDataBase64: "large",
};

const getBookmarkUpdateActions = (context: WebknossosTestContext) =>
  getFlattenedUpdateActions(context).filter((action) => action.name.includes("Bookmark"));

describe("Bookmark undo", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    expect(hasRootSagaCrashed()).toBe(false);
    context.tearDownPullQueues();
  });

  it<WebknossosTestContext>("undoes and redoes adding, renaming and deleting bookmarks", async (context) => {
    Store.dispatch(addBookmarkAction(bookmark));
    Store.dispatch(setBookmarkNameAction(1, "Name"));
    Store.dispatch(deleteBookmarkAction(1));
    expect(Store.getState().annotation.bookmarks).toEqual([]);

    await dispatchUndoAsync(Store.dispatch);
    expect(Store.getState().annotation.bookmarks.map((b) => b.name)).toEqual(["Name"]);
    await dispatchUndoAsync(Store.dispatch);
    expect(Store.getState().annotation.bookmarks.map((b) => b.name)).toEqual([null]);
    await dispatchUndoAsync(Store.dispatch);
    expect(Store.getState().annotation.bookmarks).toEqual([]);
    await dispatchRedoAsync(Store.dispatch);
    expect(Store.getState().annotation.bookmarks.map((b) => b.name)).toEqual([null]);

    await context.api.tracing.save();
    expect(getBookmarkUpdateActions(context).map((action) => action.name)).toEqual([
      "addBookmark",
      "updateBookmark",
      "deleteBookmark",
      // Undoing the deletion restores the bookmark with its thumbnails.
      "addBookmark",
      "updateBookmark",
      "deleteBookmark",
      "addBookmark",
    ]);
  });
});
