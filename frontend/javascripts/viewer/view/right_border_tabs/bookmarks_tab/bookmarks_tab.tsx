import Icon, {
  AimOutlined,
  DeleteOutlined,
  EditOutlined,
  PictureOutlined,
  PlusOutlined,
  RollbackOutlined,
  SearchOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import MeshIcon from "@images/icons/icon-mesh-organic-boundary.svg?react";
import { getBookmarkThumbnailUrl } from "admin/rest_api";
import { Divider, Empty, Flex, List, type MenuProps, Space, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import FormattedDate from "components/formatted_date";
import { SimpleRow } from "dashboard/folders/metadata_table";
import { handleGenericError } from "libs/error_handling";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import { map3, roundTo } from "libs/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type {
  APIAnnotationBookmark,
  APIAnnotationBookmarkState,
  MetadataEntryProto,
} from "types/api_types";
import { applyBookmarkState } from "viewer/controller/apply_url_state";
import { bookmarkStateToUrlState, urlStateToBookmarkState } from "viewer/controller/bookmark_state";
import UrlManager from "viewer/controller/url_manager";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import { ANNOTATION_SCOPED_TRACING_ID, dispatchGetNewIdAsync } from "viewer/model/actions/actions";
import {
  addBookmarkAction,
  deleteBookmarkAction,
  setBookmarkMetadataAction,
  setBookmarkNameAction,
  setBookmarkStateAction,
  setBookmarkThumbnailAction,
} from "viewer/model/actions/annotation_actions";
import { pushSaveQueueTransaction } from "viewer/model/actions/save_actions";
import { setViewModeAction } from "viewer/model/actions/settings_actions";
import { waitUntilRebaseFinished } from "viewer/model/helpers/bounding_box_creation_helpers";
import { diffMetadata } from "viewer/model/sagas/diffing/volume_diffing";
import {
  addBookmark,
  deleteBookmark,
  updateBookmark,
  updateBookmarkState,
  updateBookmarkThumbnail,
  updateMetadataOfBookmark,
} from "viewer/model/sagas/volume/update_actions";
import Store, { type WebknossosState } from "viewer/store";
import { positionToString } from "viewer/view/context_menu/helpers";
import { type BookmarkThumbnails, captureBookmarkThumbnails } from "viewer/view/rendering_utils";
import ButtonComponent from "../../components/button_component";
import { InputWithUpdateOnBlur } from "../../components/input_with_update_on_blur";
import AdvancedSearchPopover from "../advanced_search_popover";
import { MetadataEntryTableRows } from "../metadata_table";
import { ResizableSplitPane } from "../resizable_split_pane";
import { InlineEditableName } from "../shared/inline_editable_name";
import { HOVER_ONLY_CLASS, MoreActionsButton, RowActionButton } from "../shared/list_row";
import { useTreeContextMenu } from "../shared/use_tree_context_menu";
import { ContextMenuContainer } from "../sidebar_context_menu";
import { SwitchThumbnailModal } from "./switch_thumbnail_modal";

const THUMBNAIL_BOX_SIZE = 48;
// Centers a single-line name and its details line next to the thumbnail.
const NAME_PADDING_TOP = 3;

const SWITCH_THUMBNAIL_BUTTON_SIZE = 20;

function BookmarkThumbnail({
  bookmark,
  onSwitchThumbnail,
}: {
  bookmark: APIAnnotationBookmark;
  // Shows a button to switch the thumbnail if set.
  onSwitchThumbnail?: () => void;
}) {
  const tracingStoreUrl = useWkSelector((state) => state.annotation.tracingStore.url);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const { id, thumbnailVersion, smallThumbnailDataBase64 } = bookmark;

  useEffect(() => {
    // Unsaved thumbnails are not on the server yet.
    if (smallThumbnailDataBase64 != null || thumbnailVersion == null) return;
    let isCancelled = false;
    getBookmarkThumbnailUrl(tracingStoreUrl, annotationId, id, thumbnailVersion, "small").then(
      (url) => {
        if (!isCancelled) setServerUrl(url);
      },
    );
    return () => {
      isCancelled = true;
    };
  }, [tracingStoreUrl, annotationId, id, thumbnailVersion, smallThumbnailDataBase64]);

  const src =
    smallThumbnailDataBase64 != null
      ? `data:image/webp;base64,${smallThumbnailDataBase64}`
      : serverUrl;

  // A switched thumbnail may load where the previous one failed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset whenever the source changes.
  useEffect(() => setHasError(false), [src]);
  // A square box, so that thumbnails of different aspect ratios line up.
  return (
    <Flex
      align="center"
      justify="center"
      style={{
        width: THUMBNAIL_BOX_SIZE,
        height: THUMBNAIL_BOX_SIZE,
        flex: "none",
        position: "relative",
      }}
    >
      {src == null || hasError ? null : (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setHasError(true)}
          style={{
            maxWidth: THUMBNAIL_BOX_SIZE,
            maxHeight: THUMBNAIL_BOX_SIZE,
            display: "block",
            borderRadius: "var(--ant-border-radius-sm)",
          }}
        />
      )}
      {onSwitchThumbnail != null ? (
        <ButtonComponent
          size="small"
          title="Switch thumbnail"
          icon={<PictureOutlined />}
          onClick={(event) => {
            // Must not also select the row.
            event.stopPropagation();
            onSwitchThumbnail();
          }}
          style={{
            position: "absolute",
            right: -SWITCH_THUMBNAIL_BUTTON_SIZE / 4,
            bottom: -SWITCH_THUMBNAIL_BUTTON_SIZE / 4,
            width: SWITCH_THUMBNAIL_BUTTON_SIZE,
            height: SWITCH_THUMBNAIL_BUTTON_SIZE,
            minWidth: SWITCH_THUMBNAIL_BUTTON_SIZE,
            padding: 0,
          }}
        />
      ) : null}
    </Flex>
  );
}

const BOOKMARKS_TAB_ID = "bookmarks-tab";
const CONTEXT_MENU_CLASS = "bookmark-list-context-menu-overlay";

// The camera part of the view, rounded like in the url. A selected bookmark is
// deselected once this changes, because it no longer matches the current view.
function getViewKey(state: WebknossosState): string {
  const { flycam } = state;
  const { position, up, left, right, top, bottom } = state.viewModeData.plane.tdCamera;
  return JSON.stringify([
    V3.floor(getPosition(flycam)),
    roundTo(flycam.zoomStep, 3),
    map3((e) => roundTo(e, 2), flycam.rotation),
    flycam.additionalCoordinates,
    state.temporaryConfiguration.viewMode,
    [...position, ...up, left, right, top, bottom].map((e) => roundTo(e, 2)),
  ]);
}

const getCurrentBookmarkState = () =>
  urlStateToBookmarkState(UrlManager.getUrlState(Store.getState()));

function BookmarkDetailsLine({ bookmark }: { bookmark: APIAnnotationBookmark }) {
  const meshCount = bookmark.state.layers.reduce((sum, layer) => sum + layer.meshes.length, 0);
  const icons = [
    meshCount > 0 ? (
      <FastTooltip
        key="meshes"
        title={`This bookmark shows ${meshCount} ${meshCount === 1 ? "mesh" : "meshes"}.`}
      >
        <Icon component={MeshIcon} />
      </FastTooltip>
    ) : null,
    bookmark.metadata.length > 0 ? (
      <FastTooltip key="metadata" title="This bookmark has assigned metadata properties.">
        <TagsOutlined />
      </FastTooltip>
    ) : null,
  ].filter((icon) => icon != null);
  return (
    <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
      {icons.length > 0 ? (
        <>
          <Space size={4}>{icons}</Space> ·{" "}
        </>
      ) : null}
      <FormattedDate timestamp={bookmark.created} /> ·{" "}
      {positionToString(bookmark.state.position, bookmark.state.additionalCoordinates)}
    </Typography.Text>
  );
}

async function captureThumbnailsSafely(): Promise<BookmarkThumbnails | null> {
  try {
    return await captureBookmarkThumbnails();
  } catch (error) {
    console.error("Could not capture bookmark thumbnails.", error);
    return null;
  }
}

const getDefaultBookmarkName = (bookmark: APIAnnotationBookmark) => `Bookmark ${bookmark.id}`;

function useRenameBookmark() {
  const dispatch = useDispatch();
  return useCallback(
    async (bookmark: APIAnnotationBookmark, newName: string) => {
      // An empty name clears it, so that the default name is shown.
      const name = newName.trim() === "" ? null : newName;
      if (name === bookmark.name) return;
      await waitUntilRebaseFinished();
      dispatch(setBookmarkNameAction(bookmark.id, name));
      dispatch(pushSaveQueueTransaction([updateBookmark(bookmark.id, name)]));
    },
    [dispatch],
  );
}

function BookmarkDetails({ bookmark }: { bookmark: APIAnnotationBookmark }) {
  const dispatch = useDispatch();
  const readOnly = !useWkSelector(mayEditAnnotation);
  const renameBookmark = useRenameBookmark();

  const setMetadata = useCallback(
    async (updatedBookmark: APIAnnotationBookmark, newMetadata: MetadataEntryProto[]) => {
      const { upsertEntriesByKey, removeEntriesByKey } = diffMetadata(
        updatedBookmark.metadata,
        newMetadata,
      );
      if (upsertEntriesByKey.length === 0 && removeEntriesByKey.length === 0) return;
      await waitUntilRebaseFinished();
      dispatch(setBookmarkMetadataAction(updatedBookmark.id, newMetadata));
      dispatch(
        pushSaveQueueTransaction([
          updateMetadataOfBookmark(updatedBookmark.id, upsertEntriesByKey, removeEntriesByKey),
        ]),
      );
    },
    [dispatch],
  );

  return (
    <table className="metadata-table">
      <thead>
        <SimpleRow isTableHead label="ID" value={bookmark.id} />
      </thead>
      <tbody>
        <SimpleRow
          label="Name"
          value={
            <InputWithUpdateOnBlur
              value={bookmark.name ?? ""}
              placeholder={getDefaultBookmarkName(bookmark)}
              onChange={(newName) => renameBookmark(bookmark, newName)}
              disabled={readOnly}
            />
          }
        />
        <MetadataEntryTableRows item={bookmark} setMetadata={setMetadata} readOnly={readOnly} />
      </tbody>
    </table>
  );
}

export default function BookmarksTab() {
  const bookmarks = useWkSelector((state) => state.annotation.bookmarks);
  const dispatch = useDispatch();
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<number | null>(null);
  const [renamingBookmarkId, setRenamingBookmarkId] = useState<number | null>(null);
  const [switchingThumbnailOfBookmarkId, setSwitchingThumbnailOfBookmarkId] = useState<
    number | null
  >(null);
  const readOnly = !useWkSelector(mayEditAnnotation);
  const renameBookmark = useRenameBookmark();
  const selectedBookmark = bookmarks.find((bookmark) => bookmark.id === selectedBookmarkId);
  const switchingThumbnailBookmark = bookmarks.find(
    (bookmark) => bookmark.id === switchingThumbnailOfBookmarkId,
  );
  // The view before jumping to the first of a series of bookmarks.
  const [previousView, setPreviousView] = useState<APIAnnotationBookmarkState | null>(null);
  const { contextMenuPosition, contextMenu, openContextMenu, hideContextMenu } =
    useTreeContextMenu(CONTEXT_MENU_CLASS);
  const viewKey = useWkSelector(getViewKey);
  const viewKeyOfSelectionRef = useRef<string | null>(null);

  const selectBookmark = useCallback((bookmarkId: number) => {
    setSelectedBookmarkId(bookmarkId);
    viewKeyOfSelectionRef.current = getViewKey(Store.getState());
  }, []);

  // Moving the camera away from the bookmark discards the selection and the previous view.
  useEffect(() => {
    if (
      (selectedBookmarkId != null || previousView != null) &&
      viewKey !== viewKeyOfSelectionRef.current
    ) {
      setSelectedBookmarkId(null);
      setPreviousView(null);
    }
  }, [viewKey, selectedBookmarkId, previousView]);

  const applyView = useCallback(
    (bookmarkState: APIAnnotationBookmarkState) => {
      const urlState = bookmarkStateToUrlState(bookmarkState);
      // The view mode is not part of applyState and is dispatched separately,
      // mirroring model_initialization.ts.
      applyBookmarkState(urlState, Store.getState().dataset);
      if (urlState.mode != null) {
        dispatch(setViewModeAction(urlState.mode));
      }
    },
    [dispatch],
  );

  const handleAddBookmark = useCallback(async () => {
    const state = getCurrentBookmarkState();
    const thumbnails = await captureThumbnailsSafely();
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
      thumbnailVersion: null,
      metadata: [],
      smallThumbnailDataBase64: thumbnails?.smallDataBase64 ?? null,
    };
    dispatch(addBookmarkAction(bookmark));
    // Nudge users to name the new bookmark.
    selectBookmark(id);
    setPreviousView(null);
    setRenamingBookmarkId(id);
    dispatch(
      pushSaveQueueTransaction([addBookmark(bookmark, thumbnails?.largeDataBase64 ?? null)]),
    );
  }, [dispatch, selectBookmark]);

  const handleSelectBookmark = useCallback(
    (bookmark: APIAnnotationBookmark) => {
      const currentView = getCurrentBookmarkState();
      setPreviousView((view) => view ?? currentView);
      applyView(bookmark.state);
      // After the jump, so that the view of the bookmark is remembered.
      selectBookmark(bookmark.id);
    },
    [applyView, selectBookmark],
  );

  const handleBackToPreviousView = useCallback(() => {
    if (previousView == null) return;
    applyView(previousView);
    setSelectedBookmarkId(null);
    setPreviousView(null);
  }, [applyView, previousView]);

  const handleUpdateBookmarkToCurrentView = useCallback(
    async (bookmarkId: number) => {
      const state = getCurrentBookmarkState();
      const thumbnails = await captureThumbnailsSafely();
      await waitUntilRebaseFinished();
      const smallThumbnailDataBase64 = thumbnails?.smallDataBase64 ?? null;
      dispatch(setBookmarkStateAction(bookmarkId, state, smallThumbnailDataBase64, null));
      dispatch(
        pushSaveQueueTransaction([
          updateBookmarkState(
            bookmarkId,
            state,
            thumbnails?.largeDataBase64 ?? null,
            smallThumbnailDataBase64,
          ),
        ]),
      );
      // The bookmark matches the current view now.
      selectBookmark(bookmarkId);
    },
    [dispatch, selectBookmark],
  );

  const handleSwitchThumbnail = useCallback(
    async (bookmarkId: number, thumbnails: BookmarkThumbnails) => {
      setSwitchingThumbnailOfBookmarkId(null);
      await waitUntilRebaseFinished();
      dispatch(setBookmarkThumbnailAction(bookmarkId, thumbnails.smallDataBase64, null));
      dispatch(
        pushSaveQueueTransaction([
          updateBookmarkThumbnail(
            bookmarkId,
            thumbnails.largeDataBase64,
            thumbnails.smallDataBase64,
          ),
        ]),
      );
    },
    [dispatch],
  );

  const handleDeleteBookmark = useCallback(
    async (bookmarkId: number) => {
      await waitUntilRebaseFinished();
      dispatch(deleteBookmarkAction(bookmarkId));
      dispatch(pushSaveQueueTransaction([deleteBookmark(bookmarkId)]));
      setSelectedBookmarkId((selectedId) => (selectedId === bookmarkId ? null : selectedId));
    },
    [dispatch],
  );

  const getContextMenu = (bookmark: APIAnnotationBookmark): MenuProps => {
    const runAndHide = (action: () => void) => () => {
      action();
      hideContextMenu();
    };
    return {
      items: [
        {
          key: "renameBookmark",
          icon: <EditOutlined />,
          label: "Rename Bookmark",
          onClick: runAndHide(() => setRenamingBookmarkId(bookmark.id)),
        },
        {
          key: "updateBookmarkToCurrentView",
          // A selected bookmark matches the current view (it is deselected once the view changes).
          disabled: bookmark.id === selectedBookmarkId,
          icon: <AimOutlined />,
          label:
            bookmark.id === selectedBookmarkId ? (
              <FastTooltip title="The bookmark already matches the current view.">
                Update Bookmark to Current View
              </FastTooltip>
            ) : (
              "Update Bookmark to Current View"
            ),
          onClick: runAndHide(() => handleUpdateBookmarkToCurrentView(bookmark.id)),
        },
        {
          key: "switchThumbnail",
          // The thumbnail is taken from the current view, which has to be the one of the bookmark.
          disabled: bookmark.id !== selectedBookmarkId,
          icon: <PictureOutlined />,
          label:
            bookmark.id === selectedBookmarkId ? (
              "Switch Thumbnail"
            ) : (
              <FastTooltip title="Click the bookmark first, so that the current view matches it.">
                Switch Thumbnail
              </FastTooltip>
            ),
          onClick: runAndHide(() => setSwitchingThumbnailOfBookmarkId(bookmark.id)),
        },
      ],
    };
  };

  return (
    <div
      id={BOOKMARKS_TAB_ID}
      className="padded-tab-content"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Space>
        <AdvancedSearchPopover
          data={bookmarks}
          onSelect={handleSelectBookmark}
          searchKey={(bookmark) => bookmark.name ?? getDefaultBookmarkName(bookmark)}
          provideShortcut
          targetId={BOOKMARKS_TAB_ID}
        >
          <ButtonComponent
            icon={<SearchOutlined />}
            title="Open search via CTRL + Shift + F"
            variant="text"
            color="default"
          />
        </AdvancedSearchPopover>
        {/* Read-only annotations only allow jumping to the bookmarks. */}
        {readOnly ? null : (
          <>
            <ButtonComponent
              variant="text"
              color="default"
              title="Click to add a bookmark for the current view."
              onClick={handleAddBookmark}
              icon={<PlusOutlined />}
            />
            <ButtonComponent
              disabled={selectedBookmark == null}
              variant="text"
              color="default"
              title="Delete selected bookmark"
              onClick={() => selectedBookmark != null && handleDeleteBookmark(selectedBookmark.id)}
              icon={<DeleteOutlined />}
            />
          </>
        )}
        <ButtonComponent
          disabled={previousView == null}
          variant="text"
          color="default"
          title="Back to the view before jumping to a bookmark"
          onClick={handleBackToPreviousView}
          icon={<RollbackOutlined />}
        />
      </Space>
      <Divider size="small" />
      <ContextMenuContainer
        hideContextMenu={hideContextMenu}
        contextMenuPosition={contextMenuPosition}
        menu={contextMenu}
        className={CONTEXT_MENU_CLASS}
      />
      {bookmarks.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            readOnly
              ? "There are no bookmarks."
              : "There are no bookmarks yet. Add one for the current view with the + button."
          }
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResizableSplitPane
            firstChild={
              <List
                className="bookmark-list"
                dataSource={bookmarks}
                rowKey="id"
                renderItem={(bookmark) => (
                  <List.Item
                    onClick={() => {
                      hideContextMenu();
                      // Clicks into the name input must not jump to the bookmark.
                      if (renamingBookmarkId === bookmark.id) return;
                      handleSelectBookmark(bookmark);
                    }}
                    // All row actions edit the bookmark.
                    onContextMenu={
                      readOnly
                        ? undefined
                        : (event) => openContextMenu(getContextMenu(bookmark), event)
                    }
                    actions={
                      readOnly
                        ? undefined
                        : [
                            // Stacked like in the bounding box tab.
                            <Flex key="actions" vertical className={HOVER_ONLY_CLASS}>
                              <RowActionButton
                                title="Delete this bookmark"
                                icon={<DeleteOutlined />}
                                onClick={() => handleDeleteBookmark(bookmark.id)}
                              />
                              <MoreActionsButton
                                onOpenContextMenu={(event) =>
                                  openContextMenu(getContextMenu(bookmark), event)
                                }
                              />
                            </Flex>,
                          ]
                    }
                    className={
                      bookmark.id === selectedBookmarkId
                        ? "bookmark-list__item--selected"
                        : undefined
                    }
                    style={{
                      cursor: "pointer",
                      // Keeps the thumbnail and the actions at the top of rows with wrapped names.
                      alignItems: "flex-start",
                      background:
                        bookmark.id === selectedBookmarkId
                          ? "var(--ant-color-primary-bg)"
                          : undefined,
                    }}
                    title="Click to jump to this bookmark and show its details."
                  >
                    <Flex gap="small" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
                      <BookmarkThumbnail
                        bookmark={bookmark}
                        onSwitchThumbnail={
                          !readOnly && bookmark.id === selectedBookmarkId
                            ? () => setSwitchingThumbnailOfBookmarkId(bookmark.id)
                            : undefined
                        }
                      />
                      <div style={{ minWidth: 0, paddingTop: NAME_PADDING_TOP }}>
                        <InlineEditableName
                          displayedName={bookmark.name ?? getDefaultBookmarkName(bookmark)}
                          editableValue={bookmark.name ?? ""}
                          placeholder={getDefaultBookmarkName(bookmark)}
                          isEditing={renamingBookmarkId === bookmark.id}
                          disableEditing={readOnly}
                          ellipsis={false}
                          style={{ display: "block", overflowWrap: "anywhere" }}
                          // Like the segment names.
                          strong={bookmark.id === selectedBookmarkId}
                          onStartEditing={() => setRenamingBookmarkId(bookmark.id)}
                          onCommit={(newName) => renameBookmark(bookmark, newName)}
                          onFinishEditing={() => setRenamingBookmarkId(null)}
                        />
                        <BookmarkDetailsLine bookmark={bookmark} />
                      </div>
                    </Flex>
                  </List.Item>
                )}
              />
            }
            secondChild={
              selectedBookmark != null ? <BookmarkDetails bookmark={selectedBookmark} /> : null
            }
          />
        </div>
      )}
      {switchingThumbnailBookmark != null ? (
        <SwitchThumbnailModal
          bookmarkName={
            switchingThumbnailBookmark.name ?? getDefaultBookmarkName(switchingThumbnailBookmark)
          }
          onSelect={(thumbnails) =>
            handleSwitchThumbnail(switchingThumbnailBookmark.id, thumbnails)
          }
          onClose={() => setSwitchingThumbnailOfBookmarkId(null)}
        />
      ) : null}
    </div>
  );
}
