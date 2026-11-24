import { type Tree as AntdTree, App, type GetRef, type TreeProps } from "antd";
import app from "app";
import { useWkSelector } from "libs/react_hooks";
import { clamp, isEditableEventTarget, sleep } from "libs/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import { getSegmentIdsAtPosition } from "viewer/controller/combinations/volume_handlers";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { getVisibleSegments } from "viewer/model/accessors/volumetracing_accessor";
import { getUpdateSegmentActionToToggleVisibility } from "viewer/model/actions/volumetracing_action_helpers";
import {
  toggleAllSegmentsAction,
  toggleSegmentGroupAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import Store from "viewer/store";
import {
  findParentIdForGroupId,
  MISSING_GROUP_ID,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { ResizableSplitPane } from "../resizable_split_pane";
import ScrollableVirtualizedTree from "../scrollable_virtualized_tree";
import { LIST_ROW_HEIGHT } from "../shared/list_row";
import { TreeSwitcherIcon } from "../shared/tree_switcher_icon";
import { useTreeContextMenu } from "../shared/use_tree_context_menu";
import { ContextMenuContainer } from "../sidebar_context_menu";
import {
  type ContextMenuDependencies,
  useGroupContextMenuBuilder,
  useSegmentContextMenuBuilder,
} from "./context_menus";
import {
  findSegmentToSelectAfterRemoval,
  getGroupUiNodeKey,
  getRenderedNodes,
  getSegmentIdsInRange,
  getSegmentUiNodeKey,
  isRootGroupNode,
  type SegmentGroupUiNode,
  type SegmentsUiNode,
  type SegmentUiNode,
} from "./hierarchy";
import { useJumpToSegment } from "./hooks/use_jump_to_segment";
import { useSegmentListKeyboardShortcuts } from "./hooks/use_segment_list_keyboard_shortcuts";
import { useTreeCursorOnSelection } from "./hooks/use_tree_cursor_on_selection";
import { withMeshFileCompatibilityCheck } from "./mesh_file_compatibility_modal";
import { GroupNodeTitle } from "./node_titles";
import { SegmentDetailsPanel } from "./segment_details_panel";
import { SegmentNodeTitle, type SegmentRowActions } from "./segment_row";
import { mayEditVisibleSegmentation, removeSegmentsFromList } from "./segments_view_helper";

const CONTEXT_MENU_CLASS = "segment-list-context-menu-overlay";
const SCROLL_DELAY_MS = 100;

type Props = Omit<ContextMenuDependencies, "hideContextMenu" | "startRenaming">;

/*
 * Reacts to the "benchmark:segmentlist:scroll" event (emitted from the dev console)
 * by scrolling through the whole segment list once, for performance measurements.
 */
function useScrollBenchmark(treeRef: React.RefObject<GetRef<typeof AntdTree> | null>) {
  useEffect(() => {
    const benchmarkScroll = async (itemCount: number, done: () => void) => {
      const { segments } = Store.getState().localSegmentationStateByLayer[
        getVisibleSegmentationLayer(Store.getState())?.name ?? ""
      ] ?? { segments: null };
      if (treeRef.current == null || segments == null || segments.size() === 0) {
        return;
      }
      let counter = 0;
      while (counter < itemCount) {
        for (const segment of segments.values()) {
          if (counter >= itemCount) {
            break;
          }
          await sleep(0);
          treeRef.current.scrollTo({ key: getSegmentUiNodeKey(segment.id) });
          counter++;
        }
      }
      done();
    };
    return app.vent.on("benchmark:segmentlist:scroll", benchmarkScroll);
  }, [treeRef]);
}

export function SegmentTreeView(props: Props) {
  const { hierarchy, selection, groupOperations, meshOperations } = props;
  const dispatch = useDispatch();
  const { modal } = App.useApp();
  const allowUpdate = useWkSelector(mayEditVisibleSegmentation);
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const segmentGroups = useWkSelector((state) => getVisibleSegments(state).segmentGroups);
  const showCheckboxes = useWkSelector(
    (state) =>
      !(
        state.uiInformation.activeTool === AnnotationTool.PROOFREAD &&
        state.userConfiguration.selectiveVisibilityInProofreading
      ),
  );
  // The segment id at the camera center is looked up once for the whole list. The lookup must not
  // be memoized on the position (see volume_handlers.ts), so doing it per row would repeat a
  // transform + mag + cube lookup for every rendered row on every store notification.
  const centeredSegmentId = useWkSelector(
    (state) => getSegmentIdsAtPosition(getPosition(state.flycam)).mappedId,
  );

  const treeRef = useRef<GetRef<typeof AntdTree>>(null);
  const { contextMenuPosition, contextMenu, openContextMenu, hideContextMenu } =
    useTreeContextMenu(CONTEXT_MENU_CLASS);

  useScrollBenchmark(treeRef);

  const treeContainerRef = useRef<HTMLDivElement>(null);
  useSegmentListKeyboardShortcuts(treeContainerRef, () => {
    if (visibleSegmentationLayer == null || selection.selectedSegmentIds.length === 0) {
      return;
    }
    // Select the neighboring segment afterwards, so that one can keep removing segments
    // with the shortcut (like in a file manager).
    const nextNode = findSegmentToSelectAfterRemoval(hierarchy, selection.selectedSegmentIds);
    removeSegmentsFromList(dispatch, visibleSegmentationLayer.name, selection.selectedSegmentIds);
    if (nextNode != null) {
      selection.setSelection([nextNode.segment.id], null);
    }
  });

  // At most one row is editable at a time. Owning the key here (instead of letting each
  // row keep its own state) lets the "Rename" context menu entry start an edit, and lets
  // drag & drop be suspended while one is running, so that selecting text in the input
  // doesn't start a drag.
  const [renamingNodeKey, setRenamingNodeKey] = useState<string | null>(null);
  const startRenaming = useCallback((nodeKey: string) => setRenamingNodeKey(nodeKey), []);
  const finishRenaming = useCallback(() => setRenamingNodeKey(null), []);

  const { currentMeshFile } = props.meshFiles;

  const jumpToSegment = useJumpToSegment();
  const segmentRowActions: SegmentRowActions = useMemo(
    () => ({
      selectAndJumpTo: selection.selectSegmentAndJumpToPosition,
      centerInViewports: jumpToSegment,
      computeAdHocMesh: (segment) => meshOperations.loadAdHocMeshes([segment]),
      // Only worth asking when there is something to choose between. A precomputed mesh
      // is the cheaper one, but it is stale for a segment that was edited since the file
      // was computed, so neither is a safe default.
      getMeshLoadMenuItems: (segment) =>
        currentMeshFile == null
          ? null
          : [
              {
                key: "loadPrecomputedMesh",
                label: "Load Mesh (precomputed)",
                onClick: withMeshFileCompatibilityCheck(
                  (meshFileName) => meshOperations.loadPrecomputedMeshes([segment], meshFileName),
                  visibleSegmentationLayer?.name,
                ),
              },
              {
                key: "computeAdHocMesh",
                label: "Compute Mesh (ad-hoc)",
                onClick: () => meshOperations.loadAdHocMeshes([segment]),
              },
            ],
      setMeshVisibility: (segment, isVisible) =>
        meshOperations.setMeshVisibility([segment], isVisible),
      // Removing a mesh that is still loading aborts its computation (see ad_hoc_mesh_saga).
      cancelMeshComputation: (segment) => meshOperations.removeMeshes([segment]),
      renameSegment: (segment, name) => {
        if (visibleSegmentationLayer != null) {
          dispatch(
            updateSegmentAction(
              segment.id,
              { name: name.length > 0 ? name : null },
              visibleSegmentationLayer.name,
              undefined,
              true,
            ),
          );
        }
      },
      startRenaming,
      finishRenaming,
    }),
    [
      dispatch,
      visibleSegmentationLayer,
      meshOperations,
      currentMeshFile,
      jumpToSegment,
      selection.selectSegmentAndJumpToPosition,
      startRenaming,
      finishRenaming,
    ],
  );

  const contextMenuDependencies: ContextMenuDependencies = {
    ...props,
    hideContextMenu,
    startRenaming,
  };
  const buildSegmentContextMenu = useSegmentContextMenuBuilder(contextMenuDependencies);
  const buildGroupContextMenu = useGroupContextMenuBuilder(contextMenuDependencies);

  const onSegmentNodeContextMenu = useCallback(
    (node: SegmentUiNode, event: React.MouseEvent<HTMLElement>) =>
      openContextMenu(buildSegmentContextMenu(node), event),
    [openContextMenu, buildSegmentContextMenu],
  );

  const onGroupNodeContextMenu = useCallback(
    (node: SegmentGroupUiNode, event: React.MouseEvent<HTMLElement>) =>
      openContextMenu(buildGroupContextMenu(node), event),
    [openContextMenu, buildGroupContextMenu],
  );

  // Scroll to newly selected segments/groups (the selection can also change
  // through actions outside of this component, e.g. clicking a segment in a
  // viewport or the search popover). `focusToken` additionally forces a
  // scroll for explicit "jump to this" requests (search, select-all-matches)
  // even when they re-select whatever is already selected: in that case
  // selectedSegmentIds/selectedGroupId are otherwise unchanged, since
  // getSelectedIds reuses its previous instance for a deep-equal selection.
  const { selectedSegmentIds, selectedGroupId, focusToken } = selection;
  const previousSelectionRef = useRef({ selectedSegmentIds, selectedGroupId, focusToken });
  useEffect(() => {
    const previous = previousSelectionRef.current;
    previousSelectionRef.current = { selectedSegmentIds, selectedGroupId, focusToken };
    const didFocusChange = previous.focusToken !== focusToken;

    // A newly created segment might not be rendered by the tree yet.
    // Hence, delay the scrolling a bit.
    setTimeout(() => {
      if (treeRef.current == null) {
        return;
      }
      if (
        selectedSegmentIds.length > 0 &&
        (didFocusChange || previous.selectedSegmentIds[0] !== selectedSegmentIds[0])
      ) {
        // Scroll to the first selected segment. This also covers "select all
        // matches" from the search, where several segments become selected at
        // once and the first one should be brought into view.
        treeRef.current.scrollTo({ key: getSegmentUiNodeKey(selectedSegmentIds[0]) });
      } else if (
        selectedGroupId != null &&
        (didFocusChange || previous.selectedGroupId !== selectedGroupId)
      ) {
        treeRef.current.scrollTo({ key: getGroupUiNodeKey(selectedGroupId) });
      }
    }, SCROLL_DELAY_MS);
  }, [selectedSegmentIds, selectedGroupId, focusToken]);

  const treeCursor = useTreeCursorOnSelection(selection.selectedKeys.at(-1) ?? null);

  const onExpand: TreeProps<SegmentsUiNode>["onExpand"] = (expandedKeys) => {
    groupOperations.setExpandedGroups(new Set(expandedKeys as string[]));
  };

  const onCheck: TreeProps<SegmentsUiNode>["onCheck"] = (_checkedKeys, info) => {
    const { node } = info;
    if (visibleSegmentationLayer == null) {
      return;
    }
    if (node.type === "segment") {
      const action = getUpdateSegmentActionToToggleVisibility(Store.getState(), node.segment.id);
      if (action != null) {
        dispatch(action);
      }
    } else if (node.group.groupId === MISSING_GROUP_ID) {
      dispatch(toggleAllSegmentsAction(visibleSegmentationLayer.name));
    } else {
      dispatch(toggleSegmentGroupAction(node.group.groupId, visibleSegmentationLayer.name));
    }
  };

  const getSelectionForKeys = (keys: string[]) => {
    const segmentIds: bigint[] = [];
    let groupId: number | null = null;
    for (const key of keys) {
      const node = hierarchy.nodesByKey.get(key);
      if (node?.type === "segment") {
        segmentIds.push(node.segment.id);
      } else if (node?.type === "group") {
        groupId = node.group.groupId;
      }
    }
    return { segmentIds, groupId };
  };

  const onSelect: TreeProps<SegmentsUiNode>["onSelect"] = (keys, event) => {
    const { node, nativeEvent } = event;
    if (
      nativeEvent?.target instanceof HTMLElement &&
      (nativeEvent.target.closest(".ant-dropdown-menu") != null ||
        nativeEvent.target.closest(".ant-popover") != null)
    ) {
      // Ignore events that refer to elements in a popover or dropdown, since these
      // shouldn't influence the selection of the tree component.
      return;
    }

    if (node.type === "segment" && nativeEvent?.shiftKey) {
      // SHIFT click selects a whole range of segments, starting at the anchor.
      // The anchor is the last id of the selection: plain and CTRL clicks append
      // the clicked segment, and range selections keep the anchor at the end, so
      // that it stays fixed across subsequent SHIFT clicks. Since the selection
      // lives in the store, the anchor survives remounts and is per layer.
      // Like in the skeleton tab, this only works for segments within the same group.
      const anchorSegmentId = selection.selectedSegmentIds.at(-1);
      if (anchorSegmentId != null) {
        const segmentIdsInRange = getSegmentIdsInRange(hierarchy, anchorSegmentId, node.segment.id);
        if (segmentIdsInRange != null) {
          // CTRL+SHIFT adds the range to the existing selection instead of replacing it.
          const isAdditive = nativeEvent.ctrlKey || nativeEvent.metaKey;
          const newSegmentIds = new Set(isAdditive ? selection.selectedSegmentIds : []);
          for (const id of segmentIdsInRange) newSegmentIds.add(id);
          newSegmentIds.delete(anchorSegmentId);
          selection.setSelection([...newSegmentIds, anchorSegmentId], null);
        }
        return;
      }
    }

    // Windows / Mac single pick
    const isMultiSelectPick = nativeEvent?.ctrlKey || nativeEvent?.metaKey;
    const newSelectedKeys = isMultiSelectPick ? (keys as string[]) : [node.key as string];

    const multiSelection = getSelectionForKeys(keys as string[]);
    const newSelection = getSelectionForKeys(newSelectedKeys);

    if (multiSelection.groupId != null && multiSelection.segmentIds.length > 0) {
      if (multiSelection.segmentIds.length > 1) {
        modal.confirm({
          title: "Do you really want to select this group?",
          content: `You have ${multiSelection.segmentIds.length} selected segments. Do you really want to select this group?
        This will deselect all selected segments.`,
          onOk: () => selection.setSelection([], newSelection.groupId),
          onCancel() {},
        });
      } else {
        // If only one segment is selected, select the group without a warning (and
        // vice-versa), even though ctrl is pressed.
        const clickedNodeSelection = getSelectionForKeys([node.key as string]);
        selection.setSelection(clickedNodeSelection.segmentIds, clickedNodeSelection.groupId);
      }
      return;
    }
    selection.setSelection(newSelection.segmentIds, newSelection.groupId);
  };

  const isPlainArrowKeyInList = (event: React.KeyboardEvent, keys: string[]) =>
    keys.includes(event.key) &&
    !(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) &&
    // Editable elements (e.g. the rename input) keep their native arrow key handling.
    !isEditableEventTarget(event.target);

  // Arrow up/down move the selection (instead of antd's own keyboard cursor). In contrast to
  // clicking a segment row, this does not move the camera to the segment.
  // The event is consumed, so that the shortcuts of the viewports (e.g. moving the camera)
  // don't react to it, too.
  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    if (!isPlainArrowKeyInList(event, ["ArrowUp", "ArrowDown"])) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const renderedNodes = getRenderedNodes(hierarchy);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const currentKey = selection.selectedKeys.at(-1);
    const currentIndex = renderedNodes.findIndex((node) => node.key === currentKey);
    const newIndex =
      currentIndex === -1
        ? offset === 1
          ? 0
          : renderedNodes.length - 1
        : clamp(0, currentIndex + offset, renderedNodes.length - 1);
    const newSelection = getSelectionForKeys([renderedNodes[newIndex].key]);
    selection.setSelection(newSelection.segmentIds, newSelection.groupId);
  };

  const onDrop: TreeProps<SegmentsUiNode>["onDrop"] = (info) => {
    const { dragNode: draggedNode, node: dropTargetNode } = info;

    // dropToGap effectively means that the user dragged the item so that it should be
    // moved to the parent of the target node. Since nothing can be dragged inside of a
    // segment, dropToGap is ignored when the target node is a segment. Otherwise, the
    // node could be dragged to the wrong location.
    const dropToGap = dropTargetNode.type === "segment" ? false : info.dropToGap;

    const dropTargetGroupId =
      dropTargetNode.type === "segment"
        ? dropTargetNode.segment.groupId
        : dropTargetNode.group.groupId;
    let targetGroupId: number | null | undefined = null;
    if (dropTargetGroupId != null) {
      targetGroupId = dropToGap
        ? findParentIdForGroupId(segmentGroups, dropTargetGroupId)
        : dropTargetGroupId;
    }

    if (draggedNode.type === "segment") {
      // The whole multi-selection is only moved along when the dragged segment
      // is part of it. Dragging a segment outside the selection moves just that
      // segment (and never duplicates the dragged id within the selection).
      const segmentIdsToMove =
        selection.selectedSegmentIds.length > 1 &&
        selection.selectedSegmentIds.includes(draggedNode.segment.id)
          ? selection.selectedSegmentIds
          : [draggedNode.segment.id];
      groupOperations.moveSegmentsToGroup(segmentIdsToMove, targetGroupId);
    } else {
      groupOperations.moveGroupToGroup(draggedNode.group.groupId, targetGroupId);
    }
  };

  const allowDrop: TreeProps<SegmentsUiNode>["allowDrop"] = ({ dropNode, dropPosition }) => {
    // Only allow dropping something into a group (dropPosition === 0 means "as child
    // of the hovered node"). Dropping next to a segment is fine.
    return dropNode.type === "group" || dropPosition !== 0;
  };

  const isNodeDraggable = (node: SegmentsUiNode): boolean =>
    allowUpdate && renamingNodeKey == null && !isRootGroupNode(node);

  const clearSelection = () => {
    if (selection.selectedSegmentIds.length > 0 || selection.selectedGroupId != null) {
      selection.setSelection([], null);
    }
  };

  const onClickTreeContainer = (event: React.MouseEvent<HTMLDivElement>) => {
    // Clicking the empty space below the rows clears the selection. React events
    // bubble through portals, so check the DOM to ignore clicks in popovers and
    // dropdowns that were opened from a row.
    const { target, currentTarget } = event;
    if (
      target instanceof HTMLElement &&
      currentTarget.contains(target) &&
      target.closest(".ant-tree-treenode, .ant-tree-list-scrollbar") == null
    ) {
      clearSelection();
    }
  };

  const onKeyDownTreeContainer = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // ESC clears the selection, unless it is meant for an input (e.g., to cancel renaming).
    if (
      event.key === "Escape" &&
      !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
    ) {
      clearSelection();
    }
    // Left/right are handled by antd's tree (collapsing/expanding groups) before this handler is
    // reached. Only make sure that they don't move the camera, too.
    if (isPlainArrowKeyInList(event, ["ArrowLeft", "ArrowRight"])) {
      event.stopPropagation();
    }
  };

  return (
    <>
      <ContextMenuContainer
        hideContextMenu={hideContextMenu}
        contextMenuPosition={contextMenuPosition}
        menu={contextMenu}
        className={CONTEXT_MENU_CLASS}
      />
      <ResizableSplitPane
        firstChild={
          <AutoSizer
            // Without the default height, height will be 0 on the first render, leading
            // to tree virtualization being disabled. This has a major performance impact.
            defaultHeight={500}
          >
            {({ height, width }) => (
              <div
                ref={treeContainerRef}
                style={{ height, width, overflow: "hidden" }}
                // The tree's list element is focusable, so its key events bubble up to here.
                onClick={onClickTreeContainer}
                onKeyDownCapture={onKeyDownCapture}
                onKeyDown={onKeyDownTreeContainer}
              >
                <ScrollableVirtualizedTree<SegmentsUiNode>
                  treeData={hierarchy.roots}
                  height={height}
                  itemHeight={LIST_ROW_HEIGHT}
                  ref={treeRef}
                  className="list-tree list-tree--active-is-selected"
                  titleRender={(node) =>
                    node.type === "segment" ? (
                      <SegmentNodeTitle
                        node={node}
                        isCentered={centeredSegmentId === node.segment.id}
                        isRenaming={renamingNodeKey === node.key}
                        actions={segmentRowActions}
                        onContextMenu={onSegmentNodeContextMenu}
                      />
                    ) : (
                      <GroupNodeTitle
                        node={node}
                        isRenaming={renamingNodeKey === node.key}
                        onContextMenu={onGroupNodeContextMenu}
                        onStartRenaming={startRenaming}
                        onFinishRenaming={finishRenaming}
                      />
                    )
                  }
                  switcherIcon={({ expanded }) => <TreeSwitcherIcon expanded={expanded} />}
                  activeKey={treeCursor.activeKey}
                  onActiveChange={treeCursor.onActiveChange}
                  onSelect={onSelect}
                  onDrop={onDrop}
                  allowDrop={allowDrop}
                  onCheck={onCheck}
                  onExpand={onExpand}
                  // @ts-expect-error nodeDraggable is typed with the base type DataNode, but the tree data uses its extension SegmentsUiNode
                  draggable={{ nodeDraggable: isNodeDraggable, icon: false }}
                  checkable={showCheckboxes}
                  checkedKeys={hierarchy.checkedKeys}
                  expandedKeys={hierarchy.expandedKeys}
                  selectedKeys={selection.selectedKeys}
                  style={{ marginLeft: -24 }} // hide switcherIcon for root group
                  blockNode
                  showLine
                  multiple
                />
              </div>
            )}
          </AutoSizer>
        }
        secondChild={<SegmentDetailsPanelContainer selection={selection} />}
      />
    </>
  );
}

function SegmentDetailsPanelContainer({ selection }: { selection: Props["selection"] }) {
  const allowUpdate = useWkSelector(mayEditVisibleSegmentation);
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const segments = useWkSelector((state) => getVisibleSegments(state).segments);
  const segmentGroups = useWkSelector((state) => getVisibleSegments(state).segmentGroups);

  return (
    <SegmentDetailsPanel
      selectedIds={{ segments: selection.selectedSegmentIds, group: selection.selectedGroupId }}
      segments={segments}
      segmentGroups={segmentGroups}
      visibleSegmentationLayer={visibleSegmentationLayer}
      allowUpdate={allowUpdate}
    />
  );
}
