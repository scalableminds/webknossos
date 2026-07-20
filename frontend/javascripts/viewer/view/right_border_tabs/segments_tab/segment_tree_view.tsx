import { type Tree as AntdTree, type GetRef, Modal, type TreeProps } from "antd";
import app from "app";
import { useWkSelector } from "libs/react_hooks";
import { sleep } from "libs/utils";
import { useCallback, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { getVisibleSegments } from "viewer/model/accessors/volumetracing_accessor";
import { getUpdateSegmentActionToToggleVisibility } from "viewer/model/actions/volumetracing_action_helpers";
import {
  toggleAllSegmentsAction,
  toggleSegmentGroupAction,
} from "viewer/model/actions/volumetracing_actions";
import Store from "viewer/store";
import {
  findParentIdForGroupId,
  MISSING_GROUP_ID,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { ResizableSplitPane } from "../resizable_split_pane";
import ScrollableVirtualizedTree from "../scrollable_virtualized_tree";
import { TreeSwitcherIcon } from "../shared/tree_switcher_icon";
import { useTreeContextMenu } from "../shared/use_tree_context_menu";
import { ContextMenuContainer } from "../sidebar_context_menu";
import {
  type ContextMenuDependencies,
  useGroupContextMenuBuilder,
  useSegmentContextMenuBuilder,
} from "./context_menus";
import {
  getGroupUiNodeKey,
  getSegmentUiNodeKey,
  isRootGroupNode,
  type SegmentGroupUiNode,
  type SegmentsUiNode,
  type SegmentUiNode,
} from "./hierarchy";
import { GroupNodeTitle, SegmentNodeTitle } from "./node_titles";
import { SegmentDetailsPanel } from "./segment_details_panel";
import { mayEditVisibleSegmentation } from "./segments_view_helper";

const CONTEXT_MENU_CLASS = "segment-list-context-menu-overlay";
const SCROLL_DELAY_MS = 100;

type Props = Omit<ContextMenuDependencies, "hideContextMenu">;

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
  const { hierarchy, selection, groupOperations } = props;
  const dispatch = useDispatch();
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

  const treeRef = useRef<GetRef<typeof AntdTree>>(null);
  const {
    contextMenuPosition,
    contextMenu,
    openContextMenu,
    hideContextMenu,
    onRenameStart,
    onRenameEnd,
    getIsRenaming,
  } = useTreeContextMenu(CONTEXT_MENU_CLASS);

  useScrollBenchmark(treeRef);

  const contextMenuDependencies: ContextMenuDependencies = { ...props, hideContextMenu };
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
  // viewport or the search popover).
  const { selectedSegmentIds, selectedGroupId } = selection;
  const previousSelectionRef = useRef({ selectedSegmentIds, selectedGroupId });
  useEffect(() => {
    const previous = previousSelectionRef.current;
    previousSelectionRef.current = { selectedSegmentIds, selectedGroupId };

    // A newly created segment might not be rendered by the tree yet.
    // Hence, delay the scrolling a bit.
    setTimeout(() => {
      if (treeRef.current == null) {
        return;
      }
      if (
        selectedSegmentIds.length > 0 &&
        previous.selectedSegmentIds[0] !== selectedSegmentIds[0]
      ) {
        // Scroll to the first selected segment. This also covers "select all
        // matches" from the search, where several segments become selected at
        // once and the first one should be brought into view.
        treeRef.current.scrollTo({ key: getSegmentUiNodeKey(selectedSegmentIds[0]) });
      } else if (selectedGroupId != null && previous.selectedGroupId !== selectedGroupId) {
        treeRef.current.scrollTo({ key: getGroupUiNodeKey(selectedGroupId) });
      }
    }, SCROLL_DELAY_MS);
  }, [selectedSegmentIds, selectedGroupId]);

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
    const segmentIds: number[] = [];
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

    // Windows / Mac single pick
    const isMultiSelectPick = nativeEvent?.ctrlKey || nativeEvent?.metaKey;
    const newSelectedKeys = isMultiSelectPick ? (keys as string[]) : [node.key as string];

    const multiSelection = getSelectionForKeys(keys as string[]);
    const newSelection = getSelectionForKeys(newSelectedKeys);

    if (multiSelection.groupId != null && multiSelection.segmentIds.length > 0) {
      if (multiSelection.segmentIds.length > 1) {
        Modal.confirm({
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
    allowUpdate && !getIsRenaming() && !isRootGroupNode(node);

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
              <div style={{ height, width, overflow: "hidden" }}>
                <ScrollableVirtualizedTree<SegmentsUiNode>
                  treeData={hierarchy.roots}
                  height={height}
                  ref={treeRef}
                  className="segments-tree"
                  titleRender={(node) =>
                    node.type === "segment" ? (
                      <SegmentNodeTitle
                        node={node}
                        onContextMenu={onSegmentNodeContextMenu}
                        onRenameStart={onRenameStart}
                        onRenameEnd={onRenameEnd}
                        onSelectSegment={selection.selectSegmentAndJumpToPosition}
                      />
                    ) : (
                      <GroupNodeTitle
                        node={node}
                        onContextMenu={onGroupNodeContextMenu}
                        onRenameStart={onRenameStart}
                        onRenameEnd={onRenameEnd}
                      />
                    )
                  }
                  switcherIcon={({ expanded }) => <TreeSwitcherIcon expanded={expanded} />}
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
