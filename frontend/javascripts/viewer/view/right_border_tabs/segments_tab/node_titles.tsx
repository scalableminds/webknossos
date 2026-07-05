import Icon, { EllipsisOutlined, FolderOutlined, TagsOutlined } from "@ant-design/icons";
import BrushIcon from "@images/icons/icon-brush.svg?react";
import CrosshairsIcon from "@images/icons/icon-crosshairs.svg?react";
import { Space } from "antd";
import classnames from "classnames";
import FastTooltip from "components/fast_tooltip";
import { V4 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import { memo } from "react";
import { useDispatch } from "react-redux";
import type { Vector4 } from "viewer/constants";
import { getSegmentIdForPosition } from "viewer/controller/combinations/volume_handlers";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import {
  getActiveSegmentationTracing,
  getMeshesForCurrentAdditionalCoordinates,
  getSegmentColorAsRGBA,
  getSegmentName,
  getSelectedIds,
} from "viewer/model/accessors/volumetracing_accessor";
import { updateTemporarySettingAction } from "viewer/model/actions/settings_actions";
import { updateSegmentAction } from "viewer/model/actions/volumetracing_actions";
import { api } from "viewer/singletons";
import type { Segment } from "viewer/store";
import ButtonComponent from "viewer/view/components/button_component";
import EditableTextLabel from "viewer/view/components/editable_text_label";
import { ColoredDotIcon } from "../shared/colored_dot_icon";
import { MISSING_GROUP_ID } from "../shared/tree_hierarchy_view_helpers";
import type { SegmentGroupUiNode, SegmentsUiNode, SegmentUiNode } from "./hierarchy";
import { MeshInfoRow } from "./mesh_info_row";
import { mayEditVisibleSegmentation } from "./segments_view_helper";

type TitleProps<NodeType extends SegmentsUiNode> = {
  node: NodeType;
  onContextMenu: (node: NodeType, event: React.MouseEvent<HTMLElement>) => void;
  onRenameStart: () => void;
  onRenameEnd: () => void;
};

function SegmentIdAddendum({ id }: { id: number }) {
  return (
    <FastTooltip title="Segment ID">
      <span className="deemphasized italic" style={{ marginLeft: 4 }}>
        {id}
      </span>
    </FastTooltip>
  );
}

export const SegmentNodeTitle = memo(
  ({
    node,
    onContextMenu,
    onRenameStart,
    onRenameEnd,
    onSelectSegment,
  }: TitleProps<SegmentUiNode> & { onSelectSegment: (segment: Segment) => void }) => {
    const dispatch = useDispatch();
    const { segment } = node;

    const allowUpdate = useWkSelector(mayEditVisibleSegmentation);
    const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
    const activeCellId = useWkSelector(
      (state) => getActiveSegmentationTracing(state)?.activeCellId,
    );
    const isSelectedInList = useWkSelector((state) =>
      getSelectedIds(state).segments.includes(segment.id),
    );
    const mesh = useWkSelector((state) =>
      visibleSegmentationLayer != null
        ? getMeshesForCurrentAdditionalCoordinates(state, visibleSegmentationLayer.name)?.[
            segment.id
          ]
        : undefined,
    );
    const segmentColorRGBA = useWkSelector(
      (state) => getSegmentColorAsRGBA(state, segment.id),
      (a: Vector4, b: Vector4) => V4.isEqual(a, b),
    );
    const isHovered = useWkSelector(
      (state) => state.temporaryConfiguration.hoveredSegmentId === segment.id,
    );
    const isCentered = useWkSelector(
      (state) => getSegmentIdForPosition(getPosition(state.flycam)) === segment.id,
    );

    const setHoveredSegmentId = (segmentId: number | null) =>
      dispatch(updateTemporarySettingAction("hoveredSegmentId", segmentId));

    return (
      <div
        className={classnames("segment-list-item", "no-padding", {
          "is-hovered-segment": isHovered,
        })}
        onMouseEnter={() => setHoveredSegmentId(segment.id)}
        onMouseLeave={() => setHoveredSegmentId(null)}
        onContextMenu={(event) => onContextMenu(node, event)}
      >
        <Space size={0} orientation="vertical">
          <Space size={2}>
            <ColoredDotIcon colorRGBA={segmentColorRGBA} />
            <EditableTextLabel
              value={getSegmentName(segment)}
              label="Segment Name"
              onClick={() => onSelectSegment(segment)}
              onRenameStart={onRenameStart}
              onRenameEnd={onRenameEnd}
              onChange={(name) => {
                if (visibleSegmentationLayer != null) {
                  dispatch(
                    updateSegmentAction(
                      segment.id,
                      { name },
                      visibleSegmentationLayer.name,
                      undefined,
                      true,
                    ),
                  );
                }
              }}
              iconClassName="deemphasized"
              disableEditing={!allowUpdate}
            />
            {(segment.metadata ?? []).length > 0 ? (
              <FastTooltip
                className="deemphasized icon-margin-right"
                title="This segment has assigned metadata properties."
              >
                <TagsOutlined />
              </FastTooltip>
            ) : null}
            <ButtonComponent
              color="default"
              type="text"
              size="small"
              title="Open context menu (also available via right-click)"
              icon={<EllipsisOutlined />}
              onClick={(event) => onContextMenu(node, event)}
            />
            {/* Show the segment ID if the segment has a name. Otherwise, the id is already part of the rendered name. */}
            {segment.name != null ? <SegmentIdAddendum id={segment.id} /> : null}
            {isCentered ? (
              <FastTooltip title="This segment is currently centered in the data viewports.">
                <Icon component={CrosshairsIcon} className="deemphasized" />
              </FastTooltip>
            ) : null}
            {segment.id === activeCellId ? (
              <FastTooltip title="The currently active segment id belongs to this segment.">
                <Icon component={BrushIcon} className="deemphasized" />
              </FastTooltip>
            ) : null}
          </Space>
          <div style={{ marginLeft: 16 }}>
            <MeshInfoRow
              segment={segment}
              mesh={mesh}
              isSelectedInList={isSelectedInList}
              isHovered={isHovered}
            />
          </div>
        </Space>
      </div>
    );
  },
);

export const GroupNodeTitle = memo(
  ({ node, onContextMenu, onRenameStart, onRenameEnd }: TitleProps<SegmentGroupUiNode>) => {
    const { group } = node;
    const allowUpdate = useWkSelector(mayEditVisibleSegmentation);
    const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);

    // Make sure the displayed name is not empty.
    const displayableName = group.name?.trim() || "<Unnamed Group>";

    return (
      <Space
        size={4}
        onContextMenu={(event) => onContextMenu(node, event)}
        style={{ width: "100%" }}
      >
        <FolderOutlined />
        <EditableTextLabel
          value={displayableName}
          label="Group Name"
          onChange={(name) => {
            if (visibleSegmentationLayer != null) {
              api.tracing.renameSegmentGroup(group.groupId, name, visibleSegmentationLayer.name);
            }
          }}
          // The root group must not be renamed.
          disableEditing={!allowUpdate || group.groupId === MISSING_GROUP_ID}
          onRenameStart={onRenameStart}
          onRenameEnd={onRenameEnd}
        />
      </Space>
    );
  },
);
