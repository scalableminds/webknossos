import type { APIAnnotationBookmark } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { diffBookmarks } from "viewer/model/sagas/diffing/bookmark_diffing";
import { describe, expect, it } from "vitest";

const savedBookmark: APIAnnotationBookmark = {
  id: 1,
  created: 123,
  name: "Bookmark",
  description: null,
  state: {
    position: [1, 2, 3] as Vector3,
    mode: "orthogonal",
    zoomStep: 1,
    rotation: [0, 0, 0] as Vector3,
    clippingDistance: 50,
    clipSkeletonToCurrentSection: false,
    layers: [],
  },
  createdAtVersion: 3,
  thumbnailVersion: 3,
  thumbnailViewport: null,
  metadata: [],
  smallThumbnailDataBase64: null,
  largeThumbnailDataBase64: null,
};

const unsavedThumbnail = {
  smallThumbnailDataBase64: "small",
  largeThumbnailDataBase64: "large",
  thumbnailVersion: null,
  thumbnailViewport: null,
};

const diff = (prev: APIAnnotationBookmark[], next: APIAnnotationBookmark[]) =>
  Array.from(diffBookmarks(prev, next));

describe("Bookmark diffing", () => {
  it("sends the thumbnails of a new bookmark", () => {
    const bookmark = { ...savedBookmark, ...unsavedThumbnail, createdAtVersion: null };
    const [action] = diff([], [bookmark]);
    expect(action.name).toBe("addBookmark");
    expect(action.value).toMatchObject({
      id: 1,
      largeThumbnailDataBase64: "large",
      smallThumbnailDataBase64: "small",
      thumbnailVersion: null,
      thumbnailViewport: null,
    });
  });

  it("references the saved thumbnails when a deleted bookmark is restored", () => {
    const [action] = diff([], [savedBookmark]);
    expect(action.name).toBe("addBookmark");
    expect(action.value).toMatchObject({
      largeThumbnailDataBase64: null,
      smallThumbnailDataBase64: null,
      thumbnailVersion: 3,
      thumbnailViewport: null,
    });
  });

  it("deletes removed bookmarks", () => {
    expect(diff([savedBookmark], [])).toEqual([{ name: "deleteBookmark", value: { id: 1 } }]);
  });

  it("diffs the name, metadata and state", () => {
    const changed = {
      ...savedBookmark,
      name: null,
      metadata: [{ key: "k", stringValue: "v" }],
      state: { ...savedBookmark.state, zoomStep: 2 },
    };
    expect(diff([savedBookmark], [changed]).map((action) => action.name)).toEqual([
      "updateBookmark",
      "updateMetadataOfBookmark",
      "updateBookmarkState",
    ]);
  });

  it("only sends the changed ones of name and description", () => {
    expect(diff([savedBookmark], [{ ...savedBookmark, description: "Text" }])).toEqual([
      { name: "updateBookmark", value: { id: 1, description: "Text" } },
    ]);
    expect(
      diff([savedBookmark], [{ ...savedBookmark, name: "Other", description: "Text" }]),
    ).toEqual([{ name: "updateBookmark", value: { id: 1, name: "Other", description: "Text" } }]);
    expect(diff([savedBookmark], [{ ...savedBookmark, name: null }])).toEqual([
      { name: "updateBookmark", value: { id: 1, name: null } },
    ]);
  });

  it("sends a switched thumbnail and references a saved one when it is restored", () => {
    const switched = { ...savedBookmark, ...unsavedThumbnail };
    const [switchAction] = diff([savedBookmark], [switched]);
    expect(switchAction.name).toBe("updateBookmarkThumbnail");
    expect(switchAction.value).toMatchObject({ largeThumbnailDataBase64: "large" });

    const [restoreAction] = diff([switched], [savedBookmark]);
    expect(restoreAction.value).toEqual({
      id: 1,
      largeThumbnailDataBase64: null,
      smallThumbnailDataBase64: null,
      thumbnailVersion: 3,
      thumbnailViewport: null,
    });
  });

  it("does not treat saving a thumbnail as a change", () => {
    const unsaved = { ...savedBookmark, ...unsavedThumbnail };
    expect(diff([unsaved], [{ ...unsaved, thumbnailVersion: 4 }])).toEqual([]);
  });

  it("keeps the previous thumbnail if capturing a new one failed", () => {
    const withoutThumbnail = { ...savedBookmark, thumbnailVersion: null };
    expect(diff([savedBookmark], [withoutThumbnail])).toEqual([]);
  });
});
