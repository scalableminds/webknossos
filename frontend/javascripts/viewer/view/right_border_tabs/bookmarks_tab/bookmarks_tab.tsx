import { PlusOutlined } from "@ant-design/icons";
import { getBookmarkThumbnailUrl } from "admin/rest_api";
import { Empty, List, Space } from "antd";
import { handleGenericError } from "libs/error_handling";
import { useWkSelector } from "libs/react_hooks";
import { useCallback, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import type { APIAnnotationBookmark } from "types/api_types";
import { applyBookmarkState } from "viewer/controller/apply_url_state";
import { bookmarkStateToUrlState, urlStateToBookmarkState } from "viewer/controller/bookmark_state";
import UrlManager from "viewer/controller/url_manager";
import { ANNOTATION_SCOPED_TRACING_ID, dispatchGetNewIdAsync } from "viewer/model/actions/actions";
import { addBookmarkAction } from "viewer/model/actions/annotation_actions";
import { pushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import { setViewModeAction } from "viewer/model/actions/settings_actions";
import { waitUntilRebaseFinished } from "viewer/model/helpers/bounding_box_creation_helpers";
import { addBookmark } from "viewer/model/sagas/volume/update_actions";
import Store from "viewer/store";
import { type BookmarkThumbnails, captureBookmarkThumbnails } from "viewer/view/rendering_utils";
import ButtonComponent from "../../components/button_component";

function BookmarkThumbnail({ bookmark }: { bookmark: APIAnnotationBookmark }) {
  const tracingStoreUrl = useWkSelector((state) => state.annotation.tracingStore.url);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const { id, smallThumbnailDataBase64 } = bookmark;

  useEffect(() => {
    if (smallThumbnailDataBase64 != null) return;
    let isCancelled = false;
    getBookmarkThumbnailUrl(tracingStoreUrl, annotationId, id, "small").then((url) => {
      if (!isCancelled) setServerUrl(url);
    });
    return () => {
      isCancelled = true;
    };
  }, [tracingStoreUrl, annotationId, id, smallThumbnailDataBase64]);

  const src =
    smallThumbnailDataBase64 != null
      ? `data:image/webp;base64,${smallThumbnailDataBase64}`
      : serverUrl;
  if (src == null || hasError) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setHasError(true)}
      style={{ maxWidth: 48, maxHeight: 48, display: "block" }}
    />
  );
}

export default function BookmarksTab() {
  const bookmarks = useWkSelector((state) => state.annotation.bookmarks);
  const dispatch = useDispatch();

  const handleAddBookmark = useCallback(async () => {
    const state = urlStateToBookmarkState(UrlManager.getUrlState(Store.getState()));
    let thumbnails: BookmarkThumbnails | null = null;
    try {
      thumbnails = await captureBookmarkThumbnails();
    } catch (error) {
      console.error("Could not capture bookmark thumbnails.", error);
    }
    let id: number;
    try {
      id = await dispatchGetNewIdAsync(dispatch, ANNOTATION_SCOPED_TRACING_ID, "Bookmark");
    } catch (error) {
      handleGenericError(error as Error, "Could not create a new bookmark.");
      return;
    }
    await waitUntilRebaseFinished();
    const bookmark: APIAnnotationBookmark = {
      id,
      created: Date.now(),
      name: null,
      state,
      createdAtVersion: null,
      smallThumbnailDataBase64: thumbnails?.smallDataBase64 ?? null,
    };
    dispatch(addBookmarkAction(bookmark));
    dispatch(
      pushSaveQueueTransaction([addBookmark(bookmark, thumbnails?.largeDataBase64 ?? null)]),
    );
  }, [dispatch]);

  const handleJumpToBookmark = useCallback(
    (bookmark: APIAnnotationBookmark) => {
      const urlState = bookmarkStateToUrlState(bookmark.state);
      // The view mode is not part of applyState and is dispatched separately,
      // mirroring model_initialization.ts.
      applyBookmarkState(urlState, Store.getState().dataset);
      if (urlState.mode != null) {
        dispatch(setViewModeAction(urlState.mode));
      }
    },
    [dispatch],
  );

  return (
    <div className="padded-tab-content" style={{ height: "100%", overflow: "auto" }}>
      <ButtonComponent
        variant="text"
        color="default"
        title="Click to add a bookmark for the current view."
        onClick={handleAddBookmark}
        icon={<PlusOutlined />}
      >
        Add Bookmark
      </ButtonComponent>
      {bookmarks.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="There are no bookmarks yet." />
      ) : (
        <List
          dataSource={bookmarks}
          rowKey="id"
          renderItem={(bookmark) => (
            <List.Item
              onClick={() => handleJumpToBookmark(bookmark)}
              style={{ cursor: "pointer" }}
              title="Click to jump to this bookmark."
            >
              <Space>
                <BookmarkThumbnail bookmark={bookmark} />
                {bookmark.name ?? `Bookmark ${bookmark.id}`}
              </Space>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
