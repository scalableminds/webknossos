import { PlusOutlined } from "@ant-design/icons";
import { Empty, List, Space } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import type { APIAnnotationBookmark } from "types/api_types";
import { applyBookmarkState } from "viewer/controller/apply_url_state";
import { bookmarkStateToUrlState, urlStateToBookmarkState } from "viewer/controller/bookmark_state";
import UrlManager from "viewer/controller/url_manager";
import { addBookmarkAction } from "viewer/model/actions/annotation_actions";
import { pushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import { setViewModeAction } from "viewer/model/actions/settings_actions";
import { max } from "viewer/model/helpers/iterator_utils";
import { addBookmark } from "viewer/model/sagas/volume/update_actions";
import Store from "viewer/store";
import { captureBookmarkThumbnail } from "viewer/view/rendering_utils";
import ButtonComponent from "../../components/button_component";

function getMaximumBookmarkId(bookmarks: APIAnnotationBookmark[]): number {
  return max(bookmarks.values().map((bookmark) => bookmark.id)) ?? 0;
}

export default function BookmarksTab() {
  const bookmarks = useWkSelector((state) => state.annotation.bookmarks);
  const dispatch = useDispatch();

  const handleAddBookmark = useCallback(async () => {
    const state = urlStateToBookmarkState(UrlManager.getUrlState(Store.getState()));
    let thumbnailDataBase64: string | null = null;
    try {
      thumbnailDataBase64 = await captureBookmarkThumbnail();
    } catch (error) {
      console.error("Could not capture bookmark thumbnail.", error);
    }
    // Determine the id only after the await so that concurrently added bookmarks don't collide.
    const bookmark: APIAnnotationBookmark = {
      id: getMaximumBookmarkId(Store.getState().annotation.bookmarks) + 1,
      created: Date.now(),
      name: null,
      state,
      thumbnailDataBase64,
    };
    dispatch(addBookmarkAction(bookmark));
    dispatch(pushSaveQueueTransaction([addBookmark(bookmark)]));
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
                {bookmark.thumbnailDataBase64 != null ? (
                  <img
                    src={`data:image/webp;base64,${bookmark.thumbnailDataBase64}`}
                    alt=""
                    style={{ maxWidth: 48, maxHeight: 48, display: "block" }}
                  />
                ) : null}
                {bookmark.name ?? `Bookmark ${bookmark.id}`}
              </Space>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
