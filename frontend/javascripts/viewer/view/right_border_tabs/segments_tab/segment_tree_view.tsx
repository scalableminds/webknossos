import { type Tree as AntdTree, type GetRef, type MenuProps, Modal, type TreeProps } from "antd";
import app from "app";
import { useWkSelector } from "libs/react_hooks";
import { sleep } from "libs/utils";
import { useCallback, useEffect, useRef, useState } from "react";
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
import type { Segment } from "viewer/store";
import Store from "viewer/store";
import { getContextMenuPositionFromEvent } from "viewer/view/context_menu/helpers";
import {
  findParentIdForGroupId,
  MISSING_GROUP_ID,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { ResizableSplitPane } from "../resizable_split_pane";
import ScrollableVirtualizedTree from "../scrollable_virtualized_tree";
import { TreeSwitcherIcon } from "../shared/tree_switcher_icon";
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
  const [contextMenuPosition, setContextMenuPosition] = useState<[number, number] | null>(null);
  const [contextMenu, setContextMenu] = useState<MenuProps | null>(null);
  // While a segment/group is being renamed, dragging is disabled so that text
  // selection inside the input doesn't start a drag operation.
  const renamingCounter = useRef(0);
  const onRenameStart = useCallback(() => {
    renamingCounter.current += 1;
  }, []);
  const onRenameEnd = useCallback(() => {
    renamingCounter.current = Math.max(renamingCounter.current - 1, 0);
  }, []);

  useScrollBenchmark(treeRef);

  const hideContextMenu = useCallback(() => {
    setContextMenuPosition(null);
    setContextMenu(null);
  }, []);

  const contextMenuDependencies: ContextMenuDependencies = { ...props, hideContextMenu };
  const buildSegmentContextMenu = useSegmentContextMenuBuilder(contextMenuDependencies);
  const buildGroupContextMenu = useGroupContextMenuBuilder(contextMenuDependencies);

  const openContextMenu = useCallback((menu: MenuProps, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const [x, y] = getContextMenuPositionFromEvent(
      event as React.MouseEvent<HTMLDivElement>,
      CONTEXT_MENU_CLASS,
    );
    // On Windows the right click to open the context menu is also triggered for the overlay
    // of the context menu. This causes the context menu to instantly close after opening.
    // Therefore delay the state update so that the context overlay does not get the right
    // click as an event and therefore does not close.
    setTimeout(() => {
      setContextMenuPosition([x, y]);
      setContextMenu(menu);
    }, 0);
  }, []);

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
        selectedSegmentIds.length === 1 &&
        previous.selectedSegmentIds[0] !== selectedSegmentIds[0]
      ) {
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
      // It is possible to drag a segment that is not selected. In that case,
      // the selected segments are moved as well.
      groupOperations.moveSegmentsToGroup(
        [draggedNode.segment.id, ...selection.selectedSegmentIds],
        targetGroupId,
      );
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
    allowUpdate && renamingCounter.current === 0 && !isRootGroupNode(node);

  const onSelectSegment = useCallback(
    (segment: Segment) => selection.selectSegmentAndJumpToPosition(segment),
    [selection],
  );

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
                        onSelectSegment={onSelectSegment}
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
