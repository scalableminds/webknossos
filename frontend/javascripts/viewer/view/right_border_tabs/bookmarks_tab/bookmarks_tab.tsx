import Icon, {
  AimOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PictureOutlined,
  PlusOutlined,
  RollbackOutlined,
  SearchOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import MeshIcon from "@images/icons/icon-mesh-organic-boundary.svg?react";
import { getBookmarkThumbnailUrl } from "admin/rest_api";
import { Divider, Empty, Flex, List, type MenuProps, Popover, Space, Spin, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import FormattedDate from "components/formatted_date";
import { SimpleRow } from "dashboard/folders/metadata_table";
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
import { bookmarkStateToUrlState } from "viewer/controller/bookmark_state";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import {
  deleteBookmarkAction,
  setBookmarkMetadataAction,
  setBookmarkNameAction,
  setBookmarkStateAction,
  setBookmarkThumbnailAction,
} from "viewer/model/actions/annotation_actions";
import { setViewModeAction } from "viewer/model/actions/settings_actions";
import { setBookmarkIdToFocusAction } from "viewer/model/actions/ui_actions";
import { waitUntilRebaseFinished } from "viewer/model/helpers/bounding_box_creation_helpers";
import { diffMetadata } from "viewer/model/sagas/diffing/volume_diffing";
import Store, { type WebknossosState } from "viewer/store";
import { positionToString } from "viewer/view/context_menu/helpers";
import type { BookmarkThumbnails } from "viewer/view/rendering_utils";
import ButtonComponent from "../../components/button_component";
import { InputWithUpdateOnBlur } from "../../components/input_with_update_on_blur";
import { getShortcutDisplayString } from "../../keyboard_shortcuts/keyboard_shortcut_utils";
import AdvancedSearchPopover from "../advanced_search_popover";
import { MetadataEntryTableRows } from "../metadata_table";
import { ResizableSplitPane } from "../resizable_split_pane";
import { InlineEditableName } from "../shared/inline_editable_name";
import { HOVER_ONLY_CLASS, MoreActionsButton, RowActionButton } from "../shared/list_row";
import { useTreeContextMenu } from "../shared/use_tree_context_menu";
import { ContextMenuContainer } from "../sidebar_context_menu";
import {
  addBookmarkForCurrentView,
  captureThumbnailsSafely,
  getCurrentBookmarkState,
  toUnsavedBookmarkThumbnail,
} from "./add_bookmark";
import { getDefaultBookmarkName } from "./bookmark_names";
import { exportBookmarksAsCSV } from "./export_bookmarks_csv";
import { SwitchThumbnailModal } from "./switch_thumbnail_modal";

const THUMBNAIL_BOX_SIZE = 48;
// Centers a single-line name and its details line next to the thumbnail.
const NAME_PADDING_TOP = 3;

const SWITCH_THUMBNAIL_BUTTON_SIZE = 20;

const LARGE_THUMBNAIL_PREVIEW_MAX_EDGE = 400;

// The locally captured thumbnail if there is one, otherwise the one on the server.
function useBookmarkThumbnailSrc(
  bookmark: APIAnnotationBookmark,
  size: "small" | "large",
): string | null {
  const tracingStoreUrl = useWkSelector((state) => state.annotation.tracingStore.url);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const { id, thumbnailVersion } = bookmark;
  const localDataBase64 =
    size === "small" ? bookmark.smallThumbnailDataBase64 : bookmark.largeThumbnailDataBase64;

  useEffect(() => {
    // Unsaved thumbnails are not on the server yet.
    if (localDataBase64 != null || thumbnailVersion == null) return;
    let isCancelled = false;
    getBookmarkThumbnailUrl(tracingStoreUrl, annotationId, id, thumbnailVersion, size).then(
      (url) => {
        if (!isCancelled) setServerUrl(url);
      },
    );
    return () => {
      isCancelled = true;
    };
  }, [tracingStoreUrl, annotationId, id, thumbnailVersion, localDataBase64, size]);

  return localDataBase64 != null ? `data:image/webp;base64,${localDataBase64}` : serverUrl;
}

// Only rendered while the popover is open, so that the large thumbnail is loaded on demand.
// Its size is fixed from the start (by the aspect ratio of the small thumbnail), as the popover
// would otherwise be positioned for the empty content and jump once the image is loaded.
function LargeBookmarkThumbnail({
  bookmark,
  aspectRatio,
}: {
  bookmark: APIAnnotationBookmark;
  aspectRatio: number;
}) {
  const src = useBookmarkThumbnailSrc(bookmark, "large");
  const width =
    aspectRatio >= 1
      ? LARGE_THUMBNAIL_PREVIEW_MAX_EDGE
      : LARGE_THUMBNAIL_PREVIEW_MAX_EDGE * aspectRatio;
  const height =
    aspectRatio >= 1
      ? LARGE_THUMBNAIL_PREVIEW_MAX_EDGE / aspectRatio
      : LARGE_THUMBNAIL_PREVIEW_MAX_EDGE;
  return (
    <Flex align="center" justify="center" style={{ width, height }}>
      {src == null ? (
        <Spin size="small" />
      ) : (
        <img
          src={src}
          alt=""
          style={{
            width,
            height,
            display: "block",
            borderRadius: "var(--ant-border-radius-sm)",
          }}
        />
      )}
    </Flex>
  );
}

function BookmarkThumbnail({
  bookmark,
  onSwitchThumbnail,
}: {
  bookmark: APIAnnotationBookmark;
  // Shows a button to switch the thumbnail if set.
  onSwitchThumbnail?: () => void;
}) {
  const [hasError, setHasError] = useState(false);
  // Known once the small thumbnail is loaded. The large one has the same aspect ratio.
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const src = useBookmarkThumbnailSrc(bookmark, "small");

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
        <Popover
          content={
            aspectRatio != null ? (
              <LargeBookmarkThumbnail bookmark={bookmark} aspectRatio={aspectRatio} />
            ) : null
          }
          placement="left"
          mouseEnterDelay={0.3}
          destroyOnHidden
        >
          <img
            src={src}
            alt=""
            loading="lazy"
            onLoad={(event) =>
              setAspectRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)
            }
            onError={() => setHasError(true)}
            style={{
              maxWidth: THUMBNAIL_BOX_SIZE,
              maxHeight: THUMBNAIL_BOX_SIZE,
              display: "block",
              borderRadius: "var(--ant-border-radius-sm)",
            }}
          />
        </Popover>
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

function useRenameBookmark() {
  const dispatch = useDispatch();
  return useCallback(
    async (bookmark: APIAnnotationBookmark, newName: string) => {
      // An empty name clears it, so that the default name is shown.
      const name = newName.trim() === "" ? null : newName;
      if (name === bookmark.name) return;
      await waitUntilRebaseFinished();
      dispatch(setBookmarkNameAction(bookmark.id, name));
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
  const addBookmarkShortcut = useWkSelector((state) =>
    getShortcutDisplayString(
      state.keyboardConfiguration.shortcutsConfig,
      "ADD_BOOKMARK",
      state.keyboardConfiguration.unmodifiedLayoutMap,
    ),
  );
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
    const id = await addBookmarkForCurrentView(dispatch);
    if (id == null) return;
    // Nudge users to name the new bookmark.
    selectBookmark(id);
    setPreviousView(null);
    setRenamingBookmarkId(id);
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

  // Requested by the "Show" link of the toast that confirms a bookmark added from elsewhere.
  const bookmarkIdToFocus = useWkSelector((state) => state.uiInformation.bookmarkIdToFocus);
  useEffect(() => {
    if (bookmarkIdToFocus == null) return;
    dispatch(setBookmarkIdToFocusAction(null));
    const bookmark = bookmarks.find(({ id }) => id === bookmarkIdToFocus);
    if (bookmark == null) return;
    // The view may have changed since the bookmark was added.
    handleSelectBookmark(bookmark);
    if (!readOnly) setRenamingBookmarkId(bookmark.id);
  }, [bookmarkIdToFocus, bookmarks, dispatch, handleSelectBookmark, readOnly]);

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
      dispatch(
        setBookmarkStateAction(
          bookmarkId,
          state,
          thumbnails != null ? toUnsavedBookmarkThumbnail(thumbnails) : null,
        ),
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
      dispatch(setBookmarkThumbnailAction(bookmarkId, toUnsavedBookmarkThumbnail(thumbnails)));
    },
    [dispatch],
  );

  const handleDeleteBookmark = useCallback(
    async (bookmarkId: number) => {
      await waitUntilRebaseFinished();
      dispatch(deleteBookmarkAction(bookmarkId));
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
              title={`Click to add a bookmark for the current view.${
                addBookmarkShortcut != null ? ` (${addBookmarkShortcut})` : ""
              }`}
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
        <ButtonComponent
          disabled={bookmarks.length === 0}
          variant="text"
          color="default"
          title="Export all bookmarks as CSV"
          onClick={() => exportBookmarksAsCSV(Store.getState())}
          icon={<DownloadOutlined />}
        />
      </Space>
      {/* The first bookmark's own padding provides the space below the divider. */}
      <Divider size="small" style={{ marginBottom: 0 }} />
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
