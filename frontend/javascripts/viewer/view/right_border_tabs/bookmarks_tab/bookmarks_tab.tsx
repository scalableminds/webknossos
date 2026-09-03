import { PlusOutlined } from "@ant-design/icons";
import { Empty, List } from "antd";
import { bigIntReplacer } from "libs/bigint_helpers";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import messages from "messages";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import type { APIAnnotationBookmark } from "types/api_types";
import { validateUrlStateJSON } from "types/validation";
import { applyState } from "viewer/controller/apply_url_state";
import UrlManager from "viewer/controller/url_manager";
import { addBookmarkAction } from "viewer/model/actions/annotation_actions";
import { pushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import { setViewModeAction } from "viewer/model/actions/settings_actions";
import { max } from "viewer/model/helpers/iterator_utils";
import { addBookmark } from "viewer/model/sagas/volume/update_actions";
import Store from "viewer/store";
import ButtonComponent from "../../components/button_component";

function getMaximumBookmarkId(bookmarks: APIAnnotationBookmark[]): number {
  return max(bookmarks.values().map((bookmark) => bookmark.id)) ?? 0;
}

export default function BookmarksTab() {
  const bookmarks = useWkSelector((state) => state.annotation.bookmarks);
  const dispatch = useDispatch();

  const handleAddBookmark = useCallback(() => {
    const state = Store.getState();
    const bookmark: APIAnnotationBookmark = {
      id: getMaximumBookmarkId(state.annotation.bookmarks) + 1,
      created: Date.now(),
      name: null,
      stateHash: JSON.stringify(UrlManager.getUrlState(state), bigIntReplacer),
    };
    dispatch(addBookmarkAction(bookmark));
    dispatch(pushSaveQueueTransaction([addBookmark(bookmark)]));
  }, [dispatch]);

  const handleJumpToBookmark = useCallback(
    (bookmark: APIAnnotationBookmark) => {
      let urlState: ReturnType<typeof validateUrlStateJSON>;
      try {
        urlState = validateUrlStateJSON(bookmark.stateHash);
      } catch (e) {
        Toast.error(messages["tracing.invalid_json_url_hash"]);
        console.error(e);
        return;
      }
      // applyState covers everything a fresh page load with this JSON in the URL hash would
      // apply (position, rotation, zoom, tdCamera, per-layer settings, meshes, ...) except the
      // view mode, which -- mirroring model_initialization.ts's own initial-load handling -- is
      // dispatched separately.
      applyState(urlState, false, Store.getState().dataset);
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
              {bookmark.name ?? `Bookmark ${bookmark.id}`}
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
